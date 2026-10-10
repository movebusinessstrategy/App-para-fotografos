import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useChatViewport } from '../../features/chat/hooks/useChatViewport';
import { InboxView } from '../../features/chat/components/InboxView';
import { Client, Deal, PipelineStage } from '../../types';

interface ChatPopupProps {
  phone: string;
  contactName?: string | null;
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  onDealUpdated: () => void;
  onClose: () => void;
}

function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
  )).filter(element => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  const boundary = event.shiftKey ? first : last;
  if (document.activeElement !== boundary) return;
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}

/** Extensão do Atendimento no funil: usa os mesmos recursos, histórico e canal. */
export function ChatPopup({ phone, contactName, deals, stages, clients, onDealUpdated, onClose }: ChatPopupProps) {
  const viewportRef = useChatViewport();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <div ref={viewportRef} className="wa-viewport fixed inset-0 z-[60] flex justify-end">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/20" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Conversa de ${contactName || phone}`}
        className="relative flex h-full min-w-0 flex-col border-l shadow-xl"
        style={{ width: 'min(100%, 620px)', background: 'var(--wa-bg-secondary)', borderColor: 'var(--wa-border)' }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); return; }
          trapFocus(event);
        }}
      >
        <div className="wa-popup-heading flex shrink-0 items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--wa-border)' }}>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--wa-text-primary)' }}>Conversa no funil</p>
            <p className="text-xs" style={{ color: 'var(--wa-text-secondary)' }}>Continue o atendimento sem sair de vendas</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar conversa" className="wa-touch-button flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-gold-500 dark:hover:bg-white/5" style={{ color: 'var(--wa-text-secondary)' }}>
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <InboxView
            embedded
            initialPhone={phone.replace(/\D/g, '')}
            initialContactName={contactName}
            deals={deals}
            stages={stages}
            clients={clients}
            onDealUpdated={onDealUpdated}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
