export type CalendarEventDateTime = {
  dateTime?: string | null;
  timeZone?: string | null;
};

export type CalendarEventAttendee = {
  email?: string | null;
};

export type CalendarEventPayload = {
  status: 'confirmed';
  summary: string;
  description: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees: CalendarEventAttendee[];
};

export type CalendarRemoteEvent = Partial<Omit<CalendarEventPayload, 'status'>> & {
  status?: string | null;
};

export type CalendarJobEventInput = {
  job_date?: string | null;
  job_time?: string | null;
  job_end_time?: string | null;
  job_name?: string | null;
  job_type?: string | null;
  notes?: string | null;
};

export type CalendarClientEventInput = {
  name?: string | null;
  email?: string | null;
};

type CalendarEventGateway = {
  get: (eventId: string) => Promise<CalendarRemoteEvent>;
  insert: (eventId: string, event: CalendarEventPayload) => Promise<string | null>;
  patch: (eventId: string, event: CalendarEventPayload) => Promise<void>;
  isConflict: (error: unknown) => boolean;
  isMissing: (error: unknown) => boolean;
};

export type CalendarEventWriteResult = {
  eventId: string;
  status: 'synced' | 'already_synced';
};

type KnownEventResult = CalendarEventWriteResult | { status: 'cancelled' | 'missing' };

const EVENT_TIME_ZONE = 'America/Sao_Paulo';
const MAX_EVENT_ID_REVISIONS = 8;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const normalizeCalendarClockTime = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim().slice(0, 5);
  return CLOCK_PATTERN.test(normalized) ? normalized : null;
};

export const hasValidCalendarStart = (jobDate: unknown, jobTime: unknown): boolean => (
  validCalendarDate(String(jobDate ?? '').slice(0, 10))
  && normalizeCalendarClockTime(jobTime) !== null
);

const validCalendarDate = (value: string): boolean => {
  const parts = DATE_PATTERN.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const defaultEndTime = (startTime: string): string => {
  const [hours, minutes] = startTime.split(':').map(Number);
  if (hours >= 23) return '23:59';
  return `${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const buildCalendarEventPayload = (
  job: CalendarJobEventInput,
  client: CalendarClientEventInput | null | undefined,
): CalendarEventPayload | null => {
  const jobDate = String(job.job_date ?? '').slice(0, 10);
  const startTime = normalizeCalendarClockTime(job.job_time);
  if (!hasValidCalendarStart(jobDate, startTime)) return null;

  const explicitEnd = normalizeCalendarClockTime(job.job_end_time);
  const endTime = explicitEnd || defaultEndTime(startTime!);
  if (endTime <= startTime!) return null;

  const jobType = String(job.job_type || '').trim();
  const clientName = String(client?.name || '').trim();
  const summary = clientName
    ? `${clientName} - ${jobType}`
    : String(job.job_name || jobType).trim();
  const description = String(
    job.notes || (clientName ? `Ensaio ${jobType} para ${clientName}` : jobType),
  );
  const inviteEmail = String(client?.email || '').trim();

  return {
    status: 'confirmed',
    summary,
    description,
    start: { dateTime: `${jobDate}T${startTime}:00`, timeZone: EVENT_TIME_ZONE },
    end: { dateTime: `${jobDate}T${endTime}:00`, timeZone: EVENT_TIME_ZONE },
    attendees: inviteEmail ? [{ email: inviteEmail }] : [],
  };
};

const eventEmails = (attendees: CalendarEventAttendee[] | undefined): string[] => (
  [...new Set((attendees || [])
    .map((attendee) => String(attendee.email || '').trim().toLowerCase())
    .filter(Boolean))]
    .sort()
);

const wallClockInSaoPaulo = (raw: string | null | undefined): string | null => {
  const value = String(raw || '');
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value);
  if (local) return `${local[1]}T${local[2]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

export const calendarEventNeedsUpdate = (
  remote: CalendarRemoteEvent,
  desired: CalendarEventPayload,
): boolean => {
  if (remote.status !== desired.status) return true;
  if (String(remote.summary || '') !== desired.summary) return true;
  if (String(remote.description || '') !== desired.description) return true;
  if (wallClockInSaoPaulo(remote.start?.dateTime) !== wallClockInSaoPaulo(desired.start.dateTime)) return true;
  if (wallClockInSaoPaulo(remote.end?.dateTime) !== wallClockInSaoPaulo(desired.end.dateTime)) return true;
  return JSON.stringify(eventEmails(remote.attendees)) !== JSON.stringify(eventEmails(desired.attendees));
};

export const revisedCalendarEventId = (baseEventId: string, revision: number): string => (
  revision <= 0 ? baseEventId : `${baseEventId}r${revision.toString(32)}`
);

const reconcileKnownEvent = async (
  eventId: string,
  desired: CalendarEventPayload,
  gateway: CalendarEventGateway,
): Promise<KnownEventResult> => {
  let remote: CalendarRemoteEvent;
  try {
    remote = await gateway.get(eventId);
  } catch (error) {
    if (gateway.isMissing(error)) return { status: 'missing' };
    throw error;
  }

  if (remote.status === 'cancelled') return { status: 'cancelled' };
  if (!calendarEventNeedsUpdate(remote, desired)) return { eventId, status: 'already_synced' };

  try {
    await gateway.patch(eventId, desired);
    return { eventId, status: 'synced' };
  } catch (error) {
    if (gateway.isMissing(error)) return { status: 'missing' };
    throw error;
  }
};

const insertOrReconcileEvent = async (
  eventId: string,
  desired: CalendarEventPayload,
  gateway: CalendarEventGateway,
): Promise<CalendarEventWriteResult | null> => {
  try {
    const insertedId = await gateway.insert(eventId, desired);
    return { eventId: insertedId || eventId, status: 'synced' };
  } catch (error) {
    if (!gateway.isConflict(error)) throw error;
  }

  const existing = await reconcileKnownEvent(eventId, desired, gateway);
  return 'eventId' in existing ? existing : null;
};

export const ensureCalendarEvent = async (
  existingEventId: string | null,
  baseEventId: string,
  desired: CalendarEventPayload,
  gateway: CalendarEventGateway,
): Promise<CalendarEventWriteResult> => {
  if (existingEventId) {
    const existing = await reconcileKnownEvent(existingEventId, desired, gateway);
    if ('eventId' in existing) return existing;
  }

  for (let revision = 0; revision <= MAX_EVENT_ID_REVISIONS; revision += 1) {
    const candidateId = revisedCalendarEventId(baseEventId, revision);
    const result = await insertOrReconcileEvent(candidateId, desired, gateway);
    if (result) return result;
  }

  throw new Error('Não foi possível reservar um ID ativo para o evento do Google Agenda.');
};
