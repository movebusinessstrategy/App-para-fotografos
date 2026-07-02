import React, { useState } from 'react';
import { Mic, CheckCheck, ChevronDown } from 'lucide-react';
import { Conversation } from '../types';
import { extractContact, getInitials } from '../utils/contactHelpers';
import { useContactProfile } from '../hooks/useContactProfile';

interface Props {
  key?: React.Key | null;
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
  /** Marca a conversa como não lida (badge volta) — pra responder depois */
  onMarkUnread?: () => void;
  /** Marca como lida sem precisar abrir a conversa */
  onMarkRead?: () => void;
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

// Avatares sem foto: paleta na identidade do CRM (terrosos + acentos sóbrios)
const COLORS = ['#B08830','#6B4226','#4B3F72','#1B6B4A','#7A3045','#2C5364'];
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

export function ConversationItem({ conv, selected, onClick, onMarkUnread, onMarkRead }: Props) {
  const { name: baseName, avatar: baseAvatar, phone } = extractContact(conv);
  const { name: resolvedName, avatar: resolvedAvatar } = useContactProfile(phone, baseName, baseAvatar);
  const name = resolvedName || baseName;
  const finalAvatar = resolvedAvatar || baseAvatar;
  const color = avatarColor(phone);
  const preview = parsePreview(conv.last_message);
  const hasUnread = conv.unread_count > 0;
  const initials = getInitials(name);
  // Menu de ações (marcar não lida / lida) — chevron aparece no hover, como no
  // WhatsApp. Em tela touch não existe hover: chevron fica sempre visível,
  // senão a ação seria inalcançável no celular/tablet.
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)')?.matches;
  const chevronVisible = isTouch || hovered || menuOpen;
  const menuAction = hasUnread ? onMarkRead : onMarkUnread;
  const menuLabel = hasUnread ? 'Marcar como lida' : 'Marcar como não lida';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { setMenuOpen(false); onClick(); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenuOpen(false); onClick(); } }}
      className="relative w-[calc(100%-12px)] mx-1.5 my-0.5 flex items-center gap-3 px-3 py-2.5 text-left rounded-2xl transition-all duration-150 active:scale-[0.985] cursor-pointer select-none"
      style={{
        background: selected || hovered ? 'var(--wa-bg-hover)' : 'transparent',
        boxShadow: selected ? 'inset 3px 0 0 var(--wa-accent-green)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
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
      {/* Sem divisória — cards arredondados deixam a lista mais leve */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate ${hasUnread ? 'font-bold' : 'font-medium'}`} style={{ color: 'var(--wa-text-primary)' }}>
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
            {conv.last_from_me && !hasUnread && (
              <CheckCheck size={15} className="flex-shrink-0" style={{ color: 'var(--wa-text-secondary)' }} />
            )}
            {preview.mic && <Mic size={12} className="flex-shrink-0" style={{ color: 'var(--wa-text-secondary)' }} />}
            <span className="truncate">{preview.text}</span>
          </span>

          <span className="flex items-center gap-1 flex-shrink-0">
            {hasUnread && (
              <span
                className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center"
                style={{ background: 'var(--wa-accent-green)', color: '#fff' }}
              >
                {conv.unread_count > 99 ? '99+' : conv.unread_count}
              </span>
            )}
            {menuAction && chevronVisible && (
              <span
                role="button"
                tabIndex={0}
                title="Mais opções"
                className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer"
                style={{ color: 'var(--wa-text-muted)' }}
                onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setMenuOpen(o => !o); } }}
              >
                <ChevronDown size={16} />
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Menu flutuante: uma ação por vez (lida ⇄ não lida) */}
      {menuOpen && menuAction && (
        <div
          className="absolute right-2 top-[70%] z-20 rounded-xl py-1 shadow-lg"
          style={{ background: 'var(--wa-bg-tertiary)', border: '1px solid var(--wa-border)' }}
        >
          <button
            className="w-full px-4 py-2 text-left text-[13px] whitespace-nowrap transition-colors hover:opacity-80"
            style={{ color: 'var(--wa-text-primary)' }}
            onClick={e => { e.stopPropagation(); setMenuOpen(false); menuAction(); }}
          >
            {menuLabel}
          </button>
        </div>
      )}
    </div>
  );
}
