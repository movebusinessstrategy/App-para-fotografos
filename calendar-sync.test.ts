import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalendarEventPayload,
  calendarEventNeedsUpdate,
  ensureCalendarEvent,
  hasValidCalendarStart,
  revisedCalendarEventId,
  type CalendarEventPayload,
  type CalendarRemoteEvent,
} from './calendar-sync.js';

const desiredEvent = buildCalendarEventPayload({
  job_date: '2026-08-20',
  job_time: '09:30',
  job_end_time: '10:30',
  job_type: 'Gestante',
  notes: 'Ensaio confirmado',
}, {
  name: 'Cliente Teste',
  email: 'cliente@example.com',
})!;

const remoteFromDesired = (overrides: CalendarRemoteEvent = {}): CalendarRemoteEvent => ({
  ...desiredEvent,
  ...overrides,
});

const googleError = (code: number) => Object.assign(new Error(`Google ${code}`), { code });

test('não cria payload sem data e horário reais', () => {
  assert.equal(hasValidCalendarStart('2026-08-20', ''), false);
  assert.equal(hasValidCalendarStart('2026-08-20', null), false);
  assert.equal(hasValidCalendarStart('2026-02-30', '09:00'), false);
  assert.equal(buildCalendarEventPayload({ job_date: '2026-08-20', job_time: null }, null), null);
  assert.equal(buildCalendarEventPayload({ job_date: '2026-08-20', job_time: '25:00' }, null), null);
});

test('monta payload com horário informado e término padrão de uma hora', () => {
  const event = buildCalendarEventPayload({
    job_date: '2026-08-20',
    job_time: '09:30:00',
    job_type: 'Família',
  }, { name: 'Ana', email: 'ana@example.com' });

  assert.equal(event?.start.dateTime, '2026-08-20T09:30:00');
  assert.equal(event?.end.dateTime, '2026-08-20T10:30:00');
  assert.deepEqual(event?.attendees, [{ email: 'ana@example.com' }]);
});

test('considera horários equivalentes mesmo quando o Google devolve offset', () => {
  const remote = remoteFromDesired({
    start: { dateTime: '2026-08-20T09:30:00-03:00' },
    end: { dateTime: '2026-08-20T10:30:00-03:00' },
  });

  assert.equal(calendarEventNeedsUpdate(remote, desiredEvent), false);
});

test('detecta divergência de status, horário e participantes', () => {
  assert.equal(calendarEventNeedsUpdate(remoteFromDesired({ status: 'cancelled' }), desiredEvent), true);
  assert.equal(calendarEventNeedsUpdate(remoteFromDesired({
    start: { dateTime: '2026-08-20T11:00:00-03:00' },
  }), desiredEvent), true);
  assert.equal(calendarEventNeedsUpdate(remoteFromDesired({
    attendees: [{ email: 'outra@example.com' }],
  }), desiredEvent), true);
});

test('evento existente idêntico é confirmado sem patch nem novo convite', async () => {
  let patched = 0;
  let inserted = 0;
  const result = await ensureCalendarEvent('evento-atual', 'evento-base', desiredEvent, {
    get: async () => remoteFromDesired(),
    insert: async () => { inserted += 1; return null; },
    patch: async () => { patched += 1; },
    isConflict: (error) => (error as any)?.code === 409,
    isMissing: (error) => [404, 410].includes((error as any)?.code),
  });

  assert.deepEqual(result, { eventId: 'evento-atual', status: 'already_synced' });
  assert.equal(patched, 0);
  assert.equal(inserted, 0);
});

test('evento existente divergente recebe patch uma única vez', async () => {
  let patched = 0;
  const result = await ensureCalendarEvent('evento-atual', 'evento-base', desiredEvent, {
    get: async () => remoteFromDesired({ attendees: [] }),
    insert: async () => null,
    patch: async () => { patched += 1; },
    isConflict: (error) => (error as any)?.code === 409,
    isMissing: (error) => [404, 410].includes((error as any)?.code),
  });

  assert.deepEqual(result, { eventId: 'evento-atual', status: 'synced' });
  assert.equal(patched, 1);
});

test('409 com ID determinístico cancelado usa revisão estável e não afirma falso synced', async () => {
  const insertions: string[] = [];
  const result = await ensureCalendarEvent(null, 'crmtrilhaabc', desiredEvent, {
    get: async (eventId) => {
      if (eventId === 'crmtrilhaabc') return remoteFromDesired({ status: 'cancelled' });
      throw googleError(404);
    },
    insert: async (eventId) => {
      insertions.push(eventId);
      if (eventId === 'crmtrilhaabc') throw googleError(409);
      return eventId;
    },
    patch: async () => undefined,
    isConflict: (error) => (error as any)?.code === 409,
    isMissing: (error) => [404, 410].includes((error as any)?.code),
  });

  assert.deepEqual(insertions, ['crmtrilhaabc', 'crmtrilhaabcr1']);
  assert.deepEqual(result, { eventId: 'crmtrilhaabcr1', status: 'synced' });
  assert.equal(revisedCalendarEventId('crmtrilhaabc', 1), 'crmtrilhaabcr1');
});

test('404 do vínculo salvo recria usando o ID determinístico', async () => {
  const insertions: string[] = [];
  const result = await ensureCalendarEvent('evento-apagado', 'crmtrilhanovo', desiredEvent, {
    get: async () => { throw googleError(404); },
    insert: async (eventId, _event: CalendarEventPayload) => {
      insertions.push(eventId);
      return eventId;
    },
    patch: async () => undefined,
    isConflict: (error) => (error as any)?.code === 409,
    isMissing: (error) => [404, 410].includes((error as any)?.code),
  });

  assert.deepEqual(insertions, ['crmtrilhanovo']);
  assert.deepEqual(result, { eventId: 'crmtrilhanovo', status: 'synced' });
});
