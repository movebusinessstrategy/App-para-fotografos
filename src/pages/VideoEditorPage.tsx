import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Film, Loader2, AlertCircle, Play, Download,
  CheckCircle, X, ChevronRight, MessageSquare, RefreshCw,
  Sparkles, Eye, Scissors, ZoomIn, Image, Volume2, Layers,
} from "lucide-react";

// ─── API Config ────────────────────────────────────────────────────────────
const isLocal = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const RENDER_ORIGIN = "https://app-para-fotografos.onrender.com";
const API_BASE = isLocal ? "/api/video-editor" : `${RENDER_ORIGIN}/api/video-editor`;

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

interface EditOptions {
  autoCut: boolean;
  dynamicZoom: boolean;
  broll: boolean;
  sfx: boolean;
  transitions: boolean;
  transitionType: string;
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

const DEFAULT_EDIT_OPTIONS: EditOptions = {
  autoCut: true,
  dynamicZoom: true,
  broll: false,
  sfx: false,
  transitions: true,
  transitionType: "fade",
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

const TRANSITION_OPTIONS = [
  { value: "fade", label: "Fade" },
  { value: "slide-left", label: "Slide ←" },
  { value: "slide-right", label: "Slide →" },
  { value: "zoom-in", label: "Zoom In" },
];

const EDIT_FEATURES: { key: keyof EditOptions; icon: any; label: string; desc: string; color: string }[] = [
  { key: "autoCut", icon: Scissors, label: "Cortes Automáticos", desc: "Remove silêncios longos", color: "text-red-500" },
  { key: "dynamicZoom", icon: ZoomIn, label: "Zoom Dinâmico", desc: "Zoom sutil em palavras-chave", color: "text-blue-500" },
  { key: "broll", icon: Image, label: "B-Roll", desc: "Imagens de apoio automáticas", color: "text-green-500" },
  { key: "sfx", icon: Volume2, label: "Efeitos Sonoros", desc: "Whoosh, pop em transições", color: "text-purple-500" },
  { key: "transitions", icon: Layers, label: "Transições", desc: "Fade, slide entre cortes", color: "text-orange-500" },
];

// ─── Component ─────────────────────────────────────────────────────────────
export default function VideoEditorPage() {
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastJobs, setPastJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [restoringJob, setRestoringJob] = useState<string | null>(null);

  // Fetch past jobs on mount and when returning to upload step
  useEffect(() => {
    if (step === "upload") {
      setLoadingJobs(true);
      fetch(`${API_BASE}/jobs`)
        .then(r => r.json())
        .then(data => setPastJobs(data.jobs || []))
        .catch(() => {})
        .finally(() => setLoadingJobs(false));
    }
  }, [step]);

  const handleRestoreJob = async (oldJobId: string) => {
    setRestoringJob(oldJobId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/restore/${oldJobId}`);
      if (!res.ok) throw new Error("Job não encontrado");
      const data = await res.json();
      
      // Se já tem vídeo editado, ir direto pro resultado
      if (data.hasEdited) {
        setJobId(oldJobId);
        // Buscar a URL do editado
        const editedUrl = `${API_BASE}/edited/${oldJobId}`;
        setResultUrl(editedUrl);
        setStep("done");
      } else {
        // Tem transcrição mas não editou ainda — re-renderizar
        setJobId(oldJobId);
        setStep("processing");
        setProgress(10);
        setProgressLabel("Re-processando vídeo...");
        
        const renderRes = await fetch(`${API_BASE}/creatomate-render/${oldJobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captions, editOptions: editOpts }),
        });
        if (!renderRes.ok) throw new Error("Falha ao iniciar renderização");
        
        setProgress(15);
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE}/creatomate-status/${oldJobId}`);
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
              setProgress(statusData.progress || 15);
              setProgressLabel(statusData.label || "Processando...");
            }
          } catch (pollErr: any) {
            clearInterval(pollInterval);
            setError(pollErr.message);
            setStep("upload");
          }
        }, 2500);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRestoringJob(null);
    }
  };

  const handleDeleteJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Excluir este vídeo do histórico?")) return;
    try {
      await fetch(`${API_BASE}/job/${jobId}`, { method: "DELETE" });
      setPastJobs(prev => prev.filter(j => j.jobId !== jobId));
    } catch { /* ignore */ }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [captions, setCaptions] = useState<CaptionConfig>(DEFAULT_CAPTIONS);
  const [editOpts, setEditOpts] = useState<EditOptions>(DEFAULT_EDIT_OPTIONS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<"edits" | "captions">("edits");

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
      setProgress(10);
      setProgressLabel("Vídeo enviado! Iniciando pipeline de edição...");

      // 2. Request Creatomate render with edit options
      const renderRes = await fetch(`${API_BASE}/creatomate-render/${currentJobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captions, editOptions: editOpts }),
      });
      if (!renderRes.ok) {
        const errData = await renderRes.json().catch(() => ({}));
        throw new Error(errData.error || `Falha ao iniciar renderização (${renderRes.status})`);
      }
      setProgress(15);

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
            setProgress(statusData.progress || 15);
            setProgressLabel(statusData.label || "Processando...");
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setError(pollErr.message);
          setStep("upload");
        }
      }, 2500);

    } catch (err: any) {
      setError(err.message);
      setStep("upload");
    }
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
  };

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const hasAnyAdvanced = editOpts.autoCut || editOpts.dynamicZoom || editOpts.broll || editOpts.sfx || editOpts.transitions;
  const activeCount = EDIT_FEATURES.filter(f => editOpts[f.key]).length;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Film className="text-indigo-500" size={28} />
            Editor de Reels
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Upload → IA analisa → Cortes + Zoom + B-roll + Legendas automáticas
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
          const labels = ["Upload & Configurar", "Processando IA", "Pronto"];
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
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Video Preview — 2 cols */}
              <div className="lg:col-span-2 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Eye size={14} /> Preview
                </h2>
                <div className="rounded-xl overflow-hidden bg-black w-full">
                  <video src={previewUrl!} controls className="w-full h-auto max-h-[420px] block" />
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Film size={12} />
                  {selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>

              {/* Config Panel — 3 cols */}
              <div className="lg:col-span-3 space-y-4">
                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                  <button
                    onClick={() => setActiveTab("edits")}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === "edits"
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}>
                    <Scissors size={14} />
                    Edição IA
                    {activeCount > 0 && (
                      <span className="px-1.5 py-0.5 text-xs bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-full">
                        {activeCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab("captions")}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === "captions"
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}>
                    <MessageSquare size={14} />
                    Legendas
                  </button>
                </div>

                {/* ─── TAB: EDIÇÃO IA ─── */}
                {activeTab === "edits" && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      A IA analisa a transcrição do vídeo e aplica edições automaticamente.
                    </p>

                    {/* Feature toggles */}
                    {EDIT_FEATURES.map((feat) => {
                      const Icon = feat.icon;
                      const isOn = editOpts[feat.key] as boolean;
                      return (
                        <button
                          key={feat.key}
                          onClick={() => setEditOpts(prev => ({ ...prev, [feat.key]: !prev[feat.key] }))}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                            isOn
                              ? "border-indigo-500 bg-indigo-50/80 dark:bg-indigo-500/10"
                              : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}>
                          <div className={`p-2 rounded-lg ${isOn ? "bg-indigo-100 dark:bg-indigo-500/20" : "bg-gray-100 dark:bg-gray-800"}`}>
                            <Icon size={16} className={isOn ? feat.color : "text-gray-400"} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${isOn ? "text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"}`}>
                              {feat.label}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-500">{feat.desc}</p>
                          </div>
                          <div className={`w-10 h-6 rounded-full flex items-center transition-colors ${isOn ? "bg-indigo-500 justify-end" : "bg-gray-300 dark:bg-gray-600 justify-start"}`}>
                            <div className="w-4.5 h-4.5 m-0.5 bg-white rounded-full shadow-sm" style={{ width: 18, height: 18, margin: 3 }} />
                          </div>
                        </button>
                      );
                    })}

                    {/* Transition type selector */}
                    {editOpts.transitions && (
                      <div className="pl-12">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Tipo de transição</label>
                        <div className="flex gap-2 mt-1">
                          {TRANSITION_OPTIONS.map(t => (
                            <button key={t.value}
                              onClick={() => setEditOpts(prev => ({ ...prev, transitionType: t.value }))}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                editOpts.transitionType === t.value
                                  ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/30"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                              }`}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Info box */}
                    {hasAnyAdvanced && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                        <Sparkles size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          A IA vai transcrever o áudio com Whisper, analisar o conteúdo e aplicar {activeCount} efeito{activeCount !== 1 ? "s" : ""} automaticamente.
                          Pode levar 2-5 minutos extras.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── TAB: LEGENDAS ─── */}
                {activeTab === "captions" && (
                  <div className="space-y-3">
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
                            <div>
                              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Fonte</label>
                              <select value={captions.fontFamily}
                                onChange={(e) => setCaptions(prev => ({ ...prev, fontFamily: e.target.value }))}
                                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                              </select>
                            </div>

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

                            <div>
                              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                Máx. caracteres por linha: {captions.maxLength}
                              </label>
                              <input type="range" min={5} max={30} value={captions.maxLength}
                                onChange={(e) => setCaptions(prev => ({ ...prev, maxLength: Number(e.target.value) }))}
                                className="w-full mt-1" />
                            </div>

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
                  </div>
                )}

                {/* Summary chips */}
                <div className="flex flex-wrap gap-1.5">
                  {captions.enabled && (
                    <span className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded-full">
                      ✏️ {SUBTITLE_STYLES.find(s => s.value === captions.style)?.label}
                    </span>
                  )}
                  {EDIT_FEATURES.filter(f => editOpts[f.key]).map(f => (
                    <span key={f.key} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full">
                      {f.label}
                    </span>
                  ))}
                </div>

                {/* GO button */}
                <button onClick={handleProcess}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-base transition-all shadow-lg shadow-indigo-500/25 active:scale-[0.98]">
                  <Sparkles size={20} />
                  {hasAnyAdvanced ? "Gerar Reels com IA 🚀" : "Gerar Reels com Legendas"}
                </button>

                <p className="text-xs text-gray-400 text-center">
                  {hasAnyAdvanced
                    ? "Pipeline: Upload → Whisper → GPT-4o → Pexels → Creatomate. ~3-7 min."
                    : "O vídeo será processado na nuvem. ~1-3 min."
                  }
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
              Não feche esta aba — pipeline rodando na nuvem
            </p>
          </div>

          <div className="w-full max-w-md">
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Pipeline steps visualization */}
          {hasAnyAdvanced && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className={progress >= 10 ? "text-green-500" : ""}>Upload</span>
              <span>→</span>
              <span className={progress >= 20 ? "text-green-500" : ""}>Whisper</span>
              <span>→</span>
              <span className={progress >= 35 ? "text-green-500" : ""}>GPT-4o</span>
              <span>→</span>
              <span className={progress >= 45 ? "text-green-500" : ""}>B-roll</span>
              <span>→</span>
              <span className={progress >= 65 ? "text-green-500" : ""}>Render</span>
              <span>→</span>
              <span className={progress >= 100 ? "text-green-500" : ""}>✓</span>
            </div>
          )}
        </div>
      )}

      
      {/* ════════ HISTÓRICO DE JOBS ════════ */}
      {step === "upload" && pastJobs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-indigo-500" />
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Recentes ({pastJobs.length})
            </h3>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {pastJobs.map((job: any) => (
              <div
                key={job.jobId}
                onClick={() => handleRestoreJob(job.jobId)}
                className="relative flex-shrink-0 w-20 cursor-pointer group"
              >
                {/* Thumbnail */}
                <div className="w-20 h-28 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 group-hover:border-indigo-400 transition-colors">
                  {job.thumbnailUrl ? (
                    <img src={job.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film size={16} className="text-gray-400" />
                    </div>
                  )}
                  {/* Overlay de status */}
                  {job.hasEdited && (
                    <div className="absolute top-1 left-1">
                      <CheckCircle size={12} className="text-green-400 drop-shadow" />
                    </div>
                  )}
                  {/* Botão excluir */}
                  <button
                    onClick={(e) => handleDeleteJob(job.jobId, e)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <X size={10} />
                  </button>
                </div>
                {/* Nome */}
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate text-center">
                  {(job.filename || "video").replace(/\.[^.]+$/, "").slice(0, 10)}
                </p>
                {/* Loading overlay */}
                {restoringJob === job.jobId && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded-lg">
                    <Loader2 className="animate-spin text-indigo-500" size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════ STEP: DONE ════════ */}
      {step === "done" && resultUrl && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
            <CheckCircle className="text-green-600 dark:text-green-400" size={20} />
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                Vídeo editado com sucesso! 🎉
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                {activeCount > 0 ? `${activeCount} efeito${activeCount > 1 ? "s" : ""} de IA aplicado${activeCount > 1 ? "s" : ""}` : "Legendas aplicadas"}
                {captions.enabled ? " + legendas animadas" : ""}
              </p>
            </div>
          </div>

          <div style={{ width: '100%' }}>
            <div style={{ width: '100%', borderRadius: '1rem', overflow: 'hidden', background: '#000' }}>
              <video
                src={resultUrl}
                controls
                playsInline
                style={{ display: 'block', width: '100%', maxHeight: '80vh' }}
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <a href={resultUrl} download target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-500/25">
              <Download size={16} /> Baixar Vídeo
            </a>
            <a href={resultUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 font-semibold text-sm transition-colors">
              <Eye size={16} /> Abrir no navegador
            </a>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-semibold text-sm transition-colors">
              <RefreshCw size={16} /> Editar Outro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
