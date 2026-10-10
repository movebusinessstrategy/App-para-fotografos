import React, { useMemo, useState } from 'react';
import { Client, Deal, Job, ProductionStageV2 } from '../../../types';
import { useApi, refreshAll } from '../../../utils/useApi';
import { useAuth } from '../../../contexts/AuthContext';
import { conversationCustomer, preferredSession, sessionDate, sessionWasCompleted } from '../utils/conversationCustomer';
import { ConversationPayment } from './ConversationPayment';
import { ConversationSchedule } from './ConversationSchedule';
import { customerInputClass, customerInputStyle, customerSecondaryStyle } from './customerPanelStyles';

export function ConversationCustomerPanel({ phone, clients, deals, onUpdate }: {
  phone: string; clients: Client[]; deals: Deal[]; onUpdate: () => void;
}) {
  const { canAccess } = useAuth();
  const jobsApi = useApi<Job[]>('/api/jobs');
  const stagesApi = useApi<ProductionStageV2[]>('/api/production/stages-v2');
  const allJobs = Array.isArray(jobsApi.data) ? jobsApi.data : [];
  const stages = Array.isArray(stagesApi.data) ? stagesApi.data : [];
  const context = useMemo(() => conversationCustomer(phone, clients, deals, allJobs), [phone, clients, deals, jobsApi.data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = context.jobs.find(job => Number(job.id) === selectedId) || preferredSession(context.jobs);
  const completed = context.jobs.filter(job => sessionWasCompleted(job, stages)).length;
  const active = context.jobs.filter(job => job.status !== 'cancelled');
  const isCustomer = context.clients.length > 0 || active.length > 0;

  const updated = async () => {
    onUpdate();
    await refreshAll(['/api/jobs', '/api/clients', '/api/deals']);
  };

  if (jobsApi.isLoading) return <p className="px-5 py-5 text-sm" style={customerSecondaryStyle} role="status">Carregando ensaios e agenda…</p>;
  if (jobsApi.error) return (
    <div className="px-5 py-5 text-sm" role="alert" style={customerSecondaryStyle}>
      <p>Não foi possível carregar o histórico da cliente.</p>
      <button type="button" onClick={() => jobsApi.mutate()} className="mt-2 font-semibold underline">Tentar novamente</button>
    </div>
  );

  return (
    <section aria-label="Histórico e ensaios da cliente" className="px-5 py-5" style={{ borderBottom: '1px solid var(--wa-border)', color: 'var(--wa-text-primary)' }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{isCustomer ? 'Cliente do estúdio' : 'Contato em atendimento'}</h3>
          <p className="mt-1 text-xs" style={customerSecondaryStyle}>{isCustomer ? `${completed} ensaio${completed === 1 ? '' : 's'} realizado${completed === 1 ? '' : 's'} · ${active.length} contratado${active.length === 1 ? '' : 's'}` : 'Nenhum ensaio vinculado a este contato.'}</p>
        </div>
      </div>
      {stagesApi.error && <p role="alert" className="mb-3 text-xs text-amber-700 dark:text-amber-300">As etapas de produção não carregaram. <button type="button" onClick={() => stagesApi.mutate()} className="underline">Tentar novamente</button></p>}
      {context.jobs.length > 0 && (
        <label className="mb-4 block text-xs font-medium" style={customerSecondaryStyle}>
          Ensaio vinculado
          <select aria-label="Ensaio vinculado" value={selected?.id || ''} onChange={event => setSelectedId(Number(event.target.value))} className={`${customerInputClass} mt-1.5`} style={customerInputStyle}>
            {context.jobs.map(job => <option key={job.id} value={job.id}>{job.job_name || job.job_type} · {job.job_date || 'sem data'}{job.status === 'cancelled' ? ' · cancelado' : ''}</option>)}
          </select>
        </label>
      )}
      {selected && (
        <div key={selected.id} className="space-y-5">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs" style={customerSecondaryStyle}>Produção</dt><dd className="mt-1 font-medium">{selected.production_stage ? stages.find(stage => stage.id === selected.production_stage)?.name || 'Etapa vinculada indisponível' : 'Ainda não enviado para produção'}</dd></div>
            <div><dt className="text-xs" style={customerSecondaryStyle}>Agendamento</dt><dd className="mt-1 font-medium">{sessionDate(selected)}</dd>{selected.status === 'pre_reserved' && <dd className="mt-1 text-xs" style={customerSecondaryStyle}>Pré-reserva</dd>}{selected.status === 'completed' && <dd className="mt-1 text-xs" style={customerSecondaryStyle}>Ensaio realizado</dd>}</div>
          </dl>
          {selected.status === 'cancelled' ? <p className="text-xs" style={customerSecondaryStyle}>Ensaio cancelado. Os registros continuam no histórico.</p> : (
            <>
              {canAccess('finance') && <ConversationPayment job={selected} onUpdate={updated} />}
              {canAccess('calendar') && canAccess('calendar_create') && <ConversationSchedule job={selected} allJobs={allJobs} onUpdate={updated} />}
            </>
          )}
        </div>
      )}
      {context.jobs.length > 0 && (
        <details className="mt-5 text-xs" style={customerSecondaryStyle}>
          <summary className="cursor-pointer py-2 font-semibold">Ver todos os ensaios ({context.jobs.length})</summary>
          <ul className="divide-y" style={{ borderColor: 'var(--wa-border)' }}>
            {context.jobs.map(job => <li key={job.id} className="py-3"><button type="button" onClick={() => setSelectedId(Number(job.id))} className="w-full text-left"><span className="block font-medium" style={{ color: 'var(--wa-text-primary)' }}>{job.job_name || job.job_type}</span><span className="mt-1 block">{sessionDate(job)}{job.status === 'cancelled' ? ' · cancelado' : ''}</span></button></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
