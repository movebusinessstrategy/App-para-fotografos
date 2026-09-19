import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bot, Loader2, Radio } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatDay, formatWeekdayTime } from './format';
import { PAUSE_REASON_TEXT, QUALITY_LABELS, TONE_CLASSES, lastErrorText, type Tone } from './labels';
import type { ChannelHealth, FollowUpMode, FollowUpOverview } from './types';

type Sending = FollowUpOverview['sending'];

interface Ctx { health: ChannelHealth; sending: Sending }
interface LineAction { label: string; to?: string; resume?: boolean }
interface Line { key: string; tone: Tone; text: string; action?: LineAction }

// A conexão do QR fica SEMPRE na engrenagem do chat, nunca em Configurações.
const CHAT_LINK = '/vendas?tab=inbox';
const META_LINK = '/configuracoes/integracoes/whatsapp';

function qualityLine(h: ChannelHealth): Line | null {
  const rating = String(h.meta.quality_rating ?? '').toUpperCase();
  if (!rating || rating === 'GREEN') return null;
  const label = QUALITY_LABELS[rating] ?? rating;
  return { key: 'quality', tone: 'red', text: `A qualidade do número na Meta caiu (${label}). Envios pausados para proteger o número.` };
}

function tokenExpiredLine(h: ChannelHealth): Line | null {
  if (h.meta.token_state !== 'expired') return null;
  const when = formatDay(h.meta.token_expires_at);
  const text = when
    ? `Token da API oficial venceu em ${when}. Reconecte em Configurações > Integrações > WhatsApp.`
    : 'Token da API oficial venceu. Reconecte em Configurações > Integrações > WhatsApp.';
  return { key: 'token_expired', tone: 'red', text, action: { label: 'Reconectar', to: META_LINK } };
}

function tokenExpiringLine(h: ChannelHealth): Line | null {
  if (h.meta.token_state !== 'expiring') return null;
  const days = Math.max(0, h.meta.days_left ?? 0);
  const text = days === 1 ? 'Token da API oficial vence em 1 dia.' : `Token da API oficial vence em ${days} dias.`;
  return { key: 'token_expiring', tone: 'amber', text, action: { label: 'Renovar', to: META_LINK } };
}

function qrLine(h: ChannelHealth): Line | null {
  if (!h.baileys.allowed || h.baileys.status === 'open') return null;
  return {
    key: 'qr', tone: 'amber', text: 'WhatsApp (QR) desconectado. Reconecte pela engrenagem do chat.',
    action: { label: 'Abrir chat', to: CHAT_LINK },
  };
}

function templateLine(h: ChannelHealth): Line | null {
  if (!h.template.configured) {
    return { key: 'no_template', tone: 'amber', text: 'Sem template aprovado: fora da janela de 24h só sai pelo QR.' };
  }
  if (h.template.eligible) return null;
  const reason = h.template.reason || 'confira o template nas configurações';
  return { key: 'template', tone: 'amber', text: `O template escolhido não serve para retomada: ${reason}` };
}

const PAUSE_TONES: Record<string, Tone> = { error_streak: 'red', manual: 'amber', daily_cap: 'slate', outside_hours: 'slate' };

function pauseLine(s: Sending): Line | null {
  const reason = s.paused_reason;
  if (!reason || !PAUSE_TONES[reason]) return null;
  const tone = PAUSE_TONES[reason];
  if (reason === 'error_streak') {
    const detail = lastErrorText(s.last_error);
    const text = detail ? `Envios pausados após erros seguidos: ${detail}` : PAUSE_REASON_TEXT.error_streak;
    return { key: 'pause', tone, text, action: { label: 'Retomar envios', resume: true } };
  }
  if (reason === 'manual') return { key: 'pause', tone, text: PAUSE_REASON_TEXT.manual, action: { label: 'Retomar envios', resume: true } };
  if (reason === 'outside_hours' && s.next_window_at) {
    return { key: 'pause', tone, text: `Fora do horário comercial. Os aprovados saem a partir de ${formatWeekdayTime(s.next_window_at)}.` };
  }
  return { key: 'pause', tone, text: PAUSE_REASON_TEXT[reason] };
}

function blockLine(s: Sending): Line | null {
  if (!s.last_block_message) return null;
  return { key: 'block', tone: 'red', text: `Último bloqueio: ${lastErrorText(s.last_block_message)}` };
}

const RULES: Array<(c: Ctx) => Line | null> = [
  (c) => qualityLine(c.health),
  (c) => tokenExpiredLine(c.health),
  (c) => tokenExpiringLine(c.health),
  (c) => qrLine(c.health),
  (c) => templateLine(c.health),
  (c) => pauseLine(c.sending),
  (c) => (c.health.level === 'ok' ? null : blockLine(c.sending)),
];

export function buildHealthLines(health: ChannelHealth, sending: Sending): Line[] {
  const lines = RULES.map((rule) => rule({ health, sending })).filter((l): l is Line => l !== null);
  const shown = new Set(lines.map((l) => l.text));
  const hasQuality = lines.some((l) => l.key === 'quality');
  for (const [i, note] of (health.notes ?? []).entries()) {
    if (shown.has(note)) continue;
    if (hasQuality && note.startsWith('A qualidade do número')) continue;
    lines.push({ key: `note-${i}`, tone: 'slate', text: note });
  }
  return lines;
}

const LEVEL: Record<ChannelHealth['level'], { tone: Tone; text: string }> = {
  ok: { tone: 'emerald', text: 'Canais de envio funcionando' },
  degraded: { tone: 'amber', text: 'Canais de envio com restrição' },
  down: { tone: 'red', text: 'Nenhum follow-up está saindo agora' },
};

function yesNo(v: boolean): string {
  return v ? 'sim' : 'não';
}

function LineRow({ line, canResume, resuming, onResume }: { line: Line; canResume: boolean; resuming: boolean; onResume: () => void }) {
  const navigate = useNavigate();
  const action = line.action;
  const showResume = !!action?.resume && canResume;
  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]', TONE_CLASSES[line.tone])}>
      <span className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{line.text}</span>
      {action?.to && (
        <button type="button" onClick={() => navigate(action.to as string)} className="text-[11px] font-bold underline-offset-2 hover:underline">
          {action.label}
        </button>
      )}
      {showResume && (
        <button type="button" onClick={onResume} disabled={resuming} className="flex items-center gap-1 text-[11px] font-bold underline-offset-2 hover:underline disabled:opacity-60">
          {resuming && <Loader2 size={11} className="animate-spin" />}
          {action?.label}
        </button>
      )}
    </li>
  );
}

interface Props {
  health: ChannelHealth;
  sending: Sending;
  enabled: boolean;
  mode: FollowUpMode;
  canResume: boolean;
  resuming: boolean;
  onResume: () => void;
}

export function ChannelHealthBanner({ health, sending, enabled, mode, canResume, resuming, onResume }: Props) {
  const level = LEVEL[health.level] ?? LEVEL.degraded;
  const lines = buildHealthLines(health, sending);
  return (
    <section className={cn('rounded-2xl border p-3', TONE_CLASSES[level.tone])}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-bold"><Radio size={14} />{level.text}</p>
        {enabled && mode === 'auto' && (
          <span className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-gray-800 dark:bg-black/20 dark:text-gray-100">
            <Bot size={11} /> Automático: a IA envia sem revisão
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] opacity-90">
        Agora dá para enviar: dentro de 24h {yesNo(health.can_send.inside_24h)} · fora de 24h {yesNo(health.can_send.outside_24h)}
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {lines.map((line) => <LineRow key={line.key} line={line} canResume={canResume} resuming={resuming} onResume={onResume} />)}
        </ul>
      )}
    </section>
  );
}
