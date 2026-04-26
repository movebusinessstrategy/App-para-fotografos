import React from 'react';
import { Check, CheckCheck, Clock, FileText } from 'lucide-react';
import { Message } from '../types';
import { Avatar } from './shared/Avatar';

interface Props {
  message: Message;
  contactName: string | null;
  phone: string;
  photoUrl: string | null;
  onImageClick?: (url: string) => void;
  animateIn?: boolean;
}

function MessageTick({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === 'sending' || s === 'pending') {
    return <Clock size={10} className="inline-block ml-1 opacity-50" />;
  }
  if (s === 'sent' || s === 'server_ack') {
    return <Check size={10} className="inline-block ml-1 opacity-60" />;
  }
  if (s === 'delivered' || s === 'delivery_ack') {
    return <CheckCheck size={10} className="inline-block ml-1 opacity-60" />;
  }
  if (s === 'read' || s === 'played') {
    return <CheckCheck size={10} className="inline-block ml-1" style={{ color: '#B5C19D' }} />;
  }
  return null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MessageBubble({
  message: msg,
  contactName,
  phone,
  photoUrl,
  onImageClick,
  animateIn = false,
}: Props) {
  const isMe = msg.from_me;

  return (
    <div
      className={`flex mb-1 ${isMe ? 'justify-end' : 'justify-start'} ${
        animateIn ? 'animate-msg-enter' : ''
      }`}
    >
      {!isMe && (
        <div className="mr-2 mt-auto mb-0.5 flex-shrink-0">
          <Avatar phone={phone} name={contactName} photoUrl={photoUrl} size="sm" />
        </div>
      )}

      <div
        className={`max-w-[68%] rounded-2xl text-sm leading-relaxed overflow-hidden shadow-sm ${
          isMe ? 'rounded-tr-sm' : 'rounded-tl-sm'
        }`}
        style={
          isMe
            ? {
                background: 'rgba(181,193,157,0.14)',
                border: '1px solid rgba(181,193,157,0.20)',
              }
            : {
                background: 'var(--color-chat-panel2)',
                border: '1px solid rgba(255,255,255,0.06)',
              }
        }
      >
        {/* Imagem */}
        {msg.media_url && msg.type === 'image' && (
          <button
            onClick={() => onImageClick?.(msg.media_url!)}
            className="block w-full cursor-zoom-in"
          >
            <img
              src={msg.media_url}
              alt="imagem"
              className="max-w-full max-h-64 object-cover block w-full"
              style={{ borderRadius: '14px 14px 0 0' }}
            />
          </button>
        )}

        {/* Vídeo */}
        {msg.media_url && msg.type === 'video' && (
          <video
            src={msg.media_url}
            controls
            className="max-w-full max-h-48 block w-full"
            style={{ borderRadius: '14px 14px 0 0' }}
          />
        )}

        {/* Áudio */}
        {msg.media_url && msg.type === 'audio' && (
          <div className="px-3 pt-3 pb-1">
            <audio controls src={msg.media_url} className="w-full h-8" />
          </div>
        )}

        {/* Documento */}
        {msg.media_url && msg.type === 'document' && (
          <a
            href={msg.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2.5 hover:opacity-80 transition-opacity"
          >
            <FileText
              size={18}
              style={{ color: isMe ? '#B5C19D' : '#9A9A93' }}
              className="flex-shrink-0"
            />
            <span
              className="text-xs underline truncate max-w-[160px]"
              style={{ color: isMe ? '#ECEAE3' : '#9A9A93' }}
            >
              {msg.body || 'Documento'}
            </span>
          </a>
        )}

        {/* Corpo de texto */}
        <div className="px-3.5 py-2">
          {msg.body &&
            msg.body !== `[${msg.type}]` &&
            msg.type !== 'document' && (
              <p
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: isMe ? '#ECEAE3' : '#ECEAE3',
                }}
              >
                {msg.body}
              </p>
            )}
          {!msg.body && !msg.media_url && (
            <p className="italic text-xs opacity-40">[{msg.type || 'mensagem'}]</p>
          )}

          {/* Hora + tick */}
          <p
            className="text-[10px] mt-1 flex items-center justify-end gap-0.5"
            style={{ color: '#6A6A65' }}
          >
            {formatTime(msg.timestamp)}
            {isMe && <MessageTick status={msg.status} />}
          </p>
        </div>
      </div>
    </div>
  );
}
