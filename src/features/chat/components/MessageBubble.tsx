import React from 'react';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { Message } from '../types';
import { AudioMessagePlayer } from './AudioMessagePlayer';

interface Props {
  key?: React.Key | null;
  msg: Message;
  onImageClick?: (url: string) => void;
  contactInitial?: string;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Status normalizado pelo servidor: 'pending'|'sent'|'delivered'|'read'|'error'|'received'|'sending'
// Evolution API raw: SERVER_ACK→sent, DELIVERY_ACK→delivered, READ→read, PLAYED→read
function StatusIcon({ msg }: { msg: Message }) {
  if (!msg.from_me) return null;

  // DEBUG temporário - veja no DevTools → Console os valores reais
  console.log('[MessageBubble] status debug:', {
    message_id: msg.message_id?.slice(-8),
    status: msg.status,
    from_me: msg.from_me,
    allFields: Object.keys(msg as any),
  });

  const raw = (msg as any).status ?? (msg as any).ack ?? (msg as any).ackStatus ?? '';
  const s = String(raw).toUpperCase();

  // --wa-text-secondary é adaptativo: cinza claro no dark, cinza médio no light
  const muted = 'var(--wa-text-secondary)';

  if (s === 'ERROR' || s === 'FAILED')
    return <AlertCircle size={13} style={{ color: '#ef4444' }} />;
  if (s === 'PENDING' || s === 'SENDING' || s === '1' || s === '0')
    return <Clock size={13} style={{ color: muted, opacity: 0.7 }} />;
  if (s === 'SENT' || s === 'SERVER_ACK' || s === '2')
    return <Check size={14} style={{ color: muted }} />;
  if (s === 'DELIVERED' || s === 'DELIVERY_ACK' || s === '3')
    return <CheckCheck size={14} style={{ color: muted }} />;
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5')
    return <CheckCheck size={14} style={{ color: '#53BDEB' }} />;

  // 'received' = mensagem recebida (from_me=true nunca deve ter esse status, mas defensivo)
  if (s === 'RECEIVED') return null;

  // Fallback: mensagem enviada sem status definido → 1 check
  return <Check size={14} style={{ color: muted }} />;
}

export function MessageBubble({ msg, onImageClick, contactInitial }: Props) {
  const isMe = msg.from_me;
  const isSending = msg.status === 'sending';

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-1 animate-msg-enter`}>
      <div
        className="max-w-[65%] text-sm"
        style={{
          background: isMe ? 'var(--wa-bubble-sent)' : 'var(--wa-bubble-recv)',
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

        {/* Transcrição do áudio / descrição da imagem (a Lia "ouviu/viu") */}
        {msg.transcription && (msg.type === 'audio' || msg.type === 'image') && (
          <p style={{
            color: 'var(--wa-text-muted)',
            fontSize: 12.5,
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            marginTop: 3,
            marginBottom: 2,
            paddingTop: 4,
            borderTop: '1px solid rgba(0,0,0,0.08)',
          }}>
            {msg.type === 'audio' ? '🎤 ' : '📷 '}
            {msg.transcription.replace(/^\[[^\]]+\]\s*/, '')}
          </p>
        )}

        {/* Texto ou legenda */}
        {msg.body && (
          <p style={{
            color: 'var(--wa-text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: '1.45',
            marginBottom: 2,
          }}>
            {msg.body}
          </p>
        )}

        {/* Tipo desconhecido sem mídia */}
        {!msg.body && !msg.media_url && msg.type !== 'text' && (
          <p style={{ color: 'var(--wa-text-muted)', fontStyle: 'italic' }}>[{msg.type}]</p>
        )}

        {/* Rodapé: hora + status */}
        <div className="flex items-center justify-end gap-1" style={{ marginTop: 1, minHeight: 15 }}>
          <span style={{ fontSize: 11, color: 'var(--wa-text-muted)', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {isSending ? 'Enviando...' : timeStr(msg.timestamp)}
          </span>
          <StatusIcon msg={msg} />
        </div>
      </div>
    </div>
  );
}
