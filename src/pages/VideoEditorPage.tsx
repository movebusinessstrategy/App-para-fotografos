import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Film, Loader2, AlertCircle, Play, Download,
  CheckCircle, X, ChevronRight, MessageSquare, RefreshCw,
  Sparkles, Eye, Scissors, Layers, Music, Type, Zap,
  GripVertical, Trash2, Plus, Edit3, ChevronDown, ChevronUp,
  Settings, Wand2, ArrowRight, Volume2,
} from "lucide-react";

// ─── API Config ────────────────────────────────────────────────────────────
const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const RENDER_ORIGIN = "https://app-para-fotografos.onrender.com";
const API_BASE = isLocal ? "/api/video-editor" : `${RENDER_ORIGIN}/api/video-editor`;

if (!isLocal) { fetch(`${RENDER_ORIGIN}/api/health`).catch(() => {}); }

// ─── Types ─────────────────────────────────────────────────────────────────
type Step = "upload" | "transcribing" | "analyzing" | "editor" | "rendering" | "done";
type SubtitleStyle = "highlight" | "karaoke" | "bounce" | "none";
type TransitionType = "none" | "fade" | "slide-left" | "slide-up" | "zoom-in" | "blur";

interface CaptionConfig {
  enabled: boolean;
  style: SubtitleStyle;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  color: string;
  highlightColor: string;
  strokeColor: string;
  strokeWidth: string;
  position: string;
  maxLength: number;
}

interface Scene {
  id: number;
  type: string;
  title: string;
  subtitle: string;
  icon: string;
  duration: number;
  startLeg: number;
  transition: TransitionType;
}

interface AnalysisResult {
  narrativeFormat: string;
  colorPalette: { primary: string; secondary: string; accent: string; background: string };
  scenes: Scene[];
}

interface SilenceCutConfig {
  enabled: boolean;
  gap: number;
  pad: number;
}

interface MusicConfig {
  enabled: boolean;
  volume: number;
  file: File | null;
}

interface ZoomConfig {
  enabled: boolean;
  intensity: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_CAPTIONS: CaptionConfig = {
  enabled: true, style: "highlight", fontSize: "9.29 vmin",
  fontFamily: "Montserrat", fontWeight: "700", color: "#ffffff",
  highlightColor: "#FFD700", strokeColor: "#000000",
  strokeWidth: "1.6 vmin", position: "80%", maxLength: 14,
};

const SUBTITLE_STYLES: { value: SubtitleStyle; label: string; desc: string; icon: string }[] = [
  { value: "highlight", label: "Destaque", desc: "Palavra atual fica colorida", icon: "✨" },
  { value: "karaoke", label: "Karaoke", desc: "Texto revela progressivamente", icon: "🎤" },
  { value: "bounce", label: "Bounce", desc: "Palavra pula ao aparecer", icon: "🔵" },
  { value: "none", label: "Sem legenda", desc: "Apenas o vídeo original", icon: "🚫" },
];

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: "none", label: "Sem transição" },
  { value: "fade", label: "Fade" },
  { value: "slide-left", label: "Slide ←" },
  { value: "slide-up", label: "Slide ↑" },
  { value: "zoom-in", label: "Zoom In" },
  { value: "blur", label: "Blur" },
];

const SCENE_TYPES: Record<string, { label: string; color: string }> = {
  A: { label: "Tela Cheia", color: "bg-blue-500" },
  B: { label: "Texto Embaixo", color: "bg-green-500" },
  C: { label: "Painel + Rosto", color: "bg-purple-500" },
  D: { label: "Comparativo", color: "bg-orange-500" },
  E: { label: "Card Numerado", color: "bg-pink-500" },
  F: { label: "WhatsApp", color: "bg-emerald-500" },
  G: { label: "Número Grande", color: "bg-red-500" },
  H: { label: "Fluxo", color: "bg-cyan-500" },
  I: { label: "CTA", color: "bg-yellow-500" },
};

const FONT_OPTIONS = [
  "Montserrat", "Inter", "Roboto", "Open Sans", "Poppins",
  "Oswald", "Bebas Neue", "Permanent Marker",
];

// ─── Component ─────────────────────────────────────────────────────────────
export default function VideoEditorPage() {
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [transcription, setTranscription] = useState("");
  const [segments, setSegments] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [captions, setCaptions] = useState<CaptionConfig>(DEFAULT_CAPTIONS);
  const [silenceCut, setSilenceCut] = useState<SilenceCutConfig>({ enabled: true, gap: 0.5, pad: 0.2 });
  const [music, setMusic] = useState<MusicConfig>({ enabled: false, volume: 15, file: null });
  const [zoom, setZoom] = useState<ZoomConfig>({ enabled: false, intensity: 0.05 });
  const [globalTransition, setGlobalTransition] = useState<TransitionType>("fade");

  const [activeTab, setActiveTab] = useState<"scenes" | "captions" | "effects" | "audio">("scenes");
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [renderMode, setRenderMode] = useState<"creatomate" | "local">("creatomate");

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

  // ─── Upload + Transcribe + Analyze pipeline ──────────────────────────────
  const handleStartPipeline = async () => {
    if (!selectedFile) return;
    setError(null);
    setResultUrl(null);

    try {
      // 1. Upload
      setStep("transcribing");
      setProgress(5);
      setProgressLabel("Enviando vídeo...");

      const fd = new FormData();
      fd.append("video", selectedFile);
      const uploadRes = await fetch(`${API_BASE}/upload`, { method: "POST", body: fd });
      if (!uploadRes.ok) throw new Error((await uploadRes.json().catch(() => ({}))).error || "Upload falhou");
      const { jobId: newJobId } = await uploadRes.json();
      setJobId(newJobId);
      setProgress(15);
      setProgressLabel("Transcrevendo áudio com Whisper...");

      // 2. Transcribe
      const transcRes = await fetch(`${API_BASE}/transcribe/${newJobId}`, { method: "POST" });
      if (!transcRes.ok) throw new Error((await transcRes.json().catch(() => ({}))).error || "Transcrição falhou");
      const transcData = await transcRes.json();
      setTranscription(transcData.text || "");
      setSegments(transcData.segments || []);
      setProgress(50);

      // 3. Analyze
      setStep("analyzing");
      setProgressLabel("IA analisando conteúdo...");
      const analyzeRes = await fetch(`${API_BASE}/analyze/${newJobId}`, { method: "POST" });
      if (!analyzeRes.ok) throw new Error((await analyzeRes.json().catch(() => ({}))).error || "Análise falhou");
      const analysisData = await analyzeRes.json();
      setAnalysis(analysisData);

      const scenesWithTransitions = (analysisData.scenes || []).map((s: any) => ({
        ...s,
        transition: globalTransition,
      }));
      setScenes(scenesWithTransitions);
      setProgress(100);
      setProgressLabel("Análise concluída!");

      // 4. Go to editor
      setTimeout(() => setStep("editor"), 500);
    } catch (err: any) {
      setError(err.message);
      setStep("upload");
    }
  };

  // ─── Upload music ────────────────────────────────────────────────────────
  const handleMusicUpload = async (file: File) => {
    if (!jobId) return;
    const fd = new FormData();
    fd.append("music", file);
    try {
      const res = await fetch(`${API_BASE}/music/${jobId}`, { method: "POST", body: fd });
      if (res.ok) {
        setMusic(prev => ({ ...prev, enabled: true, file }));
      }
    } catch {}
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  const handleRender = async () => {
    if (!jobId) return;
    setStep("rendering");
    setProgress(0);
    setError(null);
    setResultUrl(null);

    try {
      if (renderMode === "creatomate") {
        // Cloud render via Creatomate
        setProgressLabel("Enviando para renderização na nuvem...");
        setProgress(10);

        const renderRes = await fetch(`${API_BASE}/creatomate-render/${jobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captions: {
              ...captions,
              ...(captions.style === "highlight" ? { highlightColor: captions.highlightColor } : {}),
            },
            scenes,
            transition: globalTransition,
            silenceCut,
            zoom,
          }),
        });

        if (!renderRes.ok) {
          const err = await renderRes.json().catch(() => ({}));
          throw new Error(err.error || `Falha ao iniciar renderização (${renderRes.status})`);
        }
        setProgress(20);
        setProgressLabel("Processando na nuvem (transcrição + legendas + efeitos)...");

        // Poll
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE}/creatomate-status/${jobId}`);
            const statusData = await statusRes.json();

            if (statusData.status === "succeeded") {
              clearInterval(pollInterval);
              setProgress(100);
              setProgressLabel("Vídeo pronto! 🎉");
              setResultUrl(statusData.url);
              setStep("done");
            } else if (statusData.status === "failed") {
              clearInterval(pollInterval);
              throw new Error(statusData.error || "Erro na renderização.");
            } else {
              const pct = Math.min(20 + Math.round((statusData.progress || 0) * 75), 95);
              setProgress(pct);
              setProgressLabel(statusData.label || "Processando na nuvem...");
            }
          } catch (pollErr: any) {
            clearInterval(pollInterval);
            setError(pollErr.message);
            setStep("editor");
          }
        }, 3000);
      } else {
        // Local FFmpeg render
        setProgressLabel("Renderizando localmente...");
        setProgress(5);

        const renderRes = await fetch(`${API_BASE}/render/${jobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            effects: {
              silenceCut,
              zoom,
              captions: {
                enabled: captions.enabled && captions.style !== "none",
                fontSize: parseInt(captions.fontSize) || 28,
                color: captions.color,
                position: captions.position === "25%" ? "top" : captions.position === "50%" ? "middle" : "bottom",
              },
              music: { enabled: music.enabled, volume: music.volume },
            },
          }),
        });

        if (!renderRes.ok) throw new Error((await renderRes.json().catch(() => ({}))).error || "Render falhou");

        // Poll local render progress
        const pollInterval = setInterval(async () => {
          try {
            const progRes = await fetch(`${API_BASE}/render-progress/${jobId}`);
            const progData = await progRes.json();

            if (progData.status === "done") {
              clearInterval(pollInterval);
              setProgress(100);
              setProgressLabel("Vídeo pronto! 🎉");
              setResultUrl(`${API_BASE}/edited/${jobId}`);
              setStep("done");
            } else if (progData.status === "error") {
              clearInterval(pollInterval);
              throw new Error(progData.error || "Erro na renderização.");
            } else {
              setProgress(progData.percent || 0);
              setProgressLabel(progData.label || "Renderizando...");
            }
          } catch (pollErr: any) {
            clearInterval(pollInterval);
            setError(pollErr.message);
            setStep("editor");
          }
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message);
      setStep("editor");
    }
  };

  // ─── Scene management ────────────────────────────────────────────────────
  const updateScene = (id: number, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteScene = (id: number) => {
    setScenes(prev => prev.filter(s => s.id !== id));
  };

  const addScene = () => {
    const maxId = scenes.reduce((max, s) => Math.max(max, s.id), 0);
    setScenes(prev => [...prev, {
      id: maxId + 1, type: "B", title: "Nova cena", subtitle: "",
      icon: "📝", duration: 3, startLeg: 0, transition: globalTransition,
    }]);
  };

  const applyTransitionToAll = (t: TransitionType) => {
    setGlobalTransition(t);
    setScenes(prev => prev.map(s => ({ ...s, transition: t })));
  };

  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreviewUrl(null);
    setJobId(null);
    setProgress(0);
    setProgressLabel("");
    setResultUrl(null);
    setError(null);
    setTranscription("");
    setSegments([]);
    setAnalysis(null);
    setScenes([]);
  };

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // ─── Step Labels ─────────────────────────────────────────────────────────
  const stepLabels: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "transcribing", label: "Transcrição" },
    { key: "analyzing", label: "Análise IA" },
    { key: "editor", label: "Editor" },
    { key: "rendering", label: "Renderizando" },
    { key: "done", label: "Pronto" },
  ];
  const stepOrder = stepLabels.map(s => s.key);
  const currentIdx = stepOrder.indexOf(step);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Film className="text-indigo-500" size={28} />
            Editor de Reels Pro
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Upload → IA analisa → Edite cenas, legendas e efeitos → Renderize
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
      <div className="flex items-center gap-1 text-xs font-medium overflow-x-auto pb-1">
        {stepLabels.map((s, i) => {
          const isCurrent = s.key === step;
          const isDone = currentIdx > i;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <ChevronRight size={10} className="text-gray-300 dark:text-gray-600 flex-shrink-0" />}
              <span className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${
                isCurrent ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" :
                isDone ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300" :
                "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}>
                {isDone ? <CheckCircle size={10} /> : <span className="w-2.5 h-2.5 rounded-full border-2 border-current" />}
                {s.label}
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
          <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
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

          {selectedFile && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-black flex-shrink-0">
                  <video src={previewUrl!} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button onClick={handleStartPipeline}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/25">
                  <Wand2 size={18} />
                  Analisar com IA
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ STEP: TRANSCRIBING / ANALYZING ════════ */}
      {(step === "transcribing" || step === "analyzing") && (
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
              {step === "transcribing" ? "Extraindo áudio e transcrevendo com Whisper..." : "IA está analisando o conteúdo e criando cenas..."}
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

      {/* ════════ STEP: EDITOR ════════ */}
      {step === "editor" && (
        <div className="space-y-6">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
            <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              {analysis?.narrativeFormat && `Formato: ${analysis.narrativeFormat}`}
              {scenes.length > 0 && ` • ${scenes.length} cenas`}
              {segments.length > 0 && ` • ${segments.length} palavras`}
            </span>
            {analysis?.colorPalette && (
              <div className="flex gap-1 ml-auto">
                {Object.values(analysis.colorPalette).map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-white dark:border-gray-700 shadow-sm" style={{ backgroundColor: c }} />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Preview */}
            <div className="lg:col-span-1 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Eye size={14} /> Preview
              </h3>
              <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] max-h-[500px]">
                <video src={previewUrl!} controls className="w-full h-full object-contain" />
              </div>
              {transcription && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                    Ver transcrição completa
                  </summary>
                  <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 max-h-40 overflow-y-auto text-gray-600 dark:text-gray-400">
                    {transcription}
                  </div>
                </details>
              )}
            </div>

            {/* Right: Editor Tabs */}
            <div className="lg:col-span-2 space-y-4">
              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                {([
                  { key: "scenes", label: "Cenas", icon: Layers },
                  { key: "captions", label: "Legendas", icon: Type },
                  { key: "effects", label: "Efeitos", icon: Zap },
                  { key: "audio", label: "Áudio", icon: Music },
                ] as const).map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === tab.key
                        ? "bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}>
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── TAB: Scenes ── */}
              {activeTab === "scenes" && (
                <div className="space-y-3">
                  {/* Global transition */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">Transição global:</span>
                    <select value={globalTransition}
                      onChange={(e) => applyTransitionToAll(e.target.value as TransitionType)}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                      {TRANSITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>

                  {/* Scene list */}
                  <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
                    {scenes.map((scene, idx) => (
                      <div key={scene.id}
                        className={`p-3 rounded-xl border transition-all ${
                          editingScene === scene.id
                            ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10"
                            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                        }`}>
                        <div className="flex items-center gap-2">
                          <GripVertical size={14} className="text-gray-400 cursor-grab flex-shrink-0" />
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${SCENE_TYPES[scene.type]?.color || "bg-gray-500"}`}>
                            {scene.type}
                          </span>
                          <span className="text-sm mr-1">{scene.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{scene.title}</p>
                            {scene.subtitle && <p className="text-xs text-gray-500 truncate">{scene.subtitle}</p>}
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">{scene.duration}s</span>
                          <button onClick={() => setEditingScene(editingScene === scene.id ? null : scene.id)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                            <Edit3 size={12} className="text-gray-500" />
                          </button>
                          <button onClick={() => deleteScene(scene.id)}
                            className="p-1 hover:bg-red-100 dark:hover:bg-red-500/20 rounded">
                            <Trash2 size={12} className="text-red-400" />
                          </button>
                        </div>

                        {/* Edit panel */}
                        {editingScene === scene.id && (
                          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium text-gray-500">Título</label>
                                <input value={scene.title}
                                  onChange={(e) => updateScene(scene.id, { title: e.target.value })}
                                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-500">Subtítulo</label>
                                <input value={scene.subtitle}
                                  onChange={(e) => updateScene(scene.id, { subtitle: e.target.value })}
                                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs font-medium text-gray-500">Tipo</label>
                                <select value={scene.type}
                                  onChange={(e) => updateScene(scene.id, { type: e.target.value })}
                                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                                  {Object.entries(SCENE_TYPES).map(([k, v]) => (
                                    <option key={k} value={k}>{k} - {v.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-500">Duração (s)</label>
                                <input type="number" min={1} max={30} value={scene.duration}
                                  onChange={(e) => updateScene(scene.id, { duration: Number(e.target.value) })}
                                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-500">Transição</label>
                                <select value={scene.transition}
                                  onChange={(e) => updateScene(scene.id, { transition: e.target.value as TransitionType })}
                                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                                  {TRANSITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-500">Emoji</label>
                              <input value={scene.icon} maxLength={4}
                                onChange={(e) => updateScene(scene.id, { icon: e.target.value })}
                                className="mt-1 w-16 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center" />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button onClick={addScene}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors text-sm">
                    <Plus size={14} /> Adicionar cena
                  </button>
                </div>
              )}

              {/* ── TAB: Captions ── */}
              {activeTab === "captions" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {SUBTITLE_STYLES.map((s) => (
                      <button key={s.value}
                        onClick={() => setCaptions(prev => ({ ...prev, style: s.value, enabled: s.value !== "none" }))}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          captions.style === s.value
                            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                            : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                        }`}>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{s.icon} {s.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                      </button>
                    ))}
                  </div>

                  {captions.enabled && (
                    <div className="space-y-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Fonte</label>
                        <select value={captions.fontFamily}
                          onChange={(e) => setCaptions(prev => ({ ...prev, fontFamily: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                          {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cor texto</label>
                          <input type="color" value={captions.color}
                            onChange={(e) => setCaptions(prev => ({ ...prev, color: e.target.value }))}
                            className="mt-1 w-full h-10 rounded-lg cursor-pointer" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cor destaque</label>
                          <input type="color" value={captions.highlightColor}
                            onChange={(e) => setCaptions(prev => ({ ...prev, highlightColor: e.target.value }))}
                            className="mt-1 w-full h-10 rounded-lg cursor-pointer" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cor borda</label>
                          <input type="color" value={captions.strokeColor}
                            onChange={(e) => setCaptions(prev => ({ ...prev, strokeColor: e.target.value }))}
                            className="mt-1 w-full h-10 rounded-lg cursor-pointer" />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Máx. caracteres por linha: {captions.maxLength}
                        </label>
                        <input type="range" min={5} max={30} value={captions.maxLength}
                          onChange={(e) => setCaptions(prev => ({ ...prev, maxLength: Number(e.target.value) }))}
                          className="w-full mt-1" />
                      </div>

                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Posição</label>
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
                </div>
              )}

              {/* ── TAB: Effects ── */}
              {activeTab === "effects" && (
                <div className="space-y-4">
                  {/* Silence Cut */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={silenceCut.enabled}
                        onChange={(e) => setSilenceCut(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      <Scissors size={16} className="text-gray-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Cortar silêncios automaticamente</span>
                    </label>
                    {silenceCut.enabled && (
                      <div className="grid grid-cols-2 gap-3 pl-7">
                        <div>
                          <label className="text-xs text-gray-500">Gap mínimo (s): {silenceCut.gap.toFixed(1)}</label>
                          <input type="range" min={0.2} max={2} step={0.1} value={silenceCut.gap}
                            onChange={(e) => setSilenceCut(prev => ({ ...prev, gap: Number(e.target.value) }))}
                            className="w-full" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Padding (s): {silenceCut.pad.toFixed(1)}</label>
                          <input type="range" min={0.05} max={0.5} step={0.05} value={silenceCut.pad}
                            onChange={(e) => setSilenceCut(prev => ({ ...prev, pad: Number(e.target.value) }))}
                            className="w-full" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Zoom */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={zoom.enabled}
                        onChange={(e) => setZoom(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      <Zap size={16} className="text-gray-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Zoom lento (Ken Burns)</span>
                    </label>
                    {zoom.enabled && (
                      <div className="pl-7">
                        <label className="text-xs text-gray-500">Intensidade: {(zoom.intensity * 100).toFixed(0)}%</label>
                        <input type="range" min={1} max={30} value={zoom.intensity * 100}
                          onChange={(e) => setZoom(prev => ({ ...prev, intensity: Number(e.target.value) / 100 }))}
                          className="w-full" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── TAB: Audio ── */}
              {activeTab === "audio" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={music.enabled}
                        onChange={(e) => setMusic(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      <Music size={16} className="text-gray-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Música de fundo</span>
                    </label>

                    {music.enabled && (
                      <div className="space-y-3 pl-7">
                        <div>
                          <label className="text-xs text-gray-500">Volume: {music.volume}%</label>
                          <input type="range" min={1} max={100} value={music.volume}
                            onChange={(e) => setMusic(prev => ({ ...prev, volume: Number(e.target.value) }))}
                            className="w-full" />
                        </div>
                        <div>
                          <input type="file" accept="audio/*"
                            onChange={(e) => e.target.files?.[0] && handleMusicUpload(e.target.files[0])}
                            className="text-sm text-gray-500 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 dark:file:bg-indigo-500/20 file:text-indigo-600 file:text-xs file:font-medium" />
                          {music.file && (
                            <p className="text-xs text-green-600 mt-1">✓ {music.file.name}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Render mode + GO button */}
              <div className="space-y-3 pt-2">
                <div className="flex gap-2">
                  <button onClick={() => setRenderMode("creatomate")}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      renderMode === "creatomate"
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                        : "border-gray-200 dark:border-gray-700 text-gray-500"
                    }`}>
                    ☁️ Nuvem (Creatomate)
                  </button>
                  <button onClick={() => setRenderMode("local")}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      renderMode === "local"
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                        : "border-gray-200 dark:border-gray-700 text-gray-500"
                    }`}>
                    💻 Local (FFmpeg)
                  </button>
                </div>

                <button onClick={handleRender}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-base transition-all shadow-lg shadow-indigo-500/25">
                  <Sparkles size={20} />
                  Renderizar Vídeo
                </button>
                <p className="text-xs text-gray-400 text-center">
                  {renderMode === "creatomate"
                    ? "Legendas animadas + transcrição automática na nuvem. 1-5 min."
                    : "Corte de silêncio + zoom + legendas + música. Processamento local."
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ STEP: RENDERING ════════ */}
      {step === "rendering" && (
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Não feche esta aba</p>
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

          <div className="flex flex-col items-center space-y-4">
            <div className="rounded-2xl overflow-hidden bg-black max-w-sm w-full aspect-[9/16]">
              <video src={resultUrl} controls className="w-full h-full object-contain" />
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <a href={resultUrl} download target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/25">
              <Download size={16} /> Baixar Vídeo
            </a>
            <button onClick={() => setStep("editor")}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-semibold text-sm transition-colors">
              <Edit3 size={16} /> Ajustar e Renderizar de Novo
            </button>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-semibold text-sm transition-colors">
              <RefreshCw size={16} /> Novo Vídeo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
