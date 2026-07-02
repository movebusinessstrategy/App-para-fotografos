// Polyfill para CanvasRenderingContext2D.roundRect (Safari < 16)
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, r?: number | DOMPointInit | (number | DOMPointInit)[]) {
    const radius = typeof r === 'number' ? r : 0;
    this.beginPath();
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
}

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Trash2, Send, Mic } from 'lucide-react';

interface AudioRecorderProps {
  onSend: (blob: Blob, durationSec: number) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}

const MAX_BARS = 80;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const SWIPE_CANCEL_THRESHOLD = 100;

export function AudioRecorder({ onSend, onCancel, className = '' }: AudioRecorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const amplitudeHistoryRef = useRef<number[]>([]);
  const dragStartXRef = useRef<number | null>(null);
  const lastBarTimeRef = useRef<number>(0);

  const [duration, setDuration] = useState(0);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isSending, setIsSending] = useState(false);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(animationFrameRef.current);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;

        startTimeRef.current = Date.now();
        setIsInitializing(false);
      } catch (err: any) {
        const msg =
          err.name === 'NotAllowedError'
            ? 'Permita acesso ao microfone nas configurações do navegador.'
            : 'Não foi possível acessar o microfone.';
        setError(msg);
        setTimeout(() => onCancel(), 2500);
      }
    }

    init();
    return () => {
      mounted = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitializing || error) return;
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 250);
    return () => clearInterval(interval);
  }, [isInitializing, error]);

  useEffect(() => {
    if (isInitializing || error) return;
    const rafId = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(rect.width * dpr, 1);
      canvas.height = Math.max(rect.height * dpr, 1);
      canvas.getContext('2d')?.scale(dpr, dpr);
      startDrawing();
    });
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitializing]);

  function startDrawing() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
      const rms = Math.sqrt(sum / dataArray.length);
      const amplitude = Math.min(rms / 100, 1);

      const now = Date.now();
      if (now - lastBarTimeRef.current >= 100) {
        amplitudeHistoryRef.current.push(amplitude);
        if (amplitudeHistoryRef.current.length > MAX_BARS) amplitudeHistoryRef.current.shift();
        lastBarTimeRef.current = now;
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const centerY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Cor via CSS var (lida do elemento raiz)
      const accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--wa-accent-green').trim() || '#B08830';

      ctx.fillStyle = accentColor;

      const totalBarSpace = BAR_WIDTH + BAR_GAP;
      const startX = w - amplitudeHistoryRef.current.length * totalBarSpace;

      amplitudeHistoryRef.current.forEach((amp, i) => {
        const eased = Math.pow(amp, 0.7);
        const halfHeight = Math.max(eased * (h / 2) * 0.95, 1.5);
        const x = startX + i * totalBarSpace;
        ctx.beginPath();
        ctx.roundRect(x, centerY - halfHeight, BAR_WIDTH, halfHeight * 2, BAR_WIDTH / 2);
        ctx.fill();
      });

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();
  }

  async function stop(send: boolean) {
    if (isSending) return;

    if (!send) {
      cleanup();
      onCancel();
      return;
    }

    setIsSending(true);

    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    cancelAnimationFrame(animationFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close().catch(() => {});

    if (chunksRef.current.length > 0) {
      const mimeType = recorder?.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const durationSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
      try {
        await onSend(blob, durationSec);
      } catch (err: any) {
        const msg = err?.message || 'Erro desconhecido ao enviar áudio';
        setError(msg);
        setIsSending(false);
      }
    } else {
      onCancel();
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    dragStartXRef.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (dragStartXRef.current === null) return;
    const offset = Math.min(0, e.clientX - dragStartXRef.current);
    setDragOffset(offset);
  }

  function handlePointerUp() {
    if (dragStartXRef.current !== null && dragOffset < -SWIPE_CANCEL_THRESHOLD) {
      stop(false);
    }
    dragStartXRef.current = null;
    setDragOffset(0);
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl ${className}`}
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
      >
        <span className="text-sm flex-1" style={{ color: '#ef4444' }}>{error}</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-2.5 py-1 rounded-lg"
          style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
        >
          Fechar
        </button>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl ${className}`}
        style={{ background: 'var(--wa-bg-input)', border: '1px solid var(--wa-border)' }}
      >
        <Mic className="w-4 h-4 animate-pulse" style={{ color: 'var(--wa-text-muted)' }} />
        <span className="text-sm" style={{ color: 'var(--wa-text-muted)' }}>Iniciando microfone...</span>
      </div>
    );
  }

  const opacity = Math.max(0.3, 1 + dragOffset / 200);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{
        transform: `translateX(${dragOffset}px)`,
        opacity,
        transition: dragStartXRef.current === null ? 'transform 0.2s, opacity 0.2s' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl"
        style={{
          background: 'var(--wa-bg-input)',
          border: '1px solid var(--wa-border)',
        }}
      >
        {/* Cancelar */}
        <button
          type="button"
          onClick={() => stop(false)}
          disabled={isSending}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
          style={{ color: '#ef4444' }}
          aria-label="Cancelar gravação"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* Indicador REC */}
        <div className="flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#ef4444' }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#ef4444' }} />
          </span>
        </div>

        {/* Waveform canvas */}
        <div className="flex-1 min-w-0 h-9 flex items-center">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ touchAction: 'none' }}
          />
        </div>

        {/* Duração */}
        <span
          className="flex-shrink-0 text-sm tabular-nums font-medium min-w-[44px] text-center"
          style={{ color: 'var(--wa-text-primary)' }}
        >
          {formatDuration(duration)}
        </span>

        {/* Enviar */}
        <button
          type="button"
          onClick={() => stop(true)}
          disabled={isSending || duration < 1}
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
          aria-label="Enviar áudio"
        >
          {isSending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" style={{ transform: 'translateX(-1px)' }} />
          )}
        </button>
      </div>

      {dragOffset < -20 && (
        <div
          className="absolute -top-7 left-1/2 -translate-x-1/2 text-xs font-medium whitespace-nowrap"
          style={{ color: '#ef4444' }}
        >
          ← Solte para cancelar
        </div>
      )}
    </div>
  );
}
