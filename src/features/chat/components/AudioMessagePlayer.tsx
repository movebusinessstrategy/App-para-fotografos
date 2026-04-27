import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface Props {
  src: string;
  isMe: boolean;
  contactInitial?: string;
  duration?: number | null;
  waveform?: number[] | null;
}

function fakeBars(seed: string, count = 64): number[] {
  let h = 0;
  for (let i = 0; i < Math.min(seed.length, 80); i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Array.from({ length: count }, (_, i) => {
    h = (Math.imul(31, h) + i) | 0;
    return ((h >>> 0) % 70 + 15) / 100;
  });
}

function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function AudioMessagePlayer({ src, isMe, contactInitial = '?', duration: durationProp, waveform }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(durationProp ?? 0);

  const bars: number[] = waveform && waveform.length === 64
    ? waveform.map(v => v / 100)
    : fakeBars(src.slice(0, 100), 64);

  useEffect(() => {
    if (durationProp && durationProp > 0) setAudioDuration(durationProp);
  }, [durationProp]);

  const progress = audioDuration > 0 ? currentTime / audioDuration : 0;
  const playedBars = Math.floor(progress * bars.length);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play().catch(() => {}); }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = ratio * audioDuration;
  }

  const displayTime = playing || currentTime > 0 ? currentTime : audioDuration;

  // Cores via CSS vars — sem hardcode
  const playBtnBg    = isMe ? 'rgba(255,255,255,0.2)' : 'var(--wa-accent-green)';
  const playBtnColor = '#fff';
  const barPlayed    = isMe ? 'rgba(255,255,255,0.9)' : 'var(--wa-accent-green)';
  const barUnplayed  = isMe ? 'rgba(255,255,255,0.3)' : 'rgba(0,168,132,0.3)';
  const timeColor    = 'var(--wa-text-muted)';
  const avatarBg     = isMe ? 'rgba(255,255,255,0.15)' : 'var(--wa-bg-hover)';
  const avatarColor  = isMe ? '#fff' : 'var(--wa-text-secondary)';

  return (
    <div className="flex items-center gap-2" style={{ minWidth: 220, maxWidth: 280 }}>
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration;
          if (d && isFinite(d) && d > 0) setAudioDuration(d);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
      />

      {/* Avatar — mensagens recebidas ficam à esquerda */}
      {!isMe && (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold uppercase"
          style={{ background: avatarBg, color: avatarColor }}
        >
          {contactInitial}
        </div>
      )}

      {/* Botão play/pause */}
      <button
        onClick={togglePlay}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
        style={{ background: playBtnBg, color: playBtnColor }}
      >
        {playing
          ? <Pause size={15} />
          : <Play size={15} style={{ transform: 'translateX(1px)' }} />
        }
      </button>

      {/* Waveform + timer */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          className="flex items-center gap-px h-8 cursor-pointer"
          onClick={handleSeek}
        >
          {bars.map((amp, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-colors duration-75"
              style={{
                height: `${Math.max(10, Math.round(amp * 100))}%`,
                minHeight: 2,
                background: i < playedBars ? barPlayed : barUnplayed,
              }}
            />
          ))}
        </div>
        <span className="text-[11px] tabular-nums leading-none" style={{ color: timeColor }}>
          {formatTime(displayTime)}
        </span>
      </div>

      {/* Avatar — mensagens enviadas ficam à direita */}
      {isMe && (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
          style={{ background: avatarBg, color: avatarColor }}
        >
          {contactInitial}
        </div>
      )}
    </div>
  );
}
