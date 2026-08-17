export type CalendarSyncStatus = 'synced' | 'already_synced' | 'not_connected' | 'skipped' | 'failed';

type CalendarClientSnapshot = {
  email?: string | null;
};

export type CalendarJobSnapshot = {
  google_event_id?: string | null;
  clients?: CalendarClientSnapshot | CalendarClientSnapshot[] | null;
};

export type ConversionCalendarResult = {
  calendar_sync_status: CalendarSyncStatus;
  calendar_synced: boolean;
  google_event_id: string | null;
  invite_email: string | null;
  invite_requested: boolean;
  invite_sent: boolean;
  google_calendar_connected: boolean | null;
};

export type ExistingClientInviteEmailUpdate = {
  clientId: number;
  email: string | null;
};

export class InviteEmailValidationError extends Error {
  constructor() {
    super('Informe um e-mail válido para enviar o convite do Google Agenda.');
    this.name = 'InviteEmailValidationError';
  }
}

export class JobScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobScheduleValidationError';
  }
}

export type NormalizedJobSchedule = {
  job_type: string;
  job_date: string;
  job_time: string;
  job_end_time: string | null;
};

type ConversionCalendarDependencies = {
  syncJob: (jobId: number) => Promise<CalendarSyncStatus>;
  loadJob: (jobId: number) => Promise<CalendarJobSnapshot | null>;
  reportError?: (message: string, error: unknown) => void;
};

type CalendarSyncExecution = {
  status: CalendarSyncStatus;
  googleCalendarConnected: boolean | null;
};

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeInviteEmail = (rawInviteEmail: unknown): string | null => {
  const email = String(rawInviteEmail ?? '').trim();
  if (email && !BASIC_EMAIL_PATTERN.test(email)) throw new InviteEmailValidationError();
  return email || null;
};

export const inviteEmailUpdateForExistingClient = (
  createClient: boolean,
  clientId: number | null,
  rawInviteEmail: unknown,
): ExistingClientInviteEmailUpdate | null => {
  if (createClient || !clientId || rawInviteEmail === undefined) return null;

  return { clientId, email: normalizeInviteEmail(rawInviteEmail) };
};

export const requiresConversionToEnterWonStage = (
  isWonStage: boolean,
  converted: boolean,
  convertedJobId: unknown,
): boolean => isWonStage && !converted && !convertedJobId;

const validCalendarDate = (value: string): boolean => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const validClockTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const normalizeRequiredJobSchedule = (rawJob: unknown): NormalizedJobSchedule => {
  const job = rawJob && typeof rawJob === 'object' ? rawJob as Record<string, unknown> : {};
  const jobType = String(job.job_type || '').trim();
  const jobDate = String(job.job_date || '').slice(0, 10);
  const jobTime = String(job.job_time || '').slice(0, 5);
  const jobEndTime = String(job.job_end_time || '').slice(0, 5) || null;

  if (!jobType) throw new JobScheduleValidationError('Tipo de ensaio é obrigatório.');
  if (!validCalendarDate(jobDate)) throw new JobScheduleValidationError('Data do ensaio inválida — selecione a data no calendário.');
  if (!validClockTime(jobTime)) throw new JobScheduleValidationError('Horário de início inválido — selecione o horário do ensaio.');
  if (jobEndTime && !validClockTime(jobEndTime)) throw new JobScheduleValidationError('Horário de término inválido.');
  if (jobEndTime && jobEndTime <= jobTime) throw new JobScheduleValidationError('O término do ensaio deve ser depois do horário de início.');

  return { job_type: jobType, job_date: jobDate, job_time: jobTime, job_end_time: jobEndTime };
};

const noJobCalendarResult = (): ConversionCalendarResult => ({
  calendar_sync_status: 'skipped',
  calendar_synced: false,
  google_event_id: null,
  invite_email: null,
  invite_requested: false,
  invite_sent: false,
  google_calendar_connected: null,
});

const inviteEmailFromJob = (job: CalendarJobSnapshot | null): string | null => {
  const client = Array.isArray(job?.clients) ? job?.clients[0] : job?.clients;
  const email = typeof client?.email === 'string' ? client.email.trim() : '';
  return email || null;
};

const runCalendarSync = async (
  jobId: number,
  dependencies: ConversionCalendarDependencies,
): Promise<CalendarSyncExecution> => {
  try {
    const status = await dependencies.syncJob(jobId);
    return {
      status,
      googleCalendarConnected: status === 'not_connected' ? false : true,
    };
  } catch (error) {
    dependencies.reportError?.('Falha inesperada ao sincronizar o ensaio com o Google Agenda.', error);
    return { status: 'failed', googleCalendarConnected: null };
  }
};

const reloadCalendarJob = async (
  jobId: number,
  dependencies: ConversionCalendarDependencies,
): Promise<CalendarJobSnapshot | null> => {
  try {
    return await dependencies.loadJob(jobId);
  } catch (error) {
    dependencies.reportError?.('Falha ao reler o ensaio depois da sincronização com o Google Agenda.', error);
    return null;
  }
};

export const syncConversionCalendarJob = async (
  jobId: number | null,
  dependencies: ConversionCalendarDependencies,
): Promise<ConversionCalendarResult> => {
  if (!jobId) return noJobCalendarResult();

  const execution = await runCalendarSync(jobId, dependencies);
  const syncedJob = await reloadCalendarJob(jobId, dependencies);
  const inviteEmail = inviteEmailFromJob(syncedJob);
  const googleEventId = syncedJob?.google_event_id || null;
  const calendarSynced = ['synced', 'already_synced'].includes(execution.status) && Boolean(googleEventId);
  const inviteRequested = execution.status === 'synced' && calendarSynced && Boolean(inviteEmail);

  return {
    calendar_sync_status: execution.status,
    calendar_synced: calendarSynced,
    google_event_id: googleEventId,
    invite_email: inviteEmail,
    invite_requested: inviteRequested,
    // Compatibilidade temporária com clientes antigos. Este campo significa que
    // o Google aceitou sendUpdates='all'; não confirma entrega na caixa postal.
    invite_sent: inviteRequested,
    google_calendar_connected: execution.googleCalendarConnected,
  };
};
