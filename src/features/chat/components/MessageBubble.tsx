import React from 'react';
import { Check, CheckCheck } from 'lucide-react';
import { Message } from '../types';
import { AudioMessagePlayer } from './AudioMessagePlayer';

interface Props {
  msg: Message;
  onImageClick?: (url: string) => void;
  contactInitial?: string;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function StatusIcon({ status, isMe }: { status: string; isMe: boolean }) {
  if (!isMe) return null;
  const muted = 'var(--wa-text-secondary)';
  if (status === 'read') return <CheckCheck size={14} style={{ color: 'var(--wa-accent-read)' }} />;
  if (status === 'delivered') return <CheckCheck size={14} style={{ color: muted }} />;
  if (status === 'sent') return <Check size={14} style={{ color: muted }} />;
  if (status === 'sending') return <Check size={14} style={{ color: muted, opacity: 0.5 }} />;
  // fallback para qualquer outro valor (vazio, null, etc.)
  return <Check size={14} style={{ color: muted }} />;
}

export function MessageBubble({ msg, onImageClick, contactInitial }: Props) {
  const isMe = msg.from_me;
  const isSending = msg.status === 'sending';

  const bubbleBg = isMe ? 'var(--wa-bubble-sent)' : 'var(--wa-bubble-recv)';
  const textColor = 'var(--wa-text-primary)';

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-1 animate-msg-enter`}>
      <div
        className="max-w-[65%] rounded-lg px-3 py-1.5 text-sm relative"
        style={{
          background: bubbleBg,
          opacity: isSending ? 0.7 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          borderRadius: isMe
            ? '8px 2px 8px 8px'
            : '2px 8px 8px 8px',
        }}
      >
        {/* Imagem */}
        {msg.type === 'image' && msg.media_url && (
          <img
            src={msg.media_url}
            alt="imagem"
            className="max-w-full rounded-md mb-1 cursor-pointer block"
            style={{ maxHeight: 220 }}
            onClick={() => onImageClick?.(msg.media_url!)}
          />
        )}

        {/* Áudio */}
        {msg.type === 'audio' && msg.media_url && (
          <div className="mb-0.5">
            <AudioMessagePlayer
              src={msg.media_url}
              isMe={isMe}
              contactInitial={contactInitial}
              duration={msg.duration}
              waveform={msg.waveform}
            />
          </div>
        )}

        {/* Vídeo */}
        {msg.type === 'video' && msg.media_url && (
          <video controls className="max-w-full rounded-md mb-1 block" style={{ maxHeight: 220 }}>
            <source src={msg.media_url} />
          </video>
        )}

        {/* Texto ou legenda */}
        {msg.body && (
          <p style={{ color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.45' }}>
            {msg.body}
          </p>
        )}

        {/* Tipo desconhecido sem mídia */}
        {!msg.body && !msg.media_url && msg.type !== 'text' && (
          <p style={{ color: 'var(--wa-text-muted)', fontStyle: 'italic' }}>[{msg.type}]</p>
        )}

        {/* Rodapé: hora + status */}
        <div className="flex items-center justify-end gap-1 mt-0.5" style={{ minHeight: 16 }}>
          <span className="text-[11px] leading-none" style={{ color: 'var(--wa-text-muted)' }}>
            {isSending ? 'Enviando...' : timeStr(msg.timestamp)}
          </span>
          <StatusIcon status={msg.status} isMe={isMe} />
        </div>
      </div>
    </div>
  );
}
