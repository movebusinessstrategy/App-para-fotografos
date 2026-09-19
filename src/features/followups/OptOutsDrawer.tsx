import { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2, Search, Trash2, X } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import type { ToastState } from '../galeria/Toast';
import { api, errorMessage } from './api';
import { formatFullDate } from './format';
import { OPTOUT_KIND_LABELS } from './labels';
import type { FollowUpOptOut } from './types';

const PAGE = 30;

function useOptOutList(open: boolean, search: string) {
  const [items, setItems] = useState<FollowUpOptOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listOptOuts({ search, offset, limit: PAGE });
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { if (open) void load(0); }, [open, load]);
  return { items, total, loading, error, reload: () => load(0), more: () => load(items.length) };
}

function AddForm({ onAdded, onToast }: { onAdded: () => void; onToast: (t: ToastState) => void }) {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.addOptOut({ phone: phone.trim(), reason: reason.trim() || undefined });
      setPhone('');
      setReason('');
      onToast({ kind: 'success', message: 'Número marcado como não contatar.' });
      onAdded();
    } catch (err) {
      onToast({ kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const input = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-gold-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white';
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-[12px] font-bold text-gray-800 dark:text-gray-100">Adicionar número</p>
      <div className="flex flex-wrap gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone com DDD" className={`${input} min-w-[150px] flex-1`} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={`${input} min-w-[150px] flex-1`} />
        <button type="button" onClick={() => void submit()} disabled={busy || phone.replace(/\D/g, '').length < 8}
          className="flex items-center gap-1.5 rounded-lg bg-gold-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gold-700 disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Adicionar
        </button>
      </div>
    </div>
  );
}

function OptOutRow({ item, canRemove, onRemove }: { item: FollowUpOptOut; canRemove: boolean; onRemove: (item: FollowUpOptOut) => void }) {
  const detail = item.detected_text || item.reason;
  const by = item.created_by_label ? ` por ${item.created_by_label}` : '';
  return (
    <li className="flex items-start justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{item.contact_name || item.phone || item.phone_key}</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {item.phone || item.phone_key} · {OPTOUT_KIND_LABELS[item.kind] ?? item.kind} · {formatFullDate(item.created_at)}{by}
        </p>
        {detail && <p className="mt-0.5 line-clamp-2 text-[11px] italic text-gray-500 dark:text-gray-400">{detail}</p>}
      </div>
      {canRemove && (
        <button type="button" onClick={() => onRemove(item)} className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
          <Trash2 size={12} /> Remover
        </button>
      )}
    </li>
  );
}

interface Props {
  open: boolean;
  canRemove: boolean;
  onClose: () => void;
  onToast: (t: ToastState) => void;
  onChanged: () => void;
}

export function OptOutsDrawer({ open, canRemove, onClose, onToast, onChanged }: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<FollowUpOptOut | null>(null);
  const list = useOptOutList(open, query);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  if (!open) return null;

  const afterChange = () => { void list.reload(); onChanged(); };
  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    try {
      await api.removeOptOut(target.id);
      onToast({ kind: 'success', message: 'Contato liberado para receber follow-ups.' });
      afterChange();
    } catch (err) {
      onToast({ kind: 'error', message: errorMessage(err) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-gray-900">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">Não contatar</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Estes contatos nunca recebem follow-up automático.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <AddForm onAdded={afterChange} onToast={onToast} />
          <label className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
            <Search size={13} className="text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone"
              className="w-full bg-transparent text-[12px] outline-none dark:text-white" />
          </label>
          <OptOutListBody list={list} canRemove={canRemove} onRemove={setRemoving} />
        </div>
      </aside>
      <ConfirmModal open={!!removing} title="Remover da lista" variant="warning" confirmText="Remover"
        message="Remover libera este contato para receber follow-ups de novo."
        onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}

type ListState = ReturnType<typeof useOptOutList>;

function OptOutListBody({ list, canRemove, onRemove }: { list: ListState; canRemove: boolean; onRemove: (i: FollowUpOptOut) => void }) {
  if (list.error && list.items.length === 0) return <p className="text-[12px] text-red-600 dark:text-red-400">{list.error}</p>;
  if (list.loading && list.items.length === 0) return <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-400" /></div>;
  if (list.items.length === 0) return <p className="py-6 text-center text-[12px] text-gray-500 dark:text-gray-400">Nenhum contato na lista.</p>;
  return (
    <div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{list.total} {list.total === 1 ? 'contato' : 'contatos'}</p>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {list.items.map((item) => <OptOutRow key={item.id} item={item} canRemove={canRemove} onRemove={onRemove} />)}
      </ul>
      {list.items.length < list.total && (
        <button type="button" onClick={() => void list.more()} disabled={list.loading}
          className="mt-2 w-full rounded-xl border border-gray-200 py-2 text-[12px] font-semibold text-gray-600 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">
          Carregar mais
        </button>
      )}
    </div>
  );
}
