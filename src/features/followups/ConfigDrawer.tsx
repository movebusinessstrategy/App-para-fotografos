import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, Plus, Trash2, Wand2, X } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { refreshApi } from '../../utils/useApi';
import { cn } from '../../utils/cn';
import type { ToastState } from '../galeria/Toast';
import { api, CONFIG_URL, errorMessage, FollowUpApiError } from './api';
import { formatFullDate, parseListInput } from './format';
import {
  CONSENT_CHECKBOX_TEXT, DEDUPE_REQUIRED_TEXT, FIRST_STEP_WINDOW_TEXT, FIXED_MESSAGES_HELP, FIXED_NAME_HINT, MESSAGE_MODE_AI_TEXT,
  MESSAGE_MODE_FIXED_TEXT, PRE_QUOTE_HELP_TEXT, SUPPORT_MODE_TEXT, TEMPLATE_HINT_TEXT, TONE_CLASSES, WEEKDAY_SHORT,
  fixedTemplateStatusText,
} from './labels';
import {
  DEFAULT_PRE_QUOTE_DELAYS_HOURS, DEFAULT_STEP_DELAYS_HOURS, FIXED_MESSAGE_MAX_CHARS, FIXED_MESSAGES_MAX, PRE_QUOTE_MAX_STAGES,
  PRE_QUOTE_MAX_STEPS, type FixedTemplateInfo, type FollowUpConfig, type FollowUpConfigPutRequest, type FollowUpConfigPutResponse,
  type FollowUpConfigResponse, type TrackerConfig,
} from './types';

type Stage = FollowUpConfigResponse['stages'][number];
type Errors = Record<string, string>;
type SetConfig = (patch: Partial<FollowUpConfig>) => void;
type SetTracker = (patch: Partial<TrackerConfig>) => void;

const MAX_STEPS = 4;
const AUTO_CONFIRM_TEXT = 'No modo automático a IA envia sem sua revisão, dentro do horário e dos limites abaixo. Continuar?';

// ─── Peças genéricas ─────────────────────────────────────────────────────────

const INPUT = 'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-900 outline-none focus:border-gold-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-gray-100 pb-4 dark:border-gray-800">
      <div>
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-white">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">{msg}</p>;
}

function Note({ tone = 'amber', children }: { tone?: keyof typeof TONE_CLASSES; children: ReactNode }) {
  return <p className={cn('rounded-lg border px-2.5 py-1.5 text-[11px]', TONE_CLASSES[tone])}>{children}</p>;
}

function Check({ checked, onChange, label, disabled, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: string;
}) {
  return (
    <label className={cn('flex items-start gap-2 text-[12px] text-gray-800 dark:text-gray-100', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-gold-600" />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

function NumberField({ label, value, min, max, hint, error, onChange }: {
  label: string; value: number; min: number; max: number; hint?: string; error?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))} className={INPUT} />
      {hint && <span className="block text-[10px] text-gray-400">{hint}</span>}
      <FieldError msg={error} />
    </label>
  );
}

function StageSelect({ value, stages, emptyLabel, onChange, highlight }: {
  value: string | null; stages: Stage[]; emptyLabel: string; onChange: (v: string | null) => void; highlight?: boolean;
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
      className={cn(INPUT, highlight && 'border-gold-400 ring-2 ring-gold-200 dark:ring-gold-800')}>
      <option value="">{emptyLabel}</option>
      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

// Texto livre que só vira lista ao sair do campo (não atrapalha a digitação).
function ListField({ label, value, placeholder, onChange, error }: {
  label: string; value: string[]; placeholder: string; onChange: (v: string[]) => void; error?: string;
}) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => { setText(value.join(', ')); }, [value]);
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      <textarea value={text} rows={2} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(parseListInput(text))} className={INPUT} />
      <FieldError msg={error} />
    </label>
  );
}

// ─── Regras da escada ────────────────────────────────────────────────────────

function openStages(stages: Stage[]): Stage[] {
  return stages.filter((s) => !s.is_final).sort((a, b) => a.position - b.position);
}

function delayFor(delays: number[], i: number): number {
  return delays[i] ?? DEFAULT_STEP_DELAYS_HOURS[i] ?? 120;
}

// Mantém a escada em ordem de posição e um atraso por passo.
function withLadder(c: FollowUpConfig, ids: string[], stages: Stage[]): Partial<FollowUpConfig> {
  const pos = new Map(stages.map((s) => [s.id, s.position]));
  const sorted = [...ids].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)).slice(0, MAX_STEPS);
  const delays = sorted.length ? sorted.map((_, i) => delayFor(c.step_delays_hours, i)) : c.step_delays_hours;
  return { ladder_stage_ids: sorted, step_delays_hours: delays };
}

function focusSuggestion(c: FollowUpConfig, focusId: string | null, stages: Stage[]): Stage | null {
  if (!focusId || c.ladder_stage_ids.includes(focusId) || c.ladder_stage_ids.length >= MAX_STEPS) return null;
  return openStages(stages).find((s) => s.id === focusId) ?? null;
}

// ─── Seções ──────────────────────────────────────────────────────────────────

interface SectionProps {
  form: FollowUpConfig;
  set: SetConfig;
  errors: Errors;
  data: FollowUpConfigResponse;
}

function consentHint(data: FollowUpConfigResponse, impersonating: boolean): string | undefined {
  if (data.consent.external_ai) return data.consent.at ? `Autorizado em ${formatFullDate(data.consent.at)}.` : 'Autorizado.';
  if (impersonating) return 'No modo suporte, só o dono da conta pode autorizar.';
  return undefined;
}

function ConsentSection({ data, consent, impersonating, onConsent }: {
  data: FollowUpConfigResponse; consent: boolean; impersonating: boolean; onConsent: (v: boolean) => void;
}) {
  const given = data.consent.external_ai;
  return (
    <Section title="Autorização da IA">
      <Check checked={consent || given} disabled={given || impersonating} onChange={onConsent} label={CONSENT_CHECKBOX_TEXT}
        hint={consentHint(data, impersonating)} />
    </Section>
  );
}

function ActivateSection({ form, set, saved, impersonating }: SectionProps & { saved: FollowUpConfig; impersonating: boolean }) {
  const locked = impersonating && !saved.enabled;
  return (
    <Section title="Ativar">
      <Check checked={form.enabled} disabled={locked} onChange={(v) => set({ enabled: v })} label="Follow-ups da IA ligados"
        hint={locked ? SUPPORT_MODE_TEXT : 'Desligado, a IA ainda pode gerar rascunhos de teste, mas nada é enviado.'} />
    </Section>
  );
}

function ModeSection({ form, set, saved, impersonating, onAskAuto, errors }: SectionProps & {
  saved: FollowUpConfig; impersonating: boolean; onAskAuto: () => void;
}) {
  const autoLocked = impersonating && saved.mode !== 'auto';
  const pickAuto = () => (saved.mode === 'auto' ? set({ mode: 'auto' }) : onAskAuto());
  return (
    <Section title="Modo">
      <label className="flex items-center gap-2 text-[12px]">
        <input type="radio" checked={form.mode === 'approval'} onChange={() => set({ mode: 'approval' })} className="accent-gold-600" />
        Aprovar antes de enviar (recomendado)
      </label>
      <label className={cn('flex items-center gap-2 text-[12px]', autoLocked && 'opacity-60')}>
        <input type="radio" checked={form.mode === 'auto'} disabled={autoLocked} onChange={pickAuto} className="accent-gold-600" />
        Automático
      </label>
      {autoLocked && <Note tone="slate">{SUPPORT_MODE_TEXT}</Note>}
      <FieldError msg={errors.mode} />
    </Section>
  );
}

// ─── Mensagens (IA ou texto fixo por passo) ──────────────────────────────────

function followLabel(index: number): string {
  const label = `Follow ${String(index + 1).padStart(2, '0')}`;
  return index === FIXED_MESSAGES_MAX - 1 ? `${label} (opcional)` : label;
}

// O status é do texto salvo: campo alterado só vai para a Meta depois de salvar.
function FixedStatus({ text, saved, info }: { text: string; saved: string; info: FixedTemplateInfo | undefined }) {
  if (!text.trim()) return null;
  if (text.trim() !== saved.trim()) return <span className="text-[10px] text-gray-400">Vai para a Meta ao salvar</span>;
  if (!info) return null;
  const status = fixedTemplateStatusText(info.status, info.reason);
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONE_CLASSES[status.tone])}>{status.text}</span>;
}

function FixedMessageField({ index, text, saved, info, onChange }: {
  index: number; text: string; saved: string; info: FixedTemplateInfo | undefined; onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{followLabel(index)}</span>
        <FixedStatus text={text} saved={saved} info={info} />
      </span>
      <textarea value={text} rows={3} maxLength={FIXED_MESSAGE_MAX_CHARS} onChange={(e) => onChange(e.target.value)} className={INPUT} />
    </label>
  );
}

function FixedMessagesFields({ form, set, data }: { form: FollowUpConfig; set: SetConfig; data: FollowUpConfigResponse }) {
  const texts = Array.from({ length: FIXED_MESSAGES_MAX }, (_, i) => form.fixed_messages?.[i] ?? '');
  const saved = data.config.fixed_messages ?? [];
  const infos = data.fixed_templates ?? [];
  const setText = (index: number, value: string) => set({ fixed_messages: texts.map((t, j) => (j === index ? value : t)) });
  return (
    <div className="space-y-3">
      <Note tone="slate">{FIXED_MESSAGES_HELP}</Note>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{FIXED_NAME_HINT}</p>
      {texts.map((text, i) => (
        <FixedMessageField key={i} index={i} text={text} saved={saved[i] ?? ''} info={infos.find((f) => f.step === i + 1)}
          onChange={(v) => setText(i, v)} />
      ))}
    </div>
  );
}

function MessagesSection({ form, set, errors, data }: SectionProps) {
  const fixed = form.message_mode === 'fixed';
  return (
    <Section title="Mensagens">
      <label className="flex items-center gap-2 text-[12px]">
        <input type="radio" checked={fixed} onChange={() => set({ message_mode: 'fixed' })} className="accent-gold-600" />
        {MESSAGE_MODE_FIXED_TEXT}
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="radio" checked={!fixed} onChange={() => set({ message_mode: 'ai' })} className="accent-gold-600" />
        {MESSAGE_MODE_AI_TEXT}
      </label>
      {fixed && <FixedMessagesFields form={form} set={set} data={data} />}
      <FieldError msg={errors.message_mode} />
      <FieldError msg={errors.fixed_messages} />
    </Section>
  );
}

function LadderRow({ index, stageId, delay, stages, highlight, onStage, onDelay, onRemove }: {
  index: number; stageId: string; delay: number; stages: Stage[]; highlight: boolean;
  onStage: (id: string | null) => void; onDelay: (h: number) => void; onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_96px_auto] items-center gap-2">
      <span className="text-[11px] font-bold text-gray-500">Passo {index + 1}</span>
      <StageSelect value={stageId} stages={stages} emptyLabel="Escolha a etapa" onChange={onStage} highlight={highlight} />
      <label className="flex items-center gap-1">
        <input type="number" min={1} max={720} value={delay} onChange={(e) => onDelay(Number(e.target.value))} className={INPUT} />
        <span className="text-[10px] text-gray-400">h</span>
      </label>
      <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover passo">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function LadderSection({ form, set, errors, data, focusStageId }: SectionProps & { focusStageId: string | null }) {
  const stages = openStages(data.stages);
  const ids = form.ladder_stage_ids;
  const setIds = (next: string[]) => set(withLadder(form, next, data.stages));
  const setDelay = (i: number, h: number) => set({ step_delays_hours: ids.map((_, j) => (j === i ? h : delayFor(form.step_delays_hours, j))) });
  const free = stages.find((s) => !ids.includes(s.id));
  const suggestion = focusSuggestion(form, focusStageId, data.stages);
  const useSuggested = () => set({
    ladder_stage_ids: data.suggested.ladder_stage_ids, step_delays_hours: data.suggested.step_delays_hours,
    after_last_stage_id: data.suggested.after_last_stage_id,
  });
  return (
    <Section title="Escada de follow-ups" hint="Cada passo vale para os leads parados naquela etapa. O atraso conta desde a última mensagem do estúdio.">
      {ids.map((id, i) => (
        <LadderRow key={`${i}-${id}`} index={i} stageId={id} delay={delayFor(form.step_delays_hours, i)} stages={stages}
          highlight={id === focusStageId}
          onStage={(v) => setIds(ids.map((x, j) => (j === i ? v ?? x : x)))}
          onDelay={(h) => setDelay(i, h)} onRemove={() => setIds(ids.filter((_, j) => j !== i))} />
      ))}
      <FieldError msg={errors.ladder_stage_ids} />
      <FieldError msg={errors.step_delays_hours} />
      {suggestion && (
        <Note tone="gold">
          Esta etapa não está na cadência. Adicionar como passo {ids.length + 1}?{' '}
          <button type="button" onClick={() => setIds([...ids, suggestion.id])} className="font-bold underline">Adicionar {suggestion.name}</button>
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        {ids.length < MAX_STEPS && free && (
          <button type="button" onClick={() => setIds([...ids, free.id])} className="flex items-center gap-1 text-[12px] font-semibold text-gold-700 dark:text-gold-400">
            <Plus size={13} /> Adicionar passo
          </button>
        )}
        {data.suggested.ladder_stage_ids.length > 0 && (
          <button type="button" onClick={useSuggested} className="flex items-center gap-1 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
            <Wand2 size={13} /> Usar sugestão
          </button>
        )}
      </div>
      {delayFor(form.step_delays_hours, 0) >= 24 && ids.length > 0 && <Note>{FIRST_STEP_WINDOW_TEXT}</Note>}
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Depois do último passo, mover para</span>
        <StageSelect value={form.after_last_stage_id} stages={stages.filter((s) => !ids.includes(s.id))} emptyLabel="Não mover"
          onChange={(v) => set({ after_last_stage_id: v })} highlight={form.after_last_stage_id === focusStageId && !!focusStageId} />
        <FieldError msg={errors.after_last_stage_id} />
      </label>
    </Section>
  );
}

// ─── Antes do orçamento ──────────────────────────────────────────────────────

// Só etapas abertas que vêm antes da 1ª etapa da escada (e fora dela).
function preQuoteCandidates(form: FollowUpConfig, stages: Stage[]): Stage[] {
  const open = openStages(stages);
  const ladder = new Set([...form.ladder_stage_ids, form.after_last_stage_id ?? '']);
  const ladderPositions = open.filter((s) => ladder.has(s.id)).map((s) => s.position);
  const limit = ladderPositions.length ? Math.min(...ladderPositions) : Infinity;
  return open.filter((s) => !ladder.has(s.id) && s.position < limit);
}

function preQuoteDelay(delays: number[], i: number): number {
  return delays[i] ?? DEFAULT_PRE_QUOTE_DELAYS_HOURS[i] ?? 72;
}

function PreQuoteStages({ form, set, stages }: { form: FollowUpConfig; set: SetConfig; stages: Stage[] }) {
  const ids = form.pre_quote_stage_ids ?? [];
  const setIds = (next: string[]) => set({ pre_quote_stage_ids: next.slice(0, PRE_QUOTE_MAX_STAGES) });
  const free = stages.find((s) => !ids.includes(s.id));
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Etapas</span>
      {ids.map((id, i) => (
        <div key={`${i}-${id}`} className="grid grid-cols-[1fr_auto] items-center gap-2">
          <StageSelect value={id} stages={stages} emptyLabel="Escolha a etapa" onChange={(v) => setIds(ids.map((x, j) => (j === i ? v ?? x : x)))} />
          <button type="button" onClick={() => setIds(ids.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover etapa">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {ids.length < PRE_QUOTE_MAX_STAGES && free && (
        <button type="button" onClick={() => setIds([...ids, free.id])} className="flex items-center gap-1 text-[12px] font-semibold text-gold-700 dark:text-gold-400">
          <Plus size={13} /> Adicionar etapa
        </button>
      )}
    </div>
  );
}

function PreQuoteDelays({ form, set }: { form: FollowUpConfig; set: SetConfig }) {
  const delays = form.pre_quote_delays_hours?.length ? form.pre_quote_delays_hours : [...DEFAULT_PRE_QUOTE_DELAYS_HOURS];
  const setDelay = (i: number, h: number) => set({ pre_quote_delays_hours: delays.map((d, j) => (j === i ? h : d)) });
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Toques (horas desde a última mensagem do estúdio)</span>
      {delays.map((d, i) => (
        <div key={i} className="grid grid-cols-[auto_96px_auto] items-center gap-2">
          <span className="text-[11px] font-bold text-gray-500">Toque {i + 1}</span>
          <label className="flex items-center gap-1">
            <input type="number" min={1} max={720} value={d} onChange={(e) => setDelay(i, Number(e.target.value))} className={INPUT} />
            <span className="text-[10px] text-gray-400">h</span>
          </label>
          {delays.length > 1 && i === delays.length - 1 && (
            <button type="button" onClick={() => set({ pre_quote_delays_hours: delays.slice(0, -1) })} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover toque">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
      {delays.length < PRE_QUOTE_MAX_STEPS && (
        <button type="button" onClick={() => set({ pre_quote_delays_hours: [...delays, preQuoteDelay(delays, delays.length)] })}
          className="flex items-center gap-1 text-[12px] font-semibold text-gold-700 dark:text-gold-400">
          <Plus size={13} /> Adicionar toque
        </button>
      )}
    </div>
  );
}

function PreQuoteSection({ form, set, errors, data }: SectionProps) {
  const stages = preQuoteCandidates(form, data.stages);
  const suggested = data.suggested.pre_quote_stage_ids ?? [];
  const useSuggested = () => set({ pre_quote_stage_ids: suggested, pre_quote_delays_hours: data.suggested.pre_quote_delays_hours ?? [...DEFAULT_PRE_QUOTE_DELAYS_HOURS] });
  return (
    <Section title="Antes do orçamento" hint={PRE_QUOTE_HELP_TEXT}>
      <PreQuoteStages form={form} set={set} stages={stages} />
      <FieldError msg={errors.pre_quote_stage_ids} />
      <PreQuoteDelays form={form} set={set} />
      <FieldError msg={errors.pre_quote_delays_hours} />
      {suggested.length > 0 && (form.pre_quote_stage_ids ?? []).length === 0 && (
        <button type="button" onClick={useSuggested} className="flex items-center gap-1 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
          <Wand2 size={13} /> Usar sugestão
        </button>
      )}
      {stages.length === 0 && <Note tone="slate">Nenhuma etapa aberta antes da escada. Ajuste a escada para liberar esta trilha.</Note>}
    </Section>
  );
}

function HolidayList({ holidays, onChange }: { holidays: string[]; onChange: (v: string[]) => void }) {
  const [day, setDay] = useState('');
  const add = () => { if (day && !holidays.includes(day)) onChange([...holidays, day].sort()); setDay(''); };
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Feriados (nada sai nestes dias)</span>
      <div className="flex flex-wrap gap-1.5">
        {holidays.map((h) => (
          <span key={h} className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] dark:border-gray-700">
            {h.split('-').reverse().join('/')}
            <button type="button" onClick={() => onChange(holidays.filter((x) => x !== h))} aria-label="Remover feriado"><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(INPUT, 'max-w-[170px]')} />
        <button type="button" onClick={add} disabled={!day} className="text-[12px] font-semibold text-gold-700 disabled:opacity-50 dark:text-gold-400">Adicionar</button>
      </div>
    </div>
  );
}

function HoursSection({ form, set, errors }: SectionProps) {
  const h = form.business_hours;
  const setHours = (patch: Partial<typeof h>) => set({ business_hours: { ...h, ...patch } });
  const toggleDay = (d: number) => setHours({ days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d].sort() });
  return (
    <Section title="Horário comercial" hint={`Fuso ${h.tz}. Fora deste horário nada sai; os aprovados esperam a próxima abertura.`}>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAY_SHORT.map((label, d) => (
          <button key={label} type="button" onClick={() => toggleDay(d)}
            className={cn('rounded-lg border px-2.5 py-1 text-[11px] font-semibold', h.days.includes(d)
              ? 'border-gold-400 bg-gold-50 text-gold-800 dark:bg-gold-900/30 dark:text-gold-200'
              : 'border-gray-200 text-gray-500 dark:border-gray-700')}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        das <input type="time" value={h.start} onChange={(e) => setHours({ start: e.target.value })} className={cn(INPUT, 'max-w-[110px]')} />
        até <input type="time" value={h.end} onChange={(e) => setHours({ end: e.target.value })} className={cn(INPUT, 'max-w-[110px]')} />
      </div>
      <HolidayList holidays={h.holidays ?? []} onChange={(holidays) => setHours({ holidays })} />
      <FieldError msg={errors.business_hours} />
    </Section>
  );
}

type NumericKey = 'daily_cap' | 'min_gap_seconds' | 'max_gap_seconds' | 'max_consecutive_errors'
  | 'max_silence_hours' | 'sweep_interval_minutes' | 'max_drafts_per_sweep';

const PACE_FIELDS: Array<{ key: NumericKey; label: string; min: number; max: number; hint?: string }> = [
  { key: 'daily_cap', label: 'Teto de envios por dia', min: 1, max: 200, hint: 'Nas 2 primeiras semanas depois de ligar vale no máximo 10 por dia.' },
  { key: 'min_gap_seconds', label: 'Intervalo mínimo entre envios (segundos)', min: 30, max: 900 },
  { key: 'max_gap_seconds', label: 'Intervalo máximo entre envios (segundos)', min: 30, max: 1800 },
  { key: 'max_consecutive_errors', label: 'Parar após quantos erros seguidos', min: 1, max: 10 },
  { key: 'max_silence_hours', label: 'Ignorar conversas paradas há mais de (horas)', min: 24, max: 2160 },
  { key: 'sweep_interval_minutes', label: 'Ler as conversas a cada (minutos)', min: 15, max: 1440 },
  { key: 'max_drafts_per_sweep', label: 'Máximo de rascunhos por leitura', min: 1, max: 60 },
];

function PaceSection({ form, set, errors }: SectionProps) {
  return (
    <Section title="Ritmo e limites">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PACE_FIELDS.map((f) => (
          <NumberField key={f.key} label={f.label} value={form[f.key]} min={f.min} max={f.max} hint={f.hint}
            error={errors[f.key]} onChange={(v) => set({ [f.key]: v } as Partial<FollowUpConfig>)} />
        ))}
      </div>
    </Section>
  );
}

function TemplateOption({ t, checked, onPick }: { t: FollowUpConfigResponse['templates'][number]; checked: boolean; onPick: () => void }) {
  return (
    <label className={cn('flex items-start gap-2 rounded-lg border p-2 text-[12px]', t.eligible ? 'cursor-pointer border-gray-200 dark:border-gray-700' : 'border-gray-100 opacity-60 dark:border-gray-800')}>
      <input type="radio" checked={checked} disabled={!t.eligible} onChange={onPick} className="mt-0.5 accent-gold-600" />
      <span className="min-w-0">
        <span className="font-semibold">{t.name}</span>
        <span className="ml-1 text-[10px] text-gray-400">{[t.language, t.category].filter(Boolean).join(' · ')}</span>
        {t.eligible
          ? t.preview && <span className="mt-0.5 block whitespace-pre-wrap text-[11px] text-gray-500 dark:text-gray-400">{t.preview}</span>
          : <span className="mt-0.5 block text-[11px] text-red-600 dark:text-red-400">{t.reason || 'Não serve para retomada.'}</span>}
      </span>
    </label>
  );
}

function ChannelsSection({ form, set, errors, data }: SectionProps) {
  const qrLocked = !data.dedupe_ready && !form.allow_baileys;
  return (
    <Section title="Canais de envio">
      <Check checked={form.allow_meta_text} onChange={(v) => set({ allow_meta_text: v })}
        label="Texto livre pela API oficial (dentro de 24h da última mensagem do cliente)" />
      <Check checked={form.allow_baileys} disabled={qrLocked} onChange={(v) => set({ allow_baileys: v })}
        label="Enviar pelo WhatsApp (QR)"
        hint={qrLocked ? DEDUPE_REQUIRED_TEXT : 'O QR usa um cliente não oficial. Mantenha o teto diário baixo para não arriscar o número.'} />
      <FieldError msg={errors.allow_baileys} />
      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Template para fora da janela de 24h</span>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="radio" checked={form.template_id === null} onChange={() => set({ template_id: null })} className="accent-gold-600" /> Sem template
        </label>
        {data.templates.map((t) => (
          <TemplateOption key={t.id} t={t} checked={form.template_id === t.id} onPick={() => set({ template_id: t.id })} />
        ))}
        <Note tone="slate">{TEMPLATE_HINT_TEXT}</Note>
        <FieldError msg={errors.template_id} />
      </div>
    </Section>
  );
}

function InstructionsSection({ form, set, errors }: SectionProps) {
  const hasHashes = form.extra_instructions.includes('###');
  return (
    <Section title="Instruções extras para a IA" hint="Opcional. Ex.: sempre assinar com o nome do estúdio.">
      <textarea value={form.extra_instructions} rows={3} maxLength={1000}
        onChange={(e) => set({ extra_instructions: e.target.value })} className={INPUT} />
      <p className="text-right text-[10px] text-gray-400">{form.extra_instructions.length}/1000</p>
      {hasHashes && <FieldError msg="Não use ### nas instruções." />}
      <FieldError msg={errors.extra_instructions} />
      <Check checked={form.optout_detection} onChange={(v) => set({ optout_detection: v })}
        label="Detectar pedidos para parar de receber mensagens" />
    </Section>
  );
}

const TRACKER_TOGGLES: Array<{ key: keyof TrackerConfig; label: string }> = [
  { key: 'create_deal_on_inbound', label: 'Criar lead quando chegar mensagem de um número novo' },
  { key: 'recreate_after_lost', label: 'Lead perdido que volta a escrever vira card novo' },
  { key: 'skip_existing_customers', label: 'Não criar card para quem já é cliente' },
  { key: 'count_bot_as_studio_reply', label: 'Resposta da IA oficial do WhatsApp conta como Conversa iniciada' },
  { key: 'generic_pdf_is_quote', label: 'PDF sem nome de pacote conta como orçamento' },
];

function TrackerStages({ t, setTracker, stages, errors }: { t: TrackerConfig; setTracker: SetTracker; stages: Stage[]; errors: Errors }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Etapa de entrada</span>
        <StageSelect value={t.entry_stage_id} stages={stages} emptyLabel="Primeira etapa aberta" onChange={(v) => setTracker({ entry_stage_id: v })} />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Conversa iniciada</span>
        <StageSelect value={t.contact_stage_id} stages={stages} emptyLabel="Não mover" onChange={(v) => setTracker({ contact_stage_id: v })} />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Orçamento enviado</span>
        <StageSelect value={t.proposal_stage_id} stages={stages} emptyLabel="Não mover" onChange={(v) => setTracker({ proposal_stage_id: v })} />
      </label>
      <div className="sm:col-span-3"><FieldError msg={errors.tracker_config} /></div>
    </div>
  );
}

function TrackerSection({ form, set, errors, data }: SectionProps) {
  const t = form.tracker_config;
  const setTracker: SetTracker = (patch) => set({ tracker_config: { ...t, ...patch } });
  const stages = openStages(data.stages);
  const useSuggested = () => setTracker({
    entry_stage_id: data.suggested.entry_stage_id, contact_stage_id: data.suggested.contact_stage_id,
    proposal_stage_id: data.suggested.proposal_stage_id,
  });
  return (
    <Section title="Funil automático" hint="Cria o lead quando chega mensagem e anda o card sozinho: resposta do estúdio vai para Conversa iniciada, PDF de orçamento vai para Orçamento enviado. Só anda para frente.">
      <Check checked={form.tracker_enabled} onChange={(v) => set({ tracker_enabled: v })} label="Funil automático ligado" />
      <TrackerStages t={t} setTracker={setTracker} stages={stages} errors={errors} />
      <button type="button" onClick={useSuggested} className="flex items-center gap-1 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
        <Wand2 size={13} /> Usar sugestão de etapas
      </button>
      {TRACKER_TOGGLES.map((f) => (
        <Check key={f.key} checked={!!t[f.key]} onChange={(v) => setTracker({ [f.key]: v } as Partial<TrackerConfig>)} label={f.label} />
      ))}
      <ListField label="Números ignorados (nunca viram lead)" value={t.ignored_phones} placeholder="5543999990000, 5543988880000"
        onChange={(v) => setTracker({ ignored_phones: v })} />
      <ListField label="Palavras que indicam PDF de orçamento" value={t.quote_keywords} placeholder="orcamento, pacote, valores"
        onChange={(v) => setTracker({ quote_keywords: v })} />
      <ListField label="Palavras que NÃO são orçamento" value={t.quote_exclusions} placeholder="contrato, recibo, dicas"
        onChange={(v) => setTracker({ quote_exclusions: v })} />
    </Section>
  );
}

// A rota só desliga a mensagem fixa nas etapas da escada e no destino final.
function legacySplit(form: FollowUpConfig, data: FollowUpConfigResponse) {
  // Espelha o servidor: as etapas antes do orçamento também desligam a mensagem fixa.
  const preQuote = form.pre_quote_delays_hours?.length ? form.pre_quote_stage_ids ?? [] : [];
  const onLadder = new Set([...form.ladder_stage_ids, ...preQuote, form.after_last_stage_id ?? '']);
  return {
    inside: data.legacy_automation.filter((s) => onLadder.has(s.stage_id)),
    outside: data.legacy_automation.filter((s) => !onLadder.has(s.stage_id)),
  };
}

function LegacySection({ form, data, disableLegacy, onToggle }: SectionProps & { disableLegacy: boolean; onToggle: (v: boolean) => void }) {
  const { inside, outside } = legacySplit(form, data);
  if (data.legacy_automation.length === 0) return null;
  return (
    <Section title="Automação antiga">
      {inside.length > 0 && (
        <Check checked={disableLegacy} onChange={onToggle}
          label={`Desligar a mensagem fixa antiga nestas etapas: ${inside.map((s) => s.stage_name).join(', ')}`} />
      )}
      {outside.length > 0 && (
        <Note tone="slate">A mensagem fixa antiga continua ligada em: {outside.map((s) => s.stage_name).join(', ')} (fora da cadência).</Note>
      )}
    </Section>
  );
}

function SaveResult({ result, stages, onClose }: { result: FollowUpConfigPutResponse; stages: Stage[]; onClose: () => void }) {
  const names = result.legacy_disabled.map((id) => stages.find((s) => s.id === id)?.name ?? id);
  return (
    <div className="space-y-2.5">
      <Note tone="emerald">Configurações salvas.</Note>
      {result.demoted_auto > 0 && (
        <Note>{result.demoted_auto === 1 ? '1 envio aprovado pela IA voltou para revisão.' : `${result.demoted_auto} envios aprovados pela IA voltaram para revisão.`}</Note>
      )}
      {(result.fixed_rerendered ?? 0) > 0 && (
        <Note tone="slate">{result.fixed_rerendered === 1 ? '1 follow-up da fila passou a usar a mensagem fixa.' : `${result.fixed_rerendered} follow-ups da fila passaram a usar as mensagens fixas.`}</Note>
      )}
      {names.length > 0 && <Note tone="slate">Mensagem fixa antiga desligada em: {names.join(', ')}.</Note>}
      {result.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-300"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{w}</p>
      ))}
      <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-4 py-2 text-[12px] font-semibold text-white dark:bg-gold-600">Fechar</button>
    </div>
  );
}

// ─── Estado da gaveta ────────────────────────────────────────────────────────

function useConfigForm(open: boolean) {
  const [data, setData] = useState<FollowUpConfigResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FollowUpConfig | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [disableLegacy, setDisableLegacy] = useState(true);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.getConfig();
      setData(res);
      setForm({ ...res.config, business_hours: { ...res.config.business_hours }, tracker_config: { ...res.config.tracker_config } });
      setConsent(false);
      setConfirmAuto(false);
      setDisableLegacy(true);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setForm(null);
    void load();
  }, [open, load]);

  const set: SetConfig = (patch) => setForm((f) => (f ? { ...f, ...patch } : f));
  return { data, loadError, load, form, set, consent, setConsent, confirmAuto, setConfirmAuto, disableLegacy, setDisableLegacy };
}

type FormState = ReturnType<typeof useConfigForm>;

function buildPutBody(s: FormState): FollowUpConfigPutRequest {
  const form = s.form as FollowUpConfig;
  const body: FollowUpConfigPutRequest = { ...form };
  if (s.confirmAuto) body.confirm_auto = true;
  if (s.data && legacySplit(form, s.data).inside.length > 0) body.disable_legacy_on_ladder = s.disableLegacy;
  if (s.consent && !s.data?.consent.external_ai) body.consent_to_external_ai = true;
  return body;
}

function useSave(s: FormState, deps: { onSaved: () => void; onToast: (t: ToastState) => void; onClose: () => void; onAutoConfirm: () => void }) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState('');
  const [result, setResult] = useState<FollowUpConfigPutResponse | null>(null);

  const handleError = (err: unknown) => {
    if (err instanceof FollowUpApiError && err.code === 'AUTO_CONFIRM_REQUIRED') { deps.onAutoConfirm(); return; }
    if (err instanceof FollowUpApiError && err.fields) setErrors(err.fields);
    setSaveError(errorMessage(err));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    setSaveError('');
    try {
      const res = await api.saveConfig(buildPutBody(s));
      void refreshApi(CONFIG_URL);
      deps.onSaved();
      const quiet = res.warnings.length === 0 && res.demoted_auto === 0 && res.legacy_disabled.length === 0 && !res.fixed_rerendered;
      if (quiet) { deps.onToast({ kind: 'success', message: 'Configurações salvas.' }); deps.onClose(); return; }
      setResult(res);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const reset = useCallback(() => { setErrors({}); setSaveError(''); setResult(null); }, []);
  return { saving, errors, saveError, result, save, reset };
}

// ─── Gaveta ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  focusStageId: string | null;
  impersonating: boolean;
  onClose: () => void;
  onToast: (t: ToastState) => void;
  onSaved: () => void;
}

export function ConfigDrawer({ open, focusStageId, impersonating, onClose, onToast, onSaved }: Props) {
  const s = useConfigForm(open);
  const [askAuto, setAskAuto] = useState(false);
  const saver = useSave(s, { onSaved, onToast, onClose, onAutoConfirm: () => setAskAuto(true) });
  const { reset } = saver;
  useEffect(() => { if (open) reset(); }, [open, reset]);
  if (!open) return null;

  const confirmAuto = () => { setAskAuto(false); s.setConfirmAuto(true); s.set({ mode: 'auto' }); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-gray-900">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">Configurar follow-ups da IA</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <DrawerBody s={s} saver={saver} focusStageId={focusStageId} impersonating={impersonating} onAskAuto={() => setAskAuto(true)} onClose={onClose} />
        </div>
        <DrawerFooter s={s} saver={saver} onClose={onClose} />
      </aside>
      <ConfirmModal open={askAuto} title="Modo automático" message={AUTO_CONFIRM_TEXT} confirmText="Continuar" variant="warning"
        onConfirm={confirmAuto} onCancel={() => setAskAuto(false)} />
    </div>
  );
}

type Saver = ReturnType<typeof useSave>;

function DrawerBody({ s, saver, focusStageId, impersonating, onAskAuto, onClose }: {
  s: FormState; saver: Saver; focusStageId: string | null; impersonating: boolean; onAskAuto: () => void; onClose: () => void;
}) {
  if (s.loadError) {
    return (
      <div className="space-y-2 text-[12px] text-red-600 dark:text-red-400">
        <p>{s.loadError}</p>
        <button type="button" onClick={() => void s.load()} className="font-bold underline">Tentar de novo</button>
      </div>
    );
  }
  if (!s.data || !s.form) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  if (saver.result) return <SaveResult result={saver.result} stages={s.data.stages} onClose={onClose} />;
  const common: SectionProps = { form: s.form, set: s.set, errors: saver.errors, data: s.data };
  return (
    <div className="space-y-4">
      {!s.data.can_edit && <Note tone="slate">Só o dono da conta altera estas configurações.</Note>}
      <fieldset disabled={!s.data.can_edit} className="space-y-4">
        <ConsentSection data={s.data} consent={s.consent} impersonating={impersonating} onConsent={s.setConsent} />
        <ActivateSection {...common} saved={s.data.config} impersonating={impersonating} />
        <ModeSection {...common} saved={s.data.config} impersonating={impersonating} onAskAuto={onAskAuto} />
        <MessagesSection {...common} />
        <LadderSection {...common} focusStageId={focusStageId} />
        <PreQuoteSection {...common} />
        <HoursSection {...common} />
        <PaceSection {...common} />
        <ChannelsSection {...common} />
        <InstructionsSection {...common} />
        <TrackerSection {...common} />
        <LegacySection {...common} disableLegacy={s.disableLegacy} onToggle={s.setDisableLegacy} />
      </fieldset>
    </div>
  );
}

function DrawerFooter({ s, saver, onClose }: { s: FormState; saver: Saver; onClose: () => void }) {
  if (!s.data?.can_edit || saver.result) return null;
  return (
    <footer className="space-y-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
      {saver.saveError && <p className="text-[12px] font-semibold text-red-600 dark:text-red-400">{saver.saveError}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-[12px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">Cancelar</button>
        <button type="button" onClick={() => void saver.save()} disabled={saver.saving || !s.form}
          className="flex items-center gap-1.5 rounded-lg bg-gold-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:opacity-60">
          {saver.saving && <Loader2 size={13} className="animate-spin" />} Salvar
        </button>
      </div>
    </footer>
  );
}
