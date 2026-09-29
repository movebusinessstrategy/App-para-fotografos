import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canonicalPhoneKey } from '../../../lib/br-phone';
import { dealExclusionReason, FUNNEL_EXCLUSION_PREFIX } from '../../../lib/deal-exclusions';
import { authFetch } from '../../utils/authFetch';
import type { Deal, PipelineStage } from '../../types';
import { ContactAvatar } from './ContactAvatar';

export interface FollowUpExclusion { id: number; phone_key: string; reason: string | null; kind: string; deal_id: number | null }

function ReturnToFunnel({ deal, onUpdate }: { deal: Deal; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function restore() {
    setBusy(true); setError(false);
    try {
      const response = await authFetch(`/api/deals/${deal.id}/labels`, { method: 'PATCH', body: JSON.stringify({
        labels: (deal.labels ?? []).filter(label => !label.startsWith(FUNNEL_EXCLUSION_PREFIX)),
      }) });
      if (!response.ok) throw new Error('restore_failed');
      onUpdate();
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="shrink-0 text-right">
    <button type="button" disabled={busy} onClick={() => void restore()} className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs disabled:opacity-50 dark:border-gray-600">{busy ? 'Retornando…' : 'Voltar ao funil'}</button>
    {error && <p role="status" className="mt-1 text-xs text-red-600">Não foi possível. Tente de novo.</p>}
  </div>;
}

export function ExcludedContacts({ deals, stages, exclusions, onUpdate }: { deals: Deal[]; stages: PipelineStage[]; exclusions: FollowUpExclusion[]; onUpdate: () => void }) {
  const [search, setSearch] = useState('');
  const [, setParams] = useSearchParams();
  const byPhone = useMemo(() => new Map(exclusions.map(item => [item.phone_key, item])), [exclusions]);
  const rows = deals.filter(d => dealExclusionReason(d) || byPhone.has(canonicalPhoneKey(d.contact_phone)))
    .filter(d => `${d.contact_name} ${d.title}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <section className="h-full overflow-auto p-4 sm:p-6">
    <h2 className="text-base font-semibold">Fora do funil</h2>
    <p className="mt-1 max-w-2xl text-sm text-gray-500">Oportunidades separadas da prospecção e dos envios automáticos. O histórico e a etapa original continuam preservados. Voltar ao funil permite retomar a cadência conforme suas regras.</p>
    <input aria-label="Buscar contatos fora do funil" placeholder="Buscar contato" value={search} onChange={e => setSearch(e.target.value)}
      className="my-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
    <p className="mb-2 text-xs text-gray-500">{rows.length} oportunidades</p>
    <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
      {rows.map(d => <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" disabled={!d.contact_phone} onClick={() => setParams({ tab: 'inbox', phone: d.contact_phone || '' })}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
        <ContactAvatar phone={d.contact_phone} name={d.contact_name || d.title} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{d.contact_name || d.title}</span>
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{dealExclusionReason(d) || byPhone.get(canonicalPhoneKey(d.contact_phone))?.reason || 'Não contatar'}</span>
          <span className="mt-1 block text-[11px] text-gray-400">{stages.find(s => s.id === d.stage)?.name}</span>
        </span>
        </button>
        {byPhone.has(canonicalPhoneKey(d.contact_phone))
          ? <span className="text-xs text-gray-500">Bloqueio em Follow-ups → Fila → Não contatar</span>
          : <ReturnToFunnel deal={d} onUpdate={onUpdate} />}
      </div>)}
      {!rows.length && <p className="p-6 text-sm text-gray-500">Nenhum contato encontrado.</p>}
    </div>
  </section>;
}
