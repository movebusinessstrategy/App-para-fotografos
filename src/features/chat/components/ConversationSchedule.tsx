import React, { useMemo, useRef, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Job } from '../../../types';
import { authFetch } from '../../../utils/authFetch';
import { saoPauloToday, scheduleConflicts, sessionDate } from '../utils/conversationCustomer';
import { customerButtonClass, customerButtonStyle, customerInputClass, customerInputStyle, customerResponse, customerSecondaryStyle } from './customerPanelStyles';

function defaultEnd(start: string) {
  if (!start) return '';
  const [hours, minutes] = start.split(':').map(Number);
  return hours >= 23 ? '23:59' : `${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function CalendarMonth({ date, jobs, onChange }: { date: string; jobs: Job[]; onChange: (value: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date(`${date}T12:00:00`)));
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const occupied = useMemo(() => new Set(jobs.filter(job => job.status !== 'cancelled').map(job => job.job_date)), [jobs]);
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--wa-border)' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => setMonth(value => addMonths(value, -1))} className="rounded-lg p-2"><ChevronLeft size={16} /></button>
        <span className="text-sm font-medium capitalize">{format(month, 'MMMM yyyy', { locale: ptBR })}</span>
        <button type="button" aria-label="Próximo mês" onClick={() => setMonth(value => addMonths(value, 1))} className="rounded-lg p-2"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={index} aria-hidden="true" className="py-1" style={customerSecondaryStyle}>{day}</span>)}
        {Array.from({ length: month.getDay() }, (_, index) => <span key={`blank-${index}`} />)}
        {days.map(day => {
          const iso = format(day, 'yyyy-MM-dd');
          const selected = date === iso;
          return <button type="button" key={iso} aria-label={format(day, "d 'de' MMMM 'de' yyyy", { locale: ptBR })} aria-pressed={selected} onClick={() => onChange(iso)} className="relative flex h-9 flex-col items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-gold-500" style={selected ? customerButtonStyle : undefined}>{day.getDate()}{occupied.has(iso) && <span aria-label="Há compromissos neste dia" className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: selected ? '#fff' : 'var(--wa-accent-green)' }} />}</button>;
        })}
      </div>
      <p className="mt-2 text-[11px]" style={customerSecondaryStyle}>Ponto abaixo do dia: há compromissos na agenda.</p>
    </div>
  );
}

export function ConversationSchedule({ job, allJobs, onUpdate }: { job: Job; allJobs: Job[]; onUpdate: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(job.job_date?.slice(0, 10) || saoPauloToday());
  const [start, setStart] = useState(job.job_time?.slice(0, 5) || '');
  const [end, setEnd] = useState(job.job_end_time?.slice(0, 5) || defaultEnd(job.job_time?.slice(0, 5) || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const writing = useRef(false);
  const dayJobs = allJobs.filter(item => item.job_date === date && item.status !== 'cancelled' && Number(item.id) !== Number(job.id));
  const conflicts = scheduleConflicts(allJobs, job.id, date, start, end);
  const valid = !!date && !!start && end > start;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (writing.current || !valid || conflicts.length) return;
    writing.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const fresh = await customerResponse<Job[]>(await authFetch('/api/jobs'));
      if (scheduleConflicts(fresh, job.id, date, start, end).length) throw new Error('Esse horário acabou de receber outro compromisso. Escolha um horário diferente.');
      const result = await customerResponse<{ calendar_sync_status?: string }>(await authFetch(`/api/jobs/${job.id}`, {
        method: 'PUT', body: JSON.stringify({ job_date: date, job_time: start, job_end_time: end }),
      }));
      setOpen(false);
      const syncNotice: Record<string, string> = {
        synced: 'Agendamento salvo e sincronizado com o Google Agenda.',
        already_synced: 'Agendamento salvo e sincronizado com o Google Agenda.',
        not_connected: 'Agendamento salvo no CRM. Conecte o Google Agenda para sincronizar.',
        failed: 'Agendamento salvo no CRM. A sincronização com o Google Agenda está pendente.',
        skipped: 'Agendamento salvo no CRM.',
      };
      setNotice(syncNotice[result.calendar_sync_status || 'skipped'] || 'Agendamento salvo no CRM. Confira a sincronização com o Google Agenda.');
      try { await onUpdate(); } catch { setNotice('Agendamento salvo. Atualize o painel para conferir a nova data.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a agenda.'); }
    finally { writing.current = false; setBusy(false); }
  };

  return (
    <section className="border-t pt-4" style={{ borderColor: 'var(--wa-border)' }} aria-label="Editar agenda pelo atendimento">
      {notice && <p role="status" className="mb-3 text-xs" style={customerSecondaryStyle}>{notice}</p>}
      {error && <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-300">{error}</p>}
      {!open ? <button type="button" disabled={busy} onClick={() => setOpen(true)} className={`${customerButtonClass} border`} style={{ ...customerSecondaryStyle, borderColor: 'var(--wa-border)' }}>Alterar agendamento</button> : (
        <form onSubmit={save} className="space-y-3">
          <h4 className="text-sm font-semibold">Alterar agendamento</h4>
          <CalendarMonth date={date} jobs={allJobs} onChange={setDate} />
          <label className="block text-xs">Data selecionada<input required type="date" value={date} onChange={event => setDate(event.target.value)} className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">Início<input required type="time" value={start} onChange={event => { setStart(event.target.value); setEnd(defaultEnd(event.target.value)); }} className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
            <label className="block text-xs">Fim<input required type="time" value={end} onChange={event => setEnd(event.target.value)} className={`${customerInputClass} mt-1`} style={customerInputStyle} /></label>
          </div>
          <div className="text-xs" style={customerSecondaryStyle}><p className="mb-2 font-medium">Compromissos nesse dia</p>{dayJobs.length === 0 ? <p>Nenhum outro compromisso cadastrado no CRM.</p> : <ul className="space-y-2">{dayJobs.sort((a, b) => (a.job_time || '').localeCompare(b.job_time || '')).map(item => <li key={item.id}><span className="font-medium">{item.job_time?.slice(0, 5) || 'Sem horário'}{item.job_end_time ? `–${item.job_end_time.slice(0, 5)}` : ''}</span> · {item.client_name || item.job_name || item.job_type}</li>)}</ul>}</div>
          {conflicts.length > 0 && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Esse intervalo coincide com outro compromisso. Escolha outro horário.</p>}
          {start && end && end <= start && <p role="alert" className="text-xs text-red-600 dark:text-red-300">O horário de fim deve ser depois do início.</p>}
          <p className="text-xs" style={customerSecondaryStyle}>Novo agendamento: {sessionDate({ job_date: date, job_time: start, job_end_time: end })}</p>
          <div className="flex gap-2"><button disabled={busy || !valid || conflicts.length > 0} className={customerButtonClass} style={customerButtonStyle}>{busy ? 'Salvando…' : 'Salvar agendamento'}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className={customerButtonClass} style={customerSecondaryStyle}>Cancelar</button></div>
        </form>
      )}
    </section>
  );
}
