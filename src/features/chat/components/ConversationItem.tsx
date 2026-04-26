import React from 'react';
import { Conversation } from '../types';
import { Avatar } from './shared/Avatar';

interface Props {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

function timeLabel(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7)
    return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ConversationItem({ conversation: conv, isSelected, onClick }: Props) {
  const name = conv.contact_name || conv.phone;
  const unread = conv.unread_count ?? 0;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all relative"
      style={{
        background: isSelected
          ? 'rgba(181,193,157,0.10)'
          : 'transparent',
        borderLeft: isSelected
          ? '2px solid #B5C19D'
          : '2px solid transparent',
      }}
    >
      <Avatar
        phone={conv.phone}
        name={conv.contact_name}
        size="md"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: isSelected ? '#B5C19D' : '#ECEAE3' }}
          >
            {name}
          </span>
          <span className="text-[11px] flex-shrink-0" style={{ color: '#6A6A65' }}>
            {timeLabel(conv.last_message_at)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-xs truncate" style={{ color: '#6A6A65' }}>
            {conv.last_message || ''}
          </span>
          {unread > 0 && (
            <span
              className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
              style={{ background: '#B5C19D', color: '#0E0E0C' }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
