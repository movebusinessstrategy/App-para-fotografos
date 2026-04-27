import React from 'react';
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

export function MessageBubble({ msg, onImageClick, contactInitial }: Props) {
  const isMe = msg.from_me;
  const isSending = msg.status === 'sending';

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className="max-w-[70%] rounded-2xl px-3 py-2 text-sm"
        style={{
          background: isMe ? '#2D3B26' : '#1F1F1D',
          opacity: isSending ? 0.6 : 1,
          border: isMe ? '1px solid rgba(181,193,157,0.15)' : '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Imagem */}
        {msg.type === 'image' && msg.media_url && (
          <img
            src={msg.media_url}
            alt="imagem"
            className="max-w-full rounded-lg mb-1 cursor-pointer"
            style={{ maxHeight: 200 }}
            onClick={() => onImageClick?.(msg.media_url!)}
          />
        )}

        {/* Áudio */}
        {msg.type === 'audio' && msg.media_url && (
          <div className="mb-1">
            <AudioMessagePlayer
              src={msg.media_url}
              isMe={msg.from_me}
              contactInitial={contactInitial}
              duration={msg.duration}
              waveform={msg.waveform}
            />
          </div>
        )}

        {/* Vídeo */}
        {msg.type === 'video' && msg.media_url && (
          <video controls className="max-w-full rounded-lg mb-1" style={{ maxHeight: 200 }}>
            <source src={msg.media_url} />
          </video>
        )}

        {/* Texto ou legenda */}
        {msg.body && (
          <p style={{ color: '#ECEAE3', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.body}
          </p>
        )}

        {/* Sem texto nem mídia */}
        {!msg.body && !msg.media_url && msg.type !== 'text' && (
          <p style={{ color: '#6A6A65', fontStyle: 'italic' }}>[{msg.type}]</p>
        )}

        <div className="flex justify-end mt-1">
          <span className="text-[10px]" style={{ color: '#6A6A65' }}>
            {isSending ? 'Enviando...' : timeStr(msg.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}
