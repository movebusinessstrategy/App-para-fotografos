import React from 'react';
import { Mic } from 'lucide-react';
import { Conversation } from '../types';

interface Props {
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function initials(name: string | null, phone: string): string {
  if (name) {
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
}

const COLORS = ['#7A8F64','#6E8CA0','#9E8262','#7B6E9E','#5E9E8A','#9E6E82'];
function avatarColor(phone: string) {
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = phone.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function parsePreview(msg: string | null): { mic?: boolean; text: string } {
  if (!msg) return { text: '' };
  if (msg.startsWith('🎤')) return { mic: true, text: msg.slice(1).trim() };
  if (msg === '[audio]') return { mic: true, text: 'Mensagem de voz' };
  if (msg === '[image]') return { text: '📷 Foto' };
  if (msg === '[video]') return { text: '🎥 Vídeo' };
  if (msg === '[document]') return { text: '📄 Documento' };
  if (msg === '[sticker]') return { text: '💟 Figurinha' };
  return { text: msg };
}

export function ConversationItem({ conv, selected, onClick }: Props) {
  const name = conv.contact_name || conv.phone;
  const color = avatarColor(conv.phone);
  const preview = parsePreview(conv.last_message);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all"
      style={{
        background: selected ? 'rgba(181,193,157,0.12)' : 'transparent',
        borderLeft: `2px solid ${selected ? '#B5C19D' : 'transparent'}`,
      }}
    >
      <div
        className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
        style={{ background: color }}
      >
        {initials(conv.contact_name, conv.phone)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: selected ? '#B5C19D' : '#ECEAE3' }}
          >
            {name}
          </span>
          <span className="text-[11px] flex-shrink-0" style={{ color: '#6A6A65' }}>
            {timeLabel(conv.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="flex items-center gap-1 text-xs truncate min-w-0" style={{ color: '#6A6A65' }}>
            {preview.mic && <Mic size={11} className="flex-shrink-0" style={{ color: '#B5C19D' }} />}
            <span className="truncate">{preview.text}</span>
          </span>
          {conv.unread_count > 0 && (
            <span
              className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
              style={{ background: '#B5C19D', color: '#0E0E0C' }}
            >
              {conv.unread_count > 99 ? '99+' : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
