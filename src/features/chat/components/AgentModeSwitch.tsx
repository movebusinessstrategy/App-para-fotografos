import { Bot, Lightbulb, Loader2, UserRound } from 'lucide-react';
import { handoffReasonLabel } from '../utils/agentHandoff';

export type AgentMode = 'idle' | 'needs_human' | 'human_active' | 'suggestions' | 'lia_active' | 'quote_sent';

interface Props {
  mode: AgentMode;
  handoffReason?: string | null;
  error?: string | null;
  busy?: 'human' | 'suggestions' | 'lia' | null;
  onHuman: () => void;
  onSuggestions: () => void;
  onLia: () => void;
}

const modeCopy: Record<AgentMode, string> = {
  idle: 'Atendimento automático inativo nesta conversa.',
  needs_human: 'A Lia pausou para você cuidar desta conversa.',
  human_active: 'Você está atendendo. A Lia não responde automaticamente.',
  suggestions: 'A Lia prepara sugestões; você revisa e envia.',
  lia_active: 'A Lia está respondendo esta conversa.',
  quote_sent: 'A Lia enviou o orçamento e acompanha a resposta.',
};

export function AgentModeSwitch({ mode, handoffReason, error, busy, onHuman, onSuggestions, onLia }: Props) {
  const handoff = mode === 'needs_human';
  const choices = [
    { key: 'human', label: 'Minha resposta', Icon: UserRound, active: mode === 'human_active', onClick: onHuman },
    { key: 'suggestions', label: 'Sugestões', Icon: Lightbulb, active: mode === 'suggestions', onClick: onSuggestions },
    { key: 'lia', label: 'Lia responde', Icon: Bot, active: mode === 'lia_active' || mode === 'quote_sent', onClick: onLia },
  ] as const;

  return (
    <div role={handoff ? 'alert' : undefined} className="border-b px-4 py-3" style={{ background: handoff ? 'var(--wa-bg-tertiary)' : 'var(--wa-bg-secondary)', borderColor: 'var(--wa-border)' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--wa-text-primary)' }}>{modeCopy[mode]}</p>
          {handoff && <p className="mt-1 text-xs" style={{ color: 'var(--wa-text-secondary)' }}>Motivo: {handoffReasonLabel(handoffReason)}. O cliente ainda aguarda uma resposta sua.</p>}
          {error && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{error}</p>}
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl p-1" style={{ background: 'var(--wa-bg-hover)' }} aria-label="Quem responde esta conversa">
          {choices.map(({ key, label, Icon, active, onClick }) => (
            <button key={key} type="button" onClick={onClick} disabled={!!busy || active}
              aria-pressed={active} className="inline-flex min-h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-65"
              style={{ background: active ? 'var(--wa-bg-input)' : 'transparent', color: active ? 'var(--wa-text-primary)' : 'var(--wa-text-secondary)', boxShadow: active ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>
              {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}{label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
