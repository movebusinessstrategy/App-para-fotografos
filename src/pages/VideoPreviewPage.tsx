import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Loader2, Sparkles } from 'lucide-react';
import { Player } from '@remotion/player';
import { useNavigate, useParams } from 'react-router-dom';
import VideoComposition from '../remotion/compositions/VideoComposition';
import type { VideoCompositionProps } from '../remotion/compositions/types';

const isLocal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const RENDER_ORIGIN = 'https://app-para-fotografos.onrender.com';
const API_BASE = isLocal ? '/api/video-editor' : `${RENDER_ORIGIN}/api/video-editor`;

type RenderStatus = 'idle' | 'rendering' | 'rendered' | 'completed' | 'failed';

interface PreviewResponse extends VideoCompositionProps {
  width: number;
  height: number;
  fps: number;
  duration: number;
  editedUrl?: string | null;
}

export default function VideoPreviewPage() {
  const { jobId, shortId } = useParams<{ jobId: string; shortId?: string }>();
  const navigate = useNavigate();

  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderProgress, setRenderProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderId, setRenderId] = useState<string | null>(null);
  const [shortIds, setShortIds] = useState<string[]>([]);

  const pollRef = useRef<number | null>(null);
  const finalizingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const finalizeRender = useCallback(async () => {
    if (!jobId || finalizingRef.current) return;
    finalizingRef.current = true;

    try {
      const doneRes = await fetch(`${API_BASE}/render-done/${jobId}`, { method: 'POST' });
      const doneData = await doneRes.json().catch(() => ({}));
      if (!doneRes.ok) {
        throw new Error(doneData.error || 'Falha ao finalizar renderização.');
      }

      setOutputUrl(doneData.outputUrl || null);
      setRenderStatus('completed');
      setRenderProgress(100);
      setRendering(false);
      stopPolling();
    } catch (e: any) {
      setError(e.message || 'Erro ao finalizar renderização.');
      setRenderStatus('failed');
      setRendering(false);
      stopPolling();
    } finally {
      finalizingRef.current = false;
    }
  }, [jobId, stopPolling]);

  const checkProgress = useCallback(async (): Promise<RenderStatus | null> => {
    if (!jobId) return null;

    const progressUrl = shortId
      ? `${API_BASE}/render-short-progress/${jobId}/${shortId}`
      : `${API_BASE}/render-progress/${jobId}`;

    try {
      const progressRes = await fetch(progressUrl);
      const progressData = await progressRes.json().catch(() => ({}));

      if (!progressRes.ok) {
        throw new Error(progressData.error || 'Falha ao consultar progresso da renderização.');
      }

      const status = (progressData.status || 'idle') as RenderStatus;
      const progress = Number(progressData.progress || 0);
      const nextOutputUrl = progressData.outputUrl || null;

      setRenderStatus(status);
      setRenderProgress(Math.max(0, Math.min(100, progress)));
      if (nextOutputUrl) setOutputUrl(nextOutputUrl);

      if (status === 'failed') {
        setRendering(false);
        stopPolling();
        if (progressData.error) setError(progressData.error);
        return status;
      }

      if (status === 'completed') {
        setRendering(false);
        stopPolling();
        return status;
      }

      if (status === 'rendered' && !shortId) {
        await finalizeRender();
      }
      return status;
    } catch (e: any) {
      // Para shorts: erros de progresso são esperados antes do primeiro render — não exibir
      if (!shortId) {
        setError(e.message || 'Erro ao consultar progresso.');
      }
      setRendering(false);
      stopPolling();
      return 'failed';
    }
  }, [finalizeRender, jobId, shortId, stopPolling]);

  const startPolling = useCallback(() => {
    if (shortId && !renderId) return;
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void checkProgress();
    }, 2500);
  }, [checkProgress, stopPolling, shortId, renderId]);

  const loadPreviewData = useCallback(async () => {
    if (!jobId) {
      setError('Job inválido.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = shortId
        ? `${API_BASE}/short-preview/${jobId}/${shortId}`
        : `${API_BASE}/preview-data/${jobId}`;
      const previewRes = await fetch(url);
      const previewJson = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        throw new Error(previewJson.error || 'Falha ao carregar preview.');
      }

      setPreviewData(previewJson as PreviewResponse);
      const previewRenderId = (previewJson as any)?.remotionRender?.renderId || (previewJson as any)?.renderId || null;
      setRenderId(previewRenderId);
      if (previewJson.editedUrl) {
        setOutputUrl(previewJson.editedUrl);
        setRenderStatus('completed');
        setRenderProgress(100);
      }

      // Para shorts, não verificar progresso automaticamente (evita 404 antes de renderizar).
      // Para o fluxo normal (sem shortId), verificar se há render em andamento.
      if (!shortId) {
        const status = await checkProgress();
        if (status === 'rendering' || status === 'rendered') {
          startPolling();
        }
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar preview.');
    } finally {
      setLoading(false);
    }
  }, [checkProgress, jobId, startPolling]);

  useEffect(() => {
    void loadPreviewData();
    return () => stopPolling();
  }, [loadPreviewData, stopPolling]);

  useEffect(() => {
    if (!shortId) return;
    // Só fazer polling se tiver renderId
    if (!renderId) return;

    startPolling();
    return () => stopPolling();
  }, [renderId, shortId, startPolling, stopPolling]);

  // Load sibling short IDs for navigation
  useEffect(() => {
    if (!jobId || !shortId) return;
    fetch(`${API_BASE}/shorts/${jobId}`)
      .then((r) => r.json())
      .then((data) => setShortIds((data.shorts || []).map((s: any) => s.id)))
      .catch(() => {});
  }, [jobId, shortId]);

  const handleRender = useCallback(async () => {
    if (!jobId) return;

    setError(null);
    setOutputUrl(null);
    setRendering(true);
    setRenderStatus('rendering');
    setRenderProgress(0);

    const renderUrl = shortId
      ? `${API_BASE}/render-short/${jobId}/${shortId}`
      : `${API_BASE}/render-lambda/${jobId}`;

    try {
      const renderRes = await fetch(renderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const renderJson = await renderRes.json().catch(() => ({}));
      if (!renderRes.ok) {
        throw new Error(renderJson.error || 'Falha ao iniciar renderização no Lambda.');
      }

      setRenderId((renderJson as any)?.renderId || null);
      startPolling();
      await checkProgress();
    } catch (e: any) {
      setRendering(false);
      setRenderStatus('failed');
      setError(e.message || 'Erro ao iniciar renderização.');
      stopPolling();
    }
  }, [checkProgress, jobId, startPolling, stopPolling]);

  const durationInFrames = useMemo(() => {
    if (!previewData) return 1;
    return Math.max(1, Math.round(previewData.duration * previewData.fps));
  }, [previewData]);

  const inputProps = useMemo<VideoCompositionProps | null>(() => {
    if (!previewData) return null;

    return {
      videoUrl: previewData.videoUrl,
      clips: previewData.clips,
      captions: previewData.captions,
      brolls: previewData.brolls,
      transitions: previewData.transitions,
      outputFormat: {
        width: previewData.width,
        height: previewData.height,
        fps: previewData.fps,
      },
      duration: previewData.duration,
    };
  }, [previewData]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => shortId ? navigate(`/shorts/${jobId}`) : navigate('/video-editor')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            {shortId ? 'Ver todos os shorts' : 'Voltar ao Editor'}
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles size={14} className="text-cyan-300" />
            {shortId ? `Short: ${shortId}` : 'Preview Remotion + Render AWS Lambda'}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3 sm:p-4">
            <div className="mx-auto w-full max-w-[420px] aspect-[9/16] rounded-xl overflow-hidden bg-black shadow-2xl shadow-black/50">
              {loading || !previewData || !inputProps ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="animate-spin text-cyan-300" size={28} />
                </div>
              ) : (
                <Player
                  component={VideoComposition}
                  inputProps={inputProps}
                  durationInFrames={durationInFrames}
                  fps={previewData.fps}
                  compositionWidth={previewData.width}
                  compositionHeight={previewData.height}
                  controls
                  showVolumeControls
                  style={{ width: '100%', height: '100%' }}
                  loop
                />
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500">Job</p>
              <p className="text-sm text-slate-200 mt-1 truncate">{jobId}</p>
              {shortId && (
                <>
                  <p className="text-xs uppercase tracking-widest text-slate-500 mt-2">Short</p>
                  <p className="text-sm text-cyan-300 mt-1 truncate">{shortId}</p>
                </>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Progresso</p>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {renderStatus === 'completed' ? 'Render finalizada.' :
                  renderStatus === 'rendered' ? 'Render concluída no Lambda, finalizando arquivo...' :
                  renderStatus === 'rendering' ? `Renderizando... ${renderProgress}%` :
                  renderStatus === 'failed' ? 'Falha na renderização.' :
                  'Pronto para renderizar.'}
              </p>
            </div>

            <button
              onClick={handleRender}
              disabled={loading || rendering || !previewData}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rendering ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              {rendering ? 'Renderizando...' : 'Renderizar'}
            </button>

            {outputUrl && (
              <a
                href={outputUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/10 transition-colors"
              >
                <Download size={16} />
                Baixar MP4
              </a>
            )}

            {shortId && shortIds.length > 1 && (() => {
              const idx = shortIds.indexOf(shortId);
              const prev = idx > 0 ? shortIds[idx - 1] : null;
              const next = idx < shortIds.length - 1 ? shortIds[idx + 1] : null;
              return (
                <div className="flex gap-2">
                  <button
                    disabled={!prev}
                    onClick={() => prev && navigate(`/video-preview/${jobId}/${prev}`)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-sm transition-colors"
                  >
                    <ArrowLeft size={14} />
                    Anterior
                  </button>
                  <button
                    disabled={!next}
                    onClick={() => next && navigate(`/video-preview/${jobId}/${next}`)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-sm transition-colors"
                  >
                    Próximo
                    <ArrowRight size={14} />
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
