import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import type { PipelineStage } from '../../types';
import { cn } from '../../utils/cn';
import type { ToastState } from '../galeria/Toast';
import { api, errorMessage } from './api';
import { formatDayTime } from './format';
import { MARKETING_EVENT_NOTE, TONE_CLASSES } from './labels';
import type { ReconcileApplyResult, ReconcileCreateItem, ReconcileItem, ReconcilePreview } from './types';

const MAX_DEALS = 300;
const MAX_PHONES = 100;

function defaultSelection(p: ReconcilePreview): { deals: Set<number>; phones: Set<string> } {
  const deals = new Set<number>();
  for (const item of [...p.to_proposal, ...p.to_contact]) {
    if (!item.fires_marketing_event) deals.add(item.deal_id);
  }
  return { deals, phones: new Set(p.to_create.slice(0, MAX_PHONES).map((c) => c.phone)) };
}

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function resultText(r: ReconcileApplyResult): string {
  const parts = [`Pronto: ${r.moved} ${r.moved === 1 ? 'card movido' : 'cards movidos'}, ${r.created} ${r.created === 1 ? 'lead criado' : 'leads criados'}.`];
  const unchanged = r.noop + r.conflicts + r.refused;
  if (unchanged > 0) parts.push(`${unchanged} não mudaram porque o card já tinha andado ou mudou no meio.`);
  if (r.skipped_marketing > 0) parts.push(`${r.skipped_marketing} ficaram de fora para não disparar evento de anúncio.`);
  return parts.join(' ');
}

function usePreview(open: boolean) {
  const [preview, setPreview] = useState<ReconcilePreview | null>(null);
  const [error, setError] = useState('');
  const [deals, setDeals] = useState<Set<number>>(() => new Set());
  const [phones, setPhones] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setError('');
    setPreview(null);
    try {
      const p = await api.reconcilePreview();
      const sel = defaultSelection(p);
      setPreview(p);
      setDeals(sel.deals);
      setPhones(sel.phones);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);
  return { preview, error, load, deals, setDeals, phones, setPhones };
}

function ListBox({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[13px] font-bold text-gray-900 dark:text-white">{title} ({count})</h3>
      {count === 0
        ? <p className="text-[11px] text-gray-400">Nada nesta lista.</p>
        : <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">{children}</ul>}
    </section>
  );
}

function CreateRow({ item, checked, onToggle }: { item: ReconcileCreateItem; checked: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-[12px]">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 h-4 w-4 accent-gold-600" />
        <span>
          <span className="font-semibold text-gray-900 dark:text-white">{item.contact_name || item.phone}</span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400">
            {item.phone} · {item.inbound_count} {item.inbound_count === 1 ? 'mensagem' : 'mensagens'} · última em {formatDayTime(item.last_inbound_at)}
          </span>
        </span>
      </label>
    </li>
  );
}

function MoveRow({ item, checked, locked, stageName, onToggle }: {
  item: ReconcileItem; checked: boolean; locked: boolean; stageName: (id: string) => string; onToggle: () => void;
}) {
  const evidence = item.evidence.filename || (item.reason === 'studio_reply' ? 'resposta do estúdio' : 'PDF enviado');
  return (
    <li>
      <label className={cn('flex items-start gap-2 px-3 py-2 text-[12px]', locked ? 'opacity-60' : 'cursor-pointer')}>
        <input type="checkbox" checked={checked} disabled={locked} onChange={onToggle} className="mt-0.5 h-4 w-4 accent-gold-600" />
        <span className="min-w-0">
          <span className="font-semibold text-gray-900 dark:text-white">{item.title}</span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400">
            {stageName(item.from_stage)} → {stageName(item.to_stage)} · {evidence} em {formatDayTime(item.evidence.at)}
          </span>
          {item.fires_marketing_event && <span className="block text-[11px] font-semibold text-amber-700 dark:text-amber-300">{MARKETING_EVENT_NOTE}</span>}
        </span>
      </label>
    </li>
  );
}

interface Props {
  open: boolean;
  stages: PipelineStage[];
  onClose: () => void;
  onToast: (t: ToastState) => void;
  onApplied: () => void;
}

export function ReconcileModal({ open, stages, onClose, onToast, onApplied }: Props) {
  const s = usePreview(open);
  const [includeMarketing, setIncludeMarketing] = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => { if (open) setIncludeMarketing(false); }, [open]);
  if (!open) return null;

  const stageName = (id: string) => stages.find((st) => st.id === id)?.name ?? id;
  const setMarketing = (on: boolean) => {
    setIncludeMarketing(on);
    if (on || !s.preview) return;
    const marketing = new Set([...s.preview.to_proposal, ...s.preview.to_contact].filter((i) => i.fires_marketing_event).map((i) => i.deal_id));
    s.setDeals((prev) => new Set([...prev].filter((id) => !marketing.has(id))));
  };

  const apply = async () => {
    setApplying(true);
    try {
      const res = await api.reconcileApply({ deal_ids: [...s.deals], create_phones: [...s.phones], include_marketing: includeMarketing });
      onToast({ kind: 'success', message: resultText(res) });
      onApplied();
      onClose();
    } catch (err) {
      onToast({ kind: 'error', message: errorMessage(err) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">Revisar funil (prévia)</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Nada muda até você aplicar. Os cards só andam para frente.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <PreviewBody s={s} stageName={stageName} includeMarketing={includeMarketing} onMarketing={setMarketing} />
        </div>
        <ApplyFooter deals={s.deals.size} phones={s.phones.size} ready={!!s.preview} applying={applying} onApply={() => void apply()} onClose={onClose} />
      </div>
    </div>
  );
}

type PreviewState = ReturnType<typeof usePreview>;

function PreviewBody({ s, stageName, includeMarketing, onMarketing }: {
  s: PreviewState; stageName: (id: string) => string; includeMarketing: boolean; onMarketing: (on: boolean) => void;
}) {
  if (s.error) {
    return (
      <div className="text-[12px] text-red-600 dark:text-red-400">
        <p>{s.error}</p>
        <button type="button" onClick={() => void s.load()} className="mt-1 font-bold underline">Tentar de novo</button>
      </div>
    );
  }
  if (!s.preview) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  const p = s.preview;
  const hasMarketing = [...p.to_proposal, ...p.to_contact].some((i) => i.fires_marketing_event);
  const moveRow = (item: ReconcileItem) => (
    <MoveRow key={`${item.deal_id}-${item.to_stage}`} item={item} checked={s.deals.has(item.deal_id)}
      locked={item.fires_marketing_event && !includeMarketing} stageName={stageName}
      onToggle={() => s.setDeals((prev) => toggled(prev, item.deal_id))} />
  );
  return (
    <>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.scanned} conversas lidas.</p>
      <ListBox title="Leads novos a criar" count={p.to_create.length}>
        {p.to_create.map((c) => (
          <CreateRow key={c.phone} item={c} checked={s.phones.has(c.phone)} onToggle={() => s.setPhones((prev) => toggled(prev, c.phone))} />
        ))}
      </ListBox>
      <ListBox title="Vão para Orçamento Enviado" count={p.to_proposal.length}>{p.to_proposal.map(moveRow)}</ListBox>
      <ListBox title="Vão para Conversa Iniciada" count={p.to_contact.length}>{p.to_contact.map(moveRow)}</ListBox>
      {hasMarketing && (
        <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12px]', TONE_CLASSES.amber)}>
          <input type="checkbox" checked={includeMarketing} onChange={(e) => onMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-gold-600" />
          <span>Incluir mesmo assim<span className="block text-[11px] opacity-80">{MARKETING_EVENT_NOTE}</span></span>
        </label>
      )}
    </>
  );
}

function limitText(deals: number, phones: number): string | null {
  if (deals > MAX_DEALS) return `Selecione no máximo ${MAX_DEALS} cards por vez.`;
  if (phones > MAX_PHONES) return `Selecione no máximo ${MAX_PHONES} leads novos por vez.`;
  return null;
}

function ApplyFooter({ deals, phones, ready, applying, onApply, onClose }: {
  deals: number; phones: number; ready: boolean; applying: boolean; onApply: () => void; onClose: () => void;
}) {
  const limit = limitText(deals, phones);
  const empty = deals + phones === 0;
  return (
    <footer className="space-y-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
      {limit && <p className="text-[12px] font-semibold text-red-600 dark:text-red-400">{limit}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-[12px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">Cancelar</button>
        <button type="button" onClick={onApply} disabled={!ready || applying || empty || !!limit}
          className="flex items-center gap-1.5 rounded-lg bg-gold-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:opacity-50">
          {applying && <Loader2 size={13} className="animate-spin" />} Aplicar selecionados ({deals + phones})
        </button>
      </div>
    </footer>
  );
}
