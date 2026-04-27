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

function getIsDark(): boolean {
  const el = document.documentElement;
  return el.getAttribute('data-theme') !== 'light';
}

function getWaveformColors(isMe: boolean) {
  const isDark = getIsDark();
  if (isMe) {
    if (isDark) {
      // Dark: balão verde escuro (#005C4B) → barras brancas têm contraste
      return { played: '#ffffff', unplayed: 'rgba(255,255,255,0.4)' };
    } else {
      // Light: balão verde claro (#D9FDD3) → barras verde escuro para contrastar
      return { played: '#005C4B', unplayed: 'rgba(0,92,75,0.4)' };
    }
  }
  // Recebido: verde em qualquer tema (fundo branco no light, cinza escuro no dark)
  return { played: '#00a884', unplayed: 'rgba(0,168,132,0.35)' };
}

export function AudioMessagePlayer({ src, isMe, contactInitial = '?', duration: durationProp, waveform }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(durationProp ?? 0);
  // Força re-render quando tema mudar
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => forceUpdate(n => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);

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
  const isDark = getIsDark();
  const { played: barPlayed, unplayed: barUnplayed } = getWaveformColors(isMe);

  const playBtnBg    = isMe ? 'rgba(255,255,255,0.25)' : '#00a884';
  const playBtnColor = '#fff';
  const timeColor    = isMe ? 'rgba(255,255,255,0.75)' : (isDark ? '#8696A0' : '#667781');
  const avatarBg     = isMe ? 'rgba(255,255,255,0.2)' : (isDark ? '#2A3942' : '#F0F2F5');
  const avatarColor  = isMe ? '#fff' : (isDark ? '#8696A0' : '#667781');

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

      {!isMe && (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold uppercase"
          style={{ background: avatarBg, color: avatarColor }}
        >
          {contactInitial}
        </div>
      )}

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

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-px h-8 cursor-pointer" onClick={handleSeek}>
          {bars.map((amp, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${Math.max(10, Math.round(amp * 100))}%`,
                minHeight: 2,
                background: i < playedBars ? barPlayed : barUnplayed,
                transition: 'background 0.05s',
              }}
            />
          ))}
        </div>
        <span className="text-[11px] tabular-nums leading-none" style={{ color: timeColor }}>
          {formatTime(displayTime)}
        </span>
      </div>

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
