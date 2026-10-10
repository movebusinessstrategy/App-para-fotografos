import { Client, Deal, Job, ProductionStageV2 } from '../../../types';

export function customerPhoneKey(value: string | null | undefined): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') digits = digits.slice(0, 2) + digits.slice(3);
  return digits.length === 10 ? digits : '';
}

export function customerPhoneMatches(a: string | null | undefined, b: string | null | undefined) {
  const key = customerPhoneKey(a);
  return !!key && key === customerPhoneKey(b);
}

export function conversationCustomer(phone: string, clients: Client[], deals: Deal[], allJobs: Job[]) {
  const linkedDeals = deals.filter(deal => customerPhoneMatches(phone, deal.contact_phone));
  const dealIds = new Set(linkedDeals.map(deal => String(deal.id)));
  const jobIds = new Set(linkedDeals.map(deal => Number(deal.converted_job_id)).filter(Boolean));
  const linkedJobs = allJobs.filter(job => dealIds.has(String(job.deal_id)) || jobIds.has(Number(job.id)));
  const clientIds = new Set(linkedDeals.flatMap(deal => [Number(deal.client_id), Number(deal.converted_client_id)]).filter(Boolean));
  linkedJobs.forEach(job => { if (job.client_id) clientIds.add(Number(job.client_id)); });
  clients.forEach(client => { if (customerPhoneMatches(phone, client.phone)) clientIds.add(Number(client.id)); });
  const matchedClients = clients.filter(client => clientIds.has(Number(client.id)));
  const jobs = allJobs.filter(job => clientIds.has(Number(job.client_id)) || linkedJobs.includes(job));
  return { clients: matchedClients, jobs, deals: linkedDeals };
}

export function sessionWasCompleted(job: Job, stages: ProductionStageV2[]) {
  if (job.status === 'cancelled' || job.status === 'pre_reserved') return false;
  if (job.status === 'completed') return true;
  const stage = stages.find(item => item.id === job.production_stage);
  if (!stage) return false;
  const milestone = stages.find(item => item.process_id === stage.process_id && /ensaio.*realizado/i.test(item.name));
  return !!milestone && stage.position >= milestone.position;
}

export function saoPauloToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function preferredSession(jobs: Job[], today = saoPauloToday()) {
  const upcoming = jobs.filter(job => job.status !== 'cancelled' && job.status !== 'completed' && job.job_date >= today)
    .sort((a, b) => `${a.job_date}${a.job_time || ''}`.localeCompare(`${b.job_date}${b.job_time || ''}`));
  return upcoming[0] || jobs.find(job => job.status !== 'cancelled');
}

export function sessionDate(job: Pick<Job, 'job_date' | 'job_time' | 'job_end_time'>) {
  if (!job.job_date) return 'Ainda sem data';
  const date = new Date(`${job.job_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
  const time = job.job_time ? ` · ${job.job_time.slice(0, 5)}` : ' · horário a definir';
  return `${date}${time}${job.job_end_time ? `–${job.job_end_time.slice(0, 5)}` : ''}`;
}

export function parsePaymentAmount(raw: string) {
  const cleaned = raw.trim().replace(/\s|R\$/g, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function clockMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function scheduleConflicts(jobs: Job[], jobId: number, date: string, start: string, end: string) {
  if (!start || !end) return [];
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  return jobs.filter(job => {
    if (Number(job.id) === Number(jobId) || job.status === 'cancelled' || job.job_date !== date) return false;
    if (!job.job_time) return true;
    const otherStart = clockMinutes(job.job_time);
    const otherEnd = job.job_end_time ? clockMinutes(job.job_end_time) : otherStart + 60;
    return from < otherEnd && to > otherStart;
  });
}
