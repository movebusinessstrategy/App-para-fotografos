import express from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (one level up)
dotenv.config({ path: path.join(__dirname, "../.env") });

// Use bundled ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = 3333;

app.use(cors({ origin: ["http://localhost:3000", "http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, "uploads");
const PROCESSED_DIR = path.join(__dirname, "processed");

// Ensure directories exist
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

// In-memory job store
const jobs = {};

// Progress store
const progress = {};

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const jobId = uuidv4();
    req.jobId = jobId;
    cb(null, `${jobId}${ext}`);
  },
});
const upload = multer({ storage });

// POST /api/upload
app.post("/api/upload", upload.single("video"), (req, res) => {
  try {
    const jobId = req.jobId || path.parse(req.file.filename).name;
    jobs[jobId] = {
      originalFile: req.file.filename,
      originalPath: req.file.path,
    };
    res.json({ jobId, filename: req.file.filename });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/normalize/:jobId
app.post("/api/normalize/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  const outputFile = `${jobId}_normalized.mp4`;
  const outputPath = path.join(PROCESSED_DIR, outputFile);

  progress[jobId] = { step: "normalize", percent: 0 };

  ffmpeg(job.originalPath)
    .videoCodec("libx264")
    .audioCodec("aac")
    .outputOptions(["-r 30", "-crf 23", "-preset fast", "-movflags +faststart"])
    .output(outputPath)
    .on("progress", (p) => {
      progress[jobId] = { step: "normalize", percent: Math.min(Math.round(p.percent || 0), 99) };
    })
    .on("end", () => {
      progress[jobId] = { step: "normalize", percent: 100 };
      jobs[jobId].processedFile = outputFile;
      jobs[jobId].processedPath = outputPath;
      res.json({ processedFile: outputFile });
    })
    .on("error", (err) => {
      console.error("FFmpeg normalize error:", err);
      progress[jobId] = { step: "normalize", percent: 0, error: err.message };
      res.status(500).json({ error: err.message });
    })
    .run();
});

// POST /api/transcribe/:jobId
app.post("/api/transcribe/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  const audioFile = `${jobId}_audio.mp3`;
  const audioPath = path.join(PROCESSED_DIR, audioFile);
  const videoPath = job.processedPath || job.originalPath;

  try {
    progress[jobId] = { step: "transcribe", percent: 10, label: "Extraindo áudio..." };

    // Extract audio
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate("128k")
        .output(audioPath)
        .on("progress", (p) => {
          progress[jobId] = { step: "transcribe", percent: Math.min(10 + Math.round((p.percent || 0) * 0.3), 40), label: "Extraindo áudio..." };
        })
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    progress[jobId] = { step: "transcribe", percent: 50, label: "Transcrevendo com Whisper..." };

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    // Build word-level segments
    const segments = (transcription.words || []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    jobs[jobId].transcription = transcription.text;
    jobs[jobId].segments = segments;
    progress[jobId] = { step: "transcribe", percent: 100, label: "Transcrição concluída!" };

    res.json({ text: transcription.text, segments });
  } catch (err) {
    console.error("Transcribe error:", err);
    progress[jobId] = { step: "transcribe", percent: 0, error: err.message };
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze/:jobId
app.post("/api/analyze/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  const segments = job.segments || [];
  const transcriptionWithIndices = segments
    .map((s, i) => `[${i}] ${s.word}`)
    .join(" ");

  const prompt = `Você é um editor de vídeo profissional. Analise a transcrição abaixo e crie um plano de edição.

Transcrição (com índices de legenda):
${transcriptionWithIndices}

Retorne um JSON com exatamente esta estrutura:
{
  "narrativeFormat": "educativo|storytelling|lista|comparativo|cta|tutorial|depoimento",
  "colorPalette": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex"
  },
  "scenes": [
    {
      "id": 1,
      "type": "A|B|C|D|E|F|G|H|I",
      "startLeg": 0,
      "title": "texto principal",
      "subtitle": "texto secundário (opcional)",
      "icon": "emoji ou símbolo",
      "duration": 3
    }
  ]
}

Tipos de cena:
A = Tela cheia com frase de impacto
B = Texto embaixo (apresentação)
C = Painel superior + rosto abaixo
D = Comparativo lado a lado
E = Card numerado com ícone
F = Mensagem estilo WhatsApp
G = Número em destaque
H = Fluxo de passos
I = Call to action

Crie entre 6 e 10 cenas bem distribuídas ao longo do vídeo.
Responda APENAS com o JSON, sem markdown.`;

  try {
    progress[jobId] = { step: "analyze", percent: 20, label: "Enviando para Claude..." };

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    progress[jobId] = { step: "analyze", percent: 90, label: "Processando resposta..." };

    const rawText = message.content[0].text.trim();
    const analysis = JSON.parse(rawText);
    jobs[jobId].analysis = analysis;
    progress[jobId] = { step: "analyze", percent: 100, label: "Análise concluída!" };

    res.json(analysis);
  } catch (err) {
    console.error("Analyze error:", err);
    progress[jobId] = { step: "analyze", percent: 0, error: err.message };
    res.status(500).json({ error: err.message });
  }
});

// GET /api/video/:jobId - serve with range support
app.get("/api/video/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  const videoPath = job.processedPath || job.originalPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Video file not found" });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(videoPath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

// GET /api/progress/:jobId
app.get("/api/progress/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.json(progress[jobId] || { step: "idle", percent: 0 });
});

// POST /api/render/:jobId
app.post("/api/render/:jobId", (req, res) => {
  // Remotion render - Em breve
  res.json({
    status: "pending",
    message: "Renderização via Remotion em breve disponível.",
  });
});

app.listen(PORT, () => {
  console.log(`Video Editor Server running on http://localhost:${PORT}`);
});
