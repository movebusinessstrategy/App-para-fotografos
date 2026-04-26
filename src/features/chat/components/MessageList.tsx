import React, { useEffect, useRef } from 'react';
import { MessageCircle } from 'lucide-react';
import { Message } from '../types';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: Message[];
  loading: boolean;
  contactName: string | null;
  phone: string;
  photoUrl: string | null;
  onImageClick: (url: string) => void;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterdayStr = new Date(now.getTime() - 86400000).toDateString();
  if (d.toDateString() === todayStr) return 'Hoje';
  if (d.toDateString() === yesterdayStr) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function groupByDate(messages: Message[]) {
  const groups: { label: string; messages: Message[] }[] = [];
  let current = '';
  for (const msg of messages) {
    const label = formatDateLabel(msg.timestamp);
    if (label !== current) {
      current = label;
      groups.push({ label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

// Skeletons para o estado de loading
function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
        >
          <div
            className="h-9 rounded-2xl animate-pulse"
            style={{
              width: `${40 + (i * 17) % 30}%`,
              background: 'rgba(255,255,255,0.06)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  contactName,
  phone,
  photoUrl,
  onImageClick,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages]);

  // Scroll imediato ao trocar de conversa
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    prevCountRef.current = 0;
  }, [phone]);

  const groups = groupByDate(messages);

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
    >
      {loading ? (
        <MessageSkeleton />
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: '#6A6A65' }}>
          <MessageCircle size={32} strokeWidth={1.5} />
          <p className="text-sm">Nenhuma mensagem ainda</p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            {/* Separador de data */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <span
                className="text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap"
                style={{
                  color: '#6A6A65',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {group.label}
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>

            {group.messages.map((msg, i) => (
              <React.Fragment key={msg.message_id}>
                <MessageBubble
                  message={msg}
                  contactName={contactName}
                  phone={phone}
                  photoUrl={photoUrl}
                  onImageClick={onImageClick}
                  animateIn={i === group.messages.length - 1 && msg.message_id.startsWith('tmp-')}
                />
              </React.Fragment>
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
