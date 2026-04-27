import React from 'react';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
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

function StatusIcon({ msg }: { msg: Message }) {
  if (!msg.from_me) return null;

  // DEBUG — remove após confirmar os valores reais no DevTools
  console.log('[MessageBubble] status field:', JSON.stringify({
    status: msg.status,
    message_id: msg.message_id?.slice(0, 12),
  }));

  const s = (msg as any).status ?? (msg as any).ack ?? (msg as any).ackStatus ?? '';
  const muted = 'var(--wa-text-secondary)';

  // Numérico (Baileys nativo)
  if (s === 0 || s === 'pending')  return <Clock size={13} style={{ color: muted, opacity: 0.6 }} />;
  if (s === 1 || s === 'sent')     return <Check size={14} style={{ color: muted }} />;
  if (s === 2 || s === 'delivered')return <CheckCheck size={14} style={{ color: muted }} />;
  if (s === 3 || s === 'read')     return <CheckCheck size={14} style={{ color: 'var(--wa-accent-read)' }} />;
  if (s === 'failed' || s === 'error') return <AlertCircle size={13} style={{ color: '#ef4444' }} />;
  if (s === 'sending')             return <Clock size={13} style={{ color: muted, opacity: 0.6 }} />;
  if (s === 'received')            return null; // mensagem recebida não deve mostrar check

  // fallback — mensagem enviada sem status definido mostra 1 check
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
        className="max-w-[65%] text-sm relative"
        style={{
          background: bubbleBg,
          opacity: isSending ? 0.7 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          borderRadius: isMe ? '8px 2px 8px 8px' : '2px 8px 8px 8px',
          padding: '6px 10px 4px',
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
          <p style={{ color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.45', marginBottom: 2 }}>
            {msg.body}
          </p>
        )}

        {/* Tipo desconhecido sem mídia */}
        {!msg.body && !msg.media_url && msg.type !== 'text' && (
          <p style={{ color: 'var(--wa-text-muted)', fontStyle: 'italic' }}>[{msg.type}]</p>
        )}

        {/* Rodapé: hora + status — flutua à direita */}
        <div className="flex items-center justify-end gap-1" style={{ marginTop: 1, minHeight: 15 }}>
          <span style={{ fontSize: 11, color: 'var(--wa-text-muted)', lineHeight: 1 }}>
            {isSending ? 'Enviando...' : timeStr(msg.timestamp)}
          </span>
          <StatusIcon msg={msg} />
        </div>
      </div>
    </div>
  );
}
