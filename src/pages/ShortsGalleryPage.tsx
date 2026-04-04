import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckSquare,
  Download,
  Eye,
  Filter,
  Flame,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const RENDER_ORIGIN = 'https://app-para-fotografos.onrender.com';
const API_BASE = isLocal ? '/api/video-editor' : `${RENDER_ORIGIN}/api/video-editor`;

type ShortCategory = 'hook' | 'story' | 'tip' | 'emotional' | 'funny';
type SortKey = 'viralityScore' | 'estimatedDuration' | 'category';
type RenderStatus = 'idle' | 'rendering' | 'rendered' | 'completed' | 'failed';

interface GeneratedShort {
  id: string;
  title: string;
  viralityScore: number;
  hookStrength: number;
  emotionalImpact: number;
  valueDelivery: number;
  trendAlignment: number;
  hookText: string;
  clips: Array<{
    startTime: number;
    endTime: number;
    zoomConfig?: { startScale: number; endScale: number; focusX: number; focusY: number };
    transitionType: 'fade' | 'slide' | 'zoom-in' | 'cut';
  }>;
  suggestedCaption: string;
  suggestedHashtags: string[];
  estimatedDuration: number;
  thumbnailTimestamp: number;
  category: ShortCategory;
  captions: { enabled: boolean; style: string };
  brolls: any[];
  editedSupabaseUrl?: string;
  remotionRender?: { status: string; progress: number };
}

interface ShortRenderState {
  status: RenderStatus;
  progress: number;
  outputUrl: string | null;
}

const CATEGORY_LABELS: Record<ShortCategory, string> = {
  hook: 'Gancho',
  story: 'História',
  tip: 'Dica',
  emotional: 'Emocional',
  funny: 'Humor',
};

const CATEGORY_COLORS: Record<ShortCategory, string> = {
  hook: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  story: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  tip: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  emotional: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  funny: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
};

function ViralityBadge({ score }: { score: number }) {
  if (score >= 90) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500 text-white animate-pulse">
        <Flame size={11} /> {score} Viral!
      </span>
    );
  }
  if (score >= 70) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white">
        <TrendingUp size={11} /> {score} Alto
      </span>
    );
  }
  if (score >= 40) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900">
        <Zap size={11} /> {score} Médio
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      {score} Baixo
    </span>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const safeValue = Math.max(0, Math.min(25, Number(value) || 0));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <span>{safeValue}/25</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${(safeValue / 25) * 100}%` }}
        />
      </div>
    </div>
  );
}

function ShortCard({
  short,
  jobId,
  selected,
  onSelect,
  renderState,
  onRender,
}: {
  short: GeneratedShort;
  jobId: string;
  selected: boolean;
  onSelect: (id: string) => void;
  renderState: ShortRenderState;
  onRender: (id: string) => void;
}) {
  const navigate = useNavigate();
  const thumbnailUrl = `${API_BASE}/thumbnail/${jobId}?timestamp=${short.thumbnailTimestamp}`;

  const isRendering = renderState.status === 'rendering' || renderState.status === 'rendered';
  const isCompleted = renderState.status === 'completed' || !!short.editedSupabaseUrl;
  const outputUrl = renderState.outputUrl || short.editedSupabaseUrl || null;

  return (
    <div
      className={`relative rounded-2xl border transition-all duration-200 overflow-hidden bg-white dark:bg-gray-900 ${
        selected
          ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={() => onSelect(short.id)}
        className="absolute top-3 left-3 z-10 text-indigo-500"
      >
        {selected ? <CheckSquare size={20} /> : <Square size={20} className="text-gray-400" />}
      </button>

      {/* Thumbnail */}
      <div className="relative w-full aspect-[9/16] max-h-48 bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <img
          src={thumbnailUrl}
          alt={short.title}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Duration overlay */}
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono">
          {Math.round(short.estimatedDuration)}s
        </div>

        {/* Virality badge overlay */}
        <div className="absolute top-3 right-3">
          <ViralityBadge score={short.viralityScore} />
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2.5">
        {/* Title + category */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">
            {short.title}
          </h3>
          <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${CATEGORY_COLORS[short.category]}`}>
            {CATEGORY_LABELS[short.category]}
          </span>
        </div>

        {/* Hook text */}
        {short.hookText && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-2">
            "{short.hookText}"
          </p>
        )}

        {/* Score breakdown */}
        <div className="space-y-1.5">
          <ScoreBar label="Gancho" value={short.hookStrength} color="bg-purple-500" />
          <ScoreBar label="Emoção" value={short.emotionalImpact} color="bg-pink-500" />
          <ScoreBar label="Valor" value={short.valueDelivery} color="bg-blue-500" />
          <ScoreBar label="Trend" value={short.trendAlignment} color="bg-green-500" />
        </div>

        {/* Hashtags */}
        {short.suggestedHashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {short.suggestedHashtags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                onClick={() => navigator.clipboard.writeText(tag).catch(() => {})}
              >
                {tag}
              </span>
            ))}
            {short.suggestedHashtags.length > 4 && (
              <span className="text-[10px] text-gray-400">+{short.suggestedHashtags.length - 4}</span>
            )}
          </div>
        )}

        {/* Render progress */}
        {isRendering && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                style={{ width: `${renderState.progress}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400">Renderizando... {renderState.progress}%</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => navigate(`/video-preview/${jobId}/${short.id}`)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium transition-colors"
          >
            <Eye size={13} />
            Preview
          </button>

          {isCompleted && outputUrl ? (
            <a
              href={outputUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-white text-xs font-medium transition-colors"
            >
              <Download size={13} />
              Baixar
            </a>
          ) : (
            <button
              onClick={() => onRender(short.id)}
              disabled={isRendering}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
            >
              {isRendering ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {isRendering ? 'Rendering' : 'Renderizar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShortsGalleryPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [shorts, setShorts] = useState<GeneratedShort[]>([]);
  const [filename, setFilename] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<ShortCategory | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('viralityScore');
  const [renderStates, setRenderStates] = useState<Record<string, ShortRenderState>>({});
  const [batchRendering, setBatchRendering] = useState(false);
  const pollRef = React.useRef<number | null>(null);

  const loadShorts = useCallback(async (forceRefresh = false) => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/shorts/${jobId}${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar shorts.');
      setShorts(data.shorts || []);
      setFilename(data.filename || 'vídeo');
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar shorts.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadShorts();
  }, [loadShorts]);

  // Poll render progress for active renders
  useEffect(() => {
    if (!jobId) return;

    const hasActive = (Object.values(renderStates) as ShortRenderState[]).some(
      (s) => s.status === 'rendering' || s.status === 'rendered'
    );
    if (!hasActive) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }

    if (pollRef.current) return;

    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/batch-progress/${jobId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;

        const updates: Record<string, ShortRenderState> = {};
        for (const item of data.shorts || []) {
          updates[item.shortId] = {
            status: item.status as RenderStatus,
            progress: item.progress ?? 0,
            outputUrl: item.outputUrl || null,
          };
        }
        setRenderStates((prev) => ({ ...prev, ...updates }));
      } catch { /* ignore */ }
    }, 3000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, renderStates]);

  const handleRenderOne = useCallback(async (shortId: string) => {
    if (!jobId) return;
    setRenderStates((prev) => ({ ...prev, [shortId]: { status: 'rendering', progress: 0, outputUrl: null } }));
    try {
      const res = await fetch(`${API_BASE}/render-short/${jobId}/${shortId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRenderStates((prev) => ({ ...prev, [shortId]: { status: 'failed', progress: 0, outputUrl: null } }));
        setError(data.error || 'Falha ao iniciar renderização.');
      }
    } catch (e: any) {
      setRenderStates((prev) => ({ ...prev, [shortId]: { status: 'failed', progress: 0, outputUrl: null } }));
    }
  }, [jobId]);

  const handleBatchRender = useCallback(async () => {
    if (!jobId || selectedIds.size === 0) return;
    setBatchRendering(true);
    const ids: string[] = [...selectedIds];
    const initStates: Record<string, ShortRenderState> = {};
    ids.forEach((id) => { initStates[id] = { status: 'rendering', progress: 0, outputUrl: null }; });
    setRenderStates((prev) => ({ ...prev, ...initStates }));

    try {
      const res = await fetch(`${API_BASE}/render-batch/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || 'Falha no batch render.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBatchRendering(false);
    }
  }, [jobId, selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => prev.size === shorts.length ? new Set() : new Set(shorts.map((s) => s.id)));
  }, [shorts]);

  const filtered = useMemo(() => {
    let list = filterCategory === 'all' ? shorts : shorts.filter((s) => s.category === filterCategory);
    list = [...list].sort((a, b) => {
      if (sortKey === 'viralityScore') return b.viralityScore - a.viralityScore;
      if (sortKey === 'estimatedDuration') return a.estimatedDuration - b.estimatedDuration;
      return a.category.localeCompare(b.category);
    });
    return list;
  }, [shorts, filterCategory, sortKey]);

  const allSelected = shorts.length > 0 && selectedIds.size === shorts.length;
  const anySelected = selectedIds.size > 0;

  const activeRenders = (Object.values(renderStates) as ShortRenderState[]).filter(
    (s) => s.status === 'rendering' || s.status === 'rendered'
  ).length;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/video-editor')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm transition-colors"
          >
            <ArrowLeft size={15} />
            Voltar
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Sparkles size={20} className="text-indigo-500" />
              Shorts Gerados
            </h1>
            {filename && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-xs">{filename}</p>
            )}
          </div>
        </div>

        <button
          onClick={() => loadShorts(true)}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Regenerar
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
          <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">
            IA analisando vídeo e gerando shorts virais...
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">
            Isso pode levar alguns segundos.
          </p>
        </div>
      )}

      {!loading && shorts.length > 0 && (
        <>
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800">
            {/* Select all */}
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              {allSelected ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} />}
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>

            <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />

            {/* Filter by category */}
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-gray-400" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as ShortCategory | 'all')}
                className="text-sm px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="all">Todas as categorias</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <TrendingUp size={14} className="text-gray-400" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="text-sm px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="viralityScore">Viralidade</option>
                <option value="estimatedDuration">Duração</option>
                <option value="category">Categoria</option>
              </select>
            </div>

            <div className="flex-1" />

            {/* Active renders indicator */}
            {activeRenders > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                <Loader2 size={12} className="animate-spin" />
                {activeRenders} renderizando
              </span>
            )}

            {/* Batch render */}
            {anySelected && (
              <button
                onClick={handleBatchRender}
                disabled={batchRendering}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {batchRendering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Renderizar {selectedIds.size} short{selectedIds.size !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Stats summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{shorts.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Shorts gerados</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-center">
              <p className="text-2xl font-bold text-orange-500">{shorts.filter((s) => s.viralityScore >= 90).length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Virais (90+)</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-center">
              <p className="text-2xl font-bold text-green-500">{shorts.filter((s) => s.viralityScore >= 70).length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Alto impacto</p>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {Math.round(shorts.reduce((acc, s) => acc + s.estimatedDuration, 0) / shorts.length)}s
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Duração média</p>
            </div>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((short) => (
              <div key={short.id} style={{ display: 'contents' }}>
                <ShortCard
                  short={short}
                  jobId={jobId!}
                  selected={selectedIds.has(short.id)}
                  onSelect={toggleSelect}
                  renderState={renderStates[short.id] || { status: 'idle', progress: 0, outputUrl: null }}
                  onRender={handleRenderOne}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && shorts.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3 text-center">
          <Sparkles size={40} className="text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">Nenhum short encontrado.</p>
          <button
            onClick={() => loadShorts(true)}
            className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-400 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}
