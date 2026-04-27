import React from 'react';
import { Mic } from 'lucide-react';
import { Conversation } from '../types';
import { extractContact, getInitials } from '../utils/contactHelpers';
import { useContactProfile } from '../hooks/useContactProfile';

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

const COLORS = ['#00756A','#2C5364','#6B4226','#4B3F72','#1B6B4A','#7A3045'];
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
  const { name, avatar, phone } = extractContact(conv);
  const finalAvatar = useContactProfile(phone, avatar);
  const color = avatarColor(phone);
  const preview = parsePreview(conv.last_message);
  const hasUnread = conv.unread_count > 0;
  const initials = getInitials(name);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors"
      style={{ background: selected ? 'var(--wa-bg-hover)' : 'transparent' }}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--wa-bg-hover)';
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {/* Avatar */}
      <div
        className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold overflow-hidden"
        style={{ background: color }}
      >
        {finalAvatar
          ? <img src={finalAvatar} alt={name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : initials
        }
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0" style={{ borderBottom: '1px solid var(--wa-border)', paddingBottom: 12 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--wa-text-primary)' }}>
            {name}
          </span>
          <span
            className="text-[11px] flex-shrink-0"
            style={{ color: hasUnread ? 'var(--wa-accent-green)' : 'var(--wa-text-muted)' }}
          >
            {timeLabel(conv.last_message_at)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span
            className="flex items-center gap-1 text-[13px] truncate min-w-0"
            style={{ color: 'var(--wa-text-secondary)' }}
          >
            {preview.mic && <Mic size={12} className="flex-shrink-0" style={{ color: 'var(--wa-text-secondary)' }} />}
            <span className="truncate">{preview.text}</span>
          </span>

          {hasUnread && (
            <span
              className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center"
              style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
            >
              {conv.unread_count > 99 ? '99+' : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
