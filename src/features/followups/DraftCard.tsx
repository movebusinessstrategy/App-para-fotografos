import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle, Check, ChevronDown, Info, Loader2, RotateCcw, SkipForward, Sparkles, Undo2, Wand2,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import type { ToastState } from '../galeria/Toast';
import { api, errorMessage, isItemChanged, type SkipScope } from './api';
import { ConversationPreview } from './ConversationPreview';
import { formatDayTime, hoursSilentLabel } from './format';
import {
  CHANNEL_LABELS, CONFLICT_TOAST, NO_APPROVE_PERMISSION, TEMPLATE_WINDOW_TEXT, TONE_CLASSES,
  lastErrorText, statusLabel, stepLabel, warningLabel, type Tone,
} from './labels';
import type { FollowUpDraftItem } from './types';

const MAX_TEXT = 1000;
const REGEN_CHIPS = ['Mais curto', 'Mais caloroso', 'Sem falar de preço'];

type Busy = null | 'approve' | 'skip' | 'regen' | 'patch';
type ActionKey = 'approve' | 'retry' | 'skip' | 'regen' | 'back_to_draft';

// Ações por status (a rota recusa o resto com 409).
const STATUS_ACTIONS: Record<string, ActionKey[]> = {
  draft: ['approve', 'skip', 'regen'],
  blocked: ['retry', 'skip', 'regen'],
  failed: ['regen'],
  approved: ['back_to_draft', 'skip'],
};

const EDITABLE = new Set(['draft', 'blocked']);

export interface DraftCardProps {
  item: FollowUpDraftItem;
  canApprove: boolean;
  enabled: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onChanged: (item: FollowUpDraftItem) => void;
  onConflict: () => void;
  onOpenDeal: (dealId: number) => void;
  onEditingChange: (id: number, editing: boolean) => void;
  onToast: (t: ToastState) => void;
}

// ─── Regras puras ────────────────────────────────────────────────────────────

const APPROVE_BLOCKERS: Array<(i: { item: FollowUpDraftItem; canApprove: boolean; enabled: boolean; text: string }) => string | null> = [
  (i) => (i.canApprove ? null : NO_APPROVE_PERMISSION),
  (i) => (i.enabled ? null : 'Ligue os follow-ups da IA antes de aprovar.'),
  (i) => (i.item.conversation_changed ? 'Chegou mensagem nova depois deste rascunho. Gere de novo antes de aprovar.' : null),
  (i) => (i.text.trim() ? null : 'O texto está vazio.'),
  (i) => (i.text.length > MAX_TEXT ? `O texto passa de ${MAX_TEXT} caracteres.` : null),
];

function approveBlockReason(i: { item: FollowUpDraftItem; canApprove: boolean; enabled: boolean; text: string }): string | null {
  for (const rule of APPROVE_BLOCKERS) {
    const reason = rule(i);
    if (reason) return reason;
  }
  return null;
}

function channelLine(item: FollowUpDraftItem): string {
  if (item.status === 'sent' && item.channel_used) return `Saiu pelo ${CHANNEL_LABELS[item.channel_used]}`;
  if (item.channel_forecast === 'blocked') return CHANNEL_LABELS.blocked;
  return `Sai pelo ${CHANNEL_LABELS[item.channel_forecast]}`;
}

interface Notice { key: string; tone: Tone; text: string }

const NOTICE_RULES: Array<(item: FollowUpDraftItem) => Notice | null> = [
  (item) => (item.conversation_changed
    ? { key: 'changed', tone: 'amber', text: 'Chegou mensagem nova depois deste rascunho. Gere de novo antes de aprovar.' }
    : null),
  (item) => (item.ai.invisible_basis
    ? { key: 'invisible', tone: 'slate', text: 'A IA oficial do WhatsApp respondeu por último; o texto dela não está disponível.' }
    : null),
  (item) => (item.ai.handoff_reason
    ? { key: 'handoff', tone: 'blue', text: `A IA acha melhor uma pessoa responder: ${item.ai.handoff_reason}` }
    : null),
  (item) => errorNotice(item),
];

const ERROR_TONES: Record<string, Tone> = { blocked: 'red', failed: 'red', cancelled: 'slate', skipped: 'slate' };

function errorNotice(item: FollowUpDraftItem): Notice | null {
  const tone = ERROR_TONES[item.status];
  const text = lastErrorText(item.last_error);
  if (!tone || !text) return null;
  return { key: 'error', tone, text };
}

function collectNotices(item: FollowUpDraftItem): Notice[] {
  return NOTICE_RULES.map((rule) => rule(item)).filter((n): n is Notice => n !== null);
}

function skipSuggestionOf(item: FollowUpDraftItem, local: string | null): string | null {
  if (local) return local;
  if (item.ai.skipped_by === 'user') return null;
  return item.ai.skip_reason;
}

// ─── Ações ───────────────────────────────────────────────────────────────────

interface ActionDeps {
  item: FollowUpDraftItem;
  onChanged: (item: FollowUpDraftItem) => void;
  onConflict: () => void;
  onToast: (t: ToastState) => void;
  resetEdit: () => void;
}

function useDraftActions(d: ActionDeps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [skipSuggestion, setSkipSuggestion] = useState<string | null>(null);

  const fail = (err: unknown) => {
    if (isItemChanged(err)) {
      d.onToast({ kind: 'info', message: CONFLICT_TOAST });
      d.onConflict();
      return;
    }
    d.onToast({ kind: 'error', message: errorMessage(err) });
  };

  const run = async (kind: Busy, work: () => Promise<string | null>) => {
    setBusy(kind);
    try {
      const message = await work();
      if (message) d.onToast({ kind: 'success', message });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const approve = (text: string | undefined) => run('approve', async () => {
    const res = await api.approve(d.item.id, text);
    d.resetEdit();
    d.onChanged(res.item);
    if (res.warning) { d.onToast({ kind: 'info', message: res.warning }); return null; }
    return 'Aprovado. Sai em horário comercial.';
  });

  const saveText = (text: string, done = 'Texto salvo.') => run('patch', async () => {
    const res = await api.patchText(d.item.id, text);
    d.resetEdit();
    d.onChanged(res.item);
    return done;
  });

  const skip = (scope: SkipScope) => run('skip', async () => {
    const res = await api.skip(d.item.id, scope);
    d.onChanged(res.item);
    return scope === 'deal' ? 'Este lead não recebe mais follow-ups.' : 'Passo pulado.';
  });

  const regenerate = (instruction: string, force: boolean) => run('regen', async () => {
    const res = await api.regenerate(d.item.id, { instruction: instruction.trim() || undefined, force });
    d.resetEdit();
    d.onChanged(res.item);
    setSkipSuggestion(res.ai_suggests_skip?.reason ?? null);
    return res.ai_suggests_skip ? null : 'Rascunho novo gerado.';
  });

  return { busy, skipSuggestion, approve, saveText, skip, regenerate };
}

// ─── Pedaços da tela ─────────────────────────────────────────────────────────

function DraftHeader({ item, selectable, selected, onToggleSelect, onOpenDeal }: Pick<DraftCardProps,
  'item' | 'selectable' | 'selected' | 'onToggleSelect' | 'onOpenDeal'>) {
  const status = statusLabel(item.status);
  const name = item.deal.contact_name || item.deal.title || 'Sem nome';
  return (
    <div className="flex items-start gap-2.5">
      {selectable && (
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(item.id)}
          className="mt-1 h-4 w-4 accent-gold-600" aria-label="Selecionar" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onOpenDeal(item.deal.id)}
            className="truncate text-sm font-semibold text-gray-900 hover:text-gold-700 dark:text-white dark:hover:text-gold-300">
            {name}
          </button>
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', TONE_CLASSES[status.tone])}>{status.label}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {item.deal.stage_name} · {stepLabel(item)} · {hoursSilentLabel(item.silence.hours)}
        </p>
      </div>
      <span className="flex-shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600 dark:bg-gray-700/60 dark:text-gray-300">
        {channelLine(item)}
      </span>
    </div>
  );
}

function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {notices.map((n) => (
        <p key={n.key} className={cn('flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]', TONE_CLASSES[n.tone])}>
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>{n.text}</span>
        </p>
      ))}
    </div>
  );
}

function WarningChips({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map((w) => (
        <span key={w} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONE_CLASSES.amber)}>
          <AlertTriangle size={10} /> {warningLabel(w)}
        </span>
      ))}
    </div>
  );
}

function SkipSuggestion({ reason, canForce, busy, onForce }: { reason: string | null; canForce: boolean; busy: boolean; onForce: () => void }) {
  if (!reason) return null;
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]', TONE_CLASSES.slate)}>
      <span>A IA sugere não enviar: {reason}</span>
      {canForce && (
        <button type="button" onClick={onForce} disabled={busy} className="font-semibold text-gold-700 hover:text-gold-600 disabled:opacity-60 dark:text-gold-400">
          Gerar mesmo assim
        </button>
      )}
    </div>
  );
}

function TemplatePreview({ item }: { item: FollowUpDraftItem }) {
  if (!item.template_preview) return null;
  return (
    <div className={cn('rounded-lg border px-3 py-2', TONE_CLASSES.blue)}>
      <p className="text-[11px] font-bold">Vai sair assim (template aprovado):</p>
      <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-800 dark:text-gray-100">{item.template_preview}</p>
      <p className="mt-1.5 text-[10px] opacity-80">{TEMPLATE_WINDOW_TEXT}</p>
    </div>
  );
}

interface EditorProps {
  text: string;
  dirty: boolean;
  original: string | null;
  busy: boolean;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onUndo: () => void;
  onSave: () => void;
}

function DraftEditor({ text, dirty, original, busy, onChange, onKeyDown, onUndo, onSave }: EditorProps) {
  const over = text.length > MAX_TEXT;
  return (
    <div>
      <textarea value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} rows={4}
        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-gold-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-400">
        <span className={cn(over && 'font-bold text-red-600')}>{text.length}/{MAX_TEXT} · Ctrl ou Cmd + Enter aprova, Esc desfaz</span>
        {dirty && (
          <span className="flex items-center gap-3">
            <button type="button" onClick={onUndo} className="flex items-center gap-1 font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
              <Undo2 size={11} /> Desfazer
            </button>
            <button type="button" onClick={onSave} disabled={busy || over || !text.trim()} className="font-semibold text-gold-700 hover:text-gold-600 disabled:opacity-50 dark:text-gold-400">
              Salvar texto
            </button>
          </span>
        )}
      </div>
      <OriginalText original={original} current={text} />
    </div>
  );
}

function OriginalText({ original, current }: { original: string | null; current: string }) {
  if (!original || original === current) return null;
  return (
    <details className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
      <summary className="cursor-pointer select-none">Ver o texto original da IA</summary>
      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-800/60">{original}</p>
    </details>
  );
}

function ReadOnlyText({ item }: { item: FollowUpDraftItem }) {
  if (!item.text) return null;
  return (
    <p className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-800 dark:bg-gray-800/60 dark:text-gray-100">{item.text}</p>
  );
}

function StatusInfo({ item }: { item: FollowUpDraftItem }) {
  const line = statusInfoLine(item);
  if (!line) return null;
  return <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{line}</p>;
}

function statusInfoLine(item: FollowUpDraftItem): string | null {
  if (item.status === 'approved') return `Aprovado por ${item.approved_by_label || 'alguém da equipe'} · sai em horário comercial`;
  if (item.status === 'sending') return 'Enviando agora.';
  if (item.status === 'sent' && item.sent_at) return `Enviado em ${formatDayTime(item.sent_at)}`;
  return null;
}

// ─── Botões ──────────────────────────────────────────────────────────────────

const BTN = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function ApproveButton({ label, blockReason, busy, onClick }: { label: string; blockReason: string | null; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!!blockReason || busy} title={blockReason ?? undefined}
      className={cn(BTN, 'bg-gold-600 text-white hover:bg-gold-700')}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
      {label}
    </button>
  );
}

function SkipMenu({ busy, onSkip }: { busy: boolean; onSkip: (scope: SkipScope) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (scope: SkipScope) => { setOpen(false); onSkip(scope); };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={busy}
        className={cn(BTN, 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800')}>
        <SkipForward size={13} /> Pular <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button type="button" onClick={() => pick('step')} className="block w-full px-3 py-2 text-left text-[12px] hover:bg-gray-50 dark:hover:bg-gray-700">
            Só este passo
          </button>
          <button type="button" onClick={() => pick('deal')} className="block w-full px-3 py-2 text-left text-[12px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
            Não fazer follow-up com este lead
          </button>
        </div>
      )}
    </div>
  );
}

function RegeneratePopover({ busy, onGenerate }: { busy: boolean; onGenerate: (instruction: string) => void }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const go = () => { setOpen(false); onGenerate(instruction); setInstruction(''); };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={busy}
        className={cn(BTN, 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800')}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Gerar de novo
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <input value={instruction} onChange={(e) => setInstruction(e.target.value.slice(0, 500))} placeholder="Instrução opcional para a IA"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-gold-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGEN_CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => setInstruction(c)}
                className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:border-gold-400 dark:border-gray-600 dark:text-gray-300">
                {c}
              </button>
            ))}
          </div>
          <button type="button" onClick={go} className={cn(BTN, 'mt-3 w-full justify-center bg-gray-900 text-white hover:bg-gray-800 dark:bg-gold-600 dark:hover:bg-gold-700')}>
            <Sparkles size={13} /> Gerar
          </button>
        </div>
      )}
    </div>
  );
}

interface ActionBarProps {
  actions: ActionKey[];
  busy: Busy;
  blockReason: string | null;
  onApprove: () => void;
  onBackToDraft: () => void;
  onSkip: (scope: SkipScope) => void;
  onRegenerate: (instruction: string) => void;
}

function ActionBar(p: ActionBarProps) {
  if (p.actions.length === 0) return null;
  const any = p.busy !== null;
  const has = (k: ActionKey) => p.actions.includes(k);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {has('approve') && <ApproveButton label="Aprovar" blockReason={p.blockReason} busy={p.busy === 'approve'} onClick={p.onApprove} />}
      {has('retry') && <ApproveButton label="Tentar de novo" blockReason={p.blockReason} busy={p.busy === 'approve'} onClick={p.onApprove} />}
      {has('back_to_draft') && (
        <button type="button" onClick={p.onBackToDraft} disabled={any}
          className={cn(BTN, 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800')}>
          <RotateCcw size={13} /> Voltar para rascunho
        </button>
      )}
      {has('skip') && <SkipMenu busy={any} onSkip={p.onSkip} />}
      {has('regen') && <RegeneratePopover busy={p.busy === 'regen'} onGenerate={p.onRegenerate} />}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function useEditableText(item: FollowUpDraftItem, onEditingChange: DraftCardProps['onEditingChange']) {
  const [text, setText] = useState(item.text);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setText(item.text); }, [item.text, dirty]);
  useEffect(() => { onEditingChange(item.id, dirty); }, [item.id, dirty, onEditingChange]);
  useEffect(() => () => onEditingChange(item.id, false), [item.id, onEditingChange]);
  const change = (v: string) => { setText(v); setDirty(v !== item.text); };
  const reset = () => { setText(item.text); setDirty(false); };
  return { text, dirty, change, reset };
}

export function DraftCard(props: DraftCardProps) {
  const { item } = props;
  const edit = useEditableText(item, props.onEditingChange);
  const actions = useDraftActions({ item, onChanged: props.onChanged, onConflict: props.onConflict, onToast: props.onToast, resetEdit: edit.reset });
  const blockReason = approveBlockReason({ item, canApprove: props.canApprove, enabled: props.enabled, text: edit.text });
  const editable = EDITABLE.has(item.status);
  const approve = () => { if (!blockReason) void actions.approve(edit.dirty ? edit.text : undefined); };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); edit.reset(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); approve(); }
  };

  const skipReason = skipSuggestionOf(item, actions.skipSuggestion);
  const canForce = STATUS_ACTIONS[item.status]?.includes('regen') || item.status === 'skipped';

  return (
    <article className="space-y-2.5 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-gray-700 dark:bg-gray-800/60">
      <DraftHeader item={item} selectable={props.selectable} selected={props.selected} onToggleSelect={props.onToggleSelect} onOpenDeal={props.onOpenDeal} />
      <ConversationPreview taskId={item.id} preview={item.preview} phone={item.deal.phone} />
      <NoticeList notices={collectNotices(item)} />
      <SkipSuggestion reason={skipReason} canForce={canForce} busy={actions.busy !== null}
        onForce={() => void actions.regenerate('', true)} />
      <WarningChips warnings={item.ai.warnings} />
      {editable
        ? <DraftEditor text={edit.text} dirty={edit.dirty} original={item.original_text} busy={actions.busy !== null}
            onChange={edit.change} onKeyDown={onKeyDown} onUndo={edit.reset} onSave={() => void actions.saveText(edit.text)} />
        : <ReadOnlyText item={item} />}
      <TemplatePreview item={item} />
      <StatusInfo item={item} />
      <ActionBar actions={STATUS_ACTIONS[item.status] ?? []} busy={actions.busy} blockReason={blockReason}
        onApprove={approve} onBackToDraft={() => void actions.saveText(item.text, 'Voltou para rascunho.')}
        onSkip={(scope) => void actions.skip(scope)} onRegenerate={(instruction) => void actions.regenerate(instruction, false)} />
    </article>
  );
}
