import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Film, Loader2, AlertCircle, Play, Download,
  CheckCircle, X, ChevronRight, MessageSquare, RefreshCw,
  Sparkles, Eye,
} from "lucide-react";

// ─── API Config ────────────────────────────────────────────────────────────
const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const RENDER_ORIGIN = "https://app-para-fotografos.onrender.com";
const API_BASE = isLocal ? "/api/video-editor" : `${RENDER_ORIGIN}/api/video-editor`;

// Warm up Render free tier
if (!isLocal) { fetch(`${RENDER_ORIGIN}/api/health`).catch(() => {}); }

// ─── Types ─────────────────────────────────────────────────────────────────
type Step = "upload" | "processing" | "done";
type SubtitleStyle = "highlight" | "karaoke" | "bounce" | "none";

interface CaptionConfig {
  enabled: boolean;
  style: SubtitleStyle;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  color: string;
  strokeColor: string;
  strokeWidth: string;
  position: string;
  maxLength: number;
}

const DEFAULT_CAPTIONS: CaptionConfig = {
  enabled: true,
  style: "highlight",
  fontSize: "9.29 vmin",
  fontFamily: "Montserrat",
  fontWeight: "700",
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: "1.6 vmin",
  position: "80%",
  maxLength: 14,
};

const SUBTITLE_STYLES: { value: SubtitleStyle; label: string; desc: string }[] = [
  { value: "highlight", label: "Destaque", desc: "Palavra atual fica colorida" },
  { value: "karaoke", label: "Karaoke", desc: "Texto revela progressivamente" },
  { value: "bounce", label: "Bounce", desc: "Palavra pula ao aparecer" },
  { value: "none", label: "Sem legenda", desc: "Apenas o vídeo original" },
];

const FONT_OPTIONS = [
  "Montserrat", "Inter", "Roboto", "Open Sans", "Poppins",
  "Oswald", "Bebas Neue", "Permanent Marker",
];

// ─── Component ─────────────────────────────────────────────────────────────
export default function VideoEditorPage() {
  // Upload
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Processing
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Caption config
  const [captions, setCaptions] = useState<CaptionConfig>(DEFAULT_CAPTIONS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ─── File Selection ──────────────────────────────────────────────────────
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Selecione um arquivo de vídeo (MP4, MOV, etc.)");
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setResultUrl(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  // ─── Process Video ───────────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!selectedFile) return;
    setStep("processing");
    setProgress(0);
    setProgressLabel("Enviando vídeo...");
    setError(null);
    setResultUrl(null);

    try {
      // 1. Upload
      const fd = new FormData();
      fd.append("video", selectedFile);
      const uploadRes = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || `Upload falhou (${uploadRes.status})`);
      }
      const { jobId: currentJobId } = await uploadRes.json();
      setJobId(currentJobId);
      setProgress(15);
      setProgressLabel("Vídeo enviado! Iniciando edição na nuvem...");

      // 2. Request Creatomate render
      const renderRes = await fetch(`${API_BASE}/creatomate-render/${currentJobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captions }),
      });
      if (!renderRes.ok) {
        const errData = await renderRes.json().catch(() => ({}));
        throw new Error(errData.error || `Falha ao iniciar renderização (${renderRes.status})`);
      }
      setProgress(25);
      setProgressLabel("Processando na nuvem (transcrição + legendas)...");

      // 3. Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/creatomate-status/${currentJobId}`);
          const statusData = await statusRes.json();

          if (statusData.status === "succeeded") {
            clearInterval(pollInterval);
            setProgress(100);
            setProgressLabel("Vídeo pronto! 🎉");
            setResultUrl(statusData.url);
            setStep("done");
          } else if (statusData.status === "failed") {
            clearInterval(pollInterval);
            throw new Error(statusData.error || "Erro na renderização do vídeo.");
          } else {
            // processing
            const pct = Math.min(25 + Math.round((statusData.progress || 0) * 70), 95);
            setProgress(pct);
            setProgressLabel(statusData.label || "Processando na nuvem...");
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setError(pollErr.message);
          setStep("upload");
        }
      }, 3000);

    } catch (err: any) {
      setError(err.message);
      setStep("upload");
    }
  };

  // ─── Reset ───────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreviewUrl(null);
    setJobId(null);
    setProgress(0);
    setProgressLabel("");
    setResultUrl(null);
    setError(null);
  };

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Film className="text-indigo-500" size={28} />
            Editor de Reels
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Faça upload do seu vídeo e gere legendas animadas automaticamente
          </p>
        </div>
        {step !== "upload" && (
          <button onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm transition-colors">
            <RefreshCw size={14} /> Novo vídeo
          </button>
        )}
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(["upload", "processing", "done"] as Step[]).map((s, i) => {
          const labels = ["Upload", "Processando", "Pronto"];
          const isCurrent = s === step;
          const isDone = ["upload", "processing", "done"].indexOf(step) > i;
          return (
            <React.Fragment key={s}>
              {i > 0 && <ChevronRight size={12} className="text-gray-300 dark:text-gray-600" />}
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
                isCurrent ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" :
                isDone ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300" :
                "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}>
                {isDone ? <CheckCircle size={12} /> : <span className="w-3 h-3 rounded-full border-2 border-current" />}
                {labels[i]}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle size={18} className="flex-shrink-0" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {/* ════════ STEP: UPLOAD ════════ */}
      {step === "upload" && (
        <div className="space-y-6">
          {/* Drop zone */}
          <div ref={dropRef} onDrop={onDrop} onDragOver={onDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-10 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 transition-all group">
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            <Upload size={40} className="mx-auto text-gray-400 group-hover:text-indigo-500 transition-colors mb-4" />
            <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              Arraste seu vídeo aqui ou clique para selecionar
            </p>
            <p className="text-sm text-gray-400 mt-2">MP4, MOV, AVI — até 500MB</p>
          </div>

          {/* Preview + Config */}
          {selectedFile && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Video Preview */}
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Eye size={14} /> Preview
                </h2>
                <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] max-h-[500px]">
                  <video src={previewUrl!} controls className="w-full h-full object-contain" />
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Film size={12} />
                  {selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>

              {/* Caption Config */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <MessageSquare size={14} /> Configurar Legendas
                </h2>

                {/* Style selector */}
                <div className="grid grid-cols-2 gap-2">
                  {SUBTITLE_STYLES.map((s) => (
                    <button key={s.value}
                      onClick={() => setCaptions(prev => ({ ...prev, style: s.value, enabled: s.value !== "none" }))}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        captions.style === s.value
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}>
                      <p className={`text-sm font-semibold ${captions.style === s.value ? "text-indigo-700 dark:text-indigo-300" : "text-gray-700 dark:text-gray-300"}`}>
                        {s.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Advanced options */}
                {captions.enabled && (
                  <>
                    <button onClick={() => setShowAdvanced(!showAdvanced)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                      {showAdvanced ? "▾ Ocultar opções avançadas" : "▸ Opções avançadas"}
                    </button>

                    {showAdvanced && (
                      <div className="space-y-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
                        {/* Font */}
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Fonte</label>
                          <select value={captions.fontFamily}
                            onChange={(e) => setCaptions(prev => ({ ...prev, fontFamily: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                            {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>

                        {/* Colors */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cor do texto</label>
                            <input type="color" value={captions.color}
                              onChange={(e) => setCaptions(prev => ({ ...prev, color: e.target.value }))}
                              className="mt-1 w-full h-10 rounded-lg cursor-pointer" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cor da borda</label>
                            <input type="color" value={captions.strokeColor}
                              onChange={(e) => setCaptions(prev => ({ ...prev, strokeColor: e.target.value }))}
                              className="mt-1 w-full h-10 rounded-lg cursor-pointer" />
                          </div>
                        </div>

                        {/* Max words */}
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                            Máx. caracteres por linha: {captions.maxLength}
                          </label>
                          <input type="range" min={5} max={30} value={captions.maxLength}
                            onChange={(e) => setCaptions(prev => ({ ...prev, maxLength: Number(e.target.value) }))}
                            className="w-full mt-1" />
                        </div>

                        {/* Position */}
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Posição vertical</label>
                          <select value={captions.position}
                            onChange={(e) => setCaptions(prev => ({ ...prev, position: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                            <option value="25%">Topo</option>
                            <option value="50%">Centro</option>
                            <option value="80%">Embaixo (padrão)</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* GO button */}
                <button onClick={handleProcess}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base transition-colors shadow-lg shadow-indigo-500/25">
                  <Sparkles size={20} />
                  Gerar Reels com Legendas
                </button>

                <p className="text-xs text-gray-400 text-center">
                  O vídeo será processado na nuvem. Pode levar de 1 a 5 minutos dependendo do tamanho.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ STEP: PROCESSING ════════ */}
      {step === "processing" && (
        <div className="flex flex-col items-center justify-center py-16 space-y-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-full border-4 border-gray-200 dark:border-gray-700" />
            <svg className="absolute inset-0 w-24 h-24 -rotate-90" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 44}`}
                strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress / 100)}`}
                className="text-indigo-500 transition-all duration-500" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {progress}%
            </span>
          </div>

          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{progressLabel}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Não feche esta aba — o processamento é feito na nuvem pelo Creatomate
            </p>
          </div>

          <div className="w-full max-w-md">
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* ════════ STEP: DONE ════════ */}
      {step === "done" && resultUrl && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
            <CheckCircle className="text-green-600 dark:text-green-400" size={20} />
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">
              Vídeo editado com sucesso! 🎉
            </p>
          </div>

          {/* Result preview */}
          <div className="flex flex-col items-center space-y-4">
            <div className="rounded-2xl overflow-hidden bg-black max-w-sm w-full aspect-[9/16]">
              <video src={resultUrl} controls className="w-full h-full object-contain" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap justify-center gap-3">
            <a href={resultUrl} download target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/25">
              <Download size={16} /> Baixar Vídeo Editado
            </a>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-semibold text-sm transition-colors">
              <RefreshCw size={16} /> Editar Outro Vídeo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
