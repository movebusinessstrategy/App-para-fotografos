import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InviteEmailValidationError,
  JobScheduleValidationError,
  inviteEmailUpdateForExistingClient,
  normalizeRequiredJobSchedule,
  normalizeInviteEmail,
  requiresConversionToEnterWonStage,
  syncConversionCalendarJob,
} from './calendar-conversion.js';

test('normaliza e valida o e-mail de qualquer convite', () => {
  assert.equal(normalizeInviteEmail(' cliente@example.com '), 'cliente@example.com');
  assert.equal(normalizeInviteEmail('   '), null);
  assert.throws(() => normalizeInviteEmail('email-invalido'), InviteEmailValidationError);
});

test('normaliza o e-mail informado para um cliente existente', () => {
  assert.deepEqual(
    inviteEmailUpdateForExistingClient(false, 31, ' cliente@example.com '),
    { clientId: 31, email: 'cliente@example.com' },
  );
  assert.deepEqual(
    inviteEmailUpdateForExistingClient(false, 31, '   '),
    { clientId: 31, email: null },
  );
});

test('ignora inviteEmail para cliente novo ou quando o campo não foi enviado', () => {
  assert.equal(inviteEmailUpdateForExistingClient(true, 31, 'cliente@example.com'), null);
  assert.equal(inviteEmailUpdateForExistingClient(false, 31, undefined), null);
});

test('rejeita e-mail inválido antes da conversão', () => {
  assert.throws(
    () => inviteEmailUpdateForExistingClient(false, 31, 'email-invalido'),
    InviteEmailValidationError,
  );
});

test('exige o fluxo de fechamento antes de entrar em uma etapa ganha', () => {
  assert.equal(requiresConversionToEnterWonStage(true, false, null), true);
  assert.equal(requiresConversionToEnterWonStage(true, true, null), false);
  assert.equal(requiresConversionToEnterWonStage(true, false, 77), false);
  assert.equal(requiresConversionToEnterWonStage(false, false, null), false);
});

test('normaliza e valida a agenda obrigatória do ensaio', () => {
  assert.deepEqual(normalizeRequiredJobSchedule({
    job_type: ' Gestante ',
    job_date: '2026-08-20T00:00:00',
    job_time: '09:30:00',
    job_end_time: '10:30:00',
  }), {
    job_type: 'Gestante',
    job_date: '2026-08-20',
    job_time: '09:30',
    job_end_time: '10:30',
  });
  assert.throws(() => normalizeRequiredJobSchedule({ job_type: 'Gestante', job_date: '2026-02-30', job_time: '09:00' }), JobScheduleValidationError);
  assert.throws(() => normalizeRequiredJobSchedule({ job_type: 'Gestante', job_date: '2026-08-20', job_time: '' }), JobScheduleValidationError);
  assert.throws(() => normalizeRequiredJobSchedule({ job_type: 'Gestante', job_date: '2026-08-20', job_time: '10:00', job_end_time: '09:00' }), JobScheduleValidationError);
});

test('aguarda o Google Agenda antes de reler o ensaio e confirma o convite', async () => {
  const calls: string[] = [];

  const result = await syncConversionCalendarJob(42, {
    syncJob: async (jobId) => {
      calls.push(`sync:${jobId}`);
      return 'synced';
    },
    loadJob: async (jobId) => {
      calls.push(`load:${jobId}`);
      return {
        google_event_id: 'google-event-42',
        clients: { email: ' cliente@example.com ' },
      };
    },
  });

  assert.deepEqual(calls, ['sync:42', 'load:42']);
  assert.deepEqual(result, {
    calendar_sync_status: 'synced',
    calendar_synced: true,
    google_event_id: 'google-event-42',
    invite_email: 'cliente@example.com',
    invite_requested: true,
    invite_sent: true,
    google_calendar_connected: true,
  });
});

test('não afirma envio de convite quando o cliente não tem e-mail', async () => {
  const result = await syncConversionCalendarJob(7, {
    syncJob: async () => 'synced',
    loadJob: async () => ({ google_event_id: 'google-event-7', clients: null }),
  });

  assert.equal(result.calendar_synced, true);
  assert.equal(result.invite_email, null);
  assert.equal(result.invite_requested, false);
  assert.equal(result.invite_sent, false);
});

test('não afirma sincronização nem convite sem o id persistido do evento', async () => {
  const result = await syncConversionCalendarJob(10, {
    syncJob: async () => 'synced',
    loadJob: async () => ({ google_event_id: null, clients: { email: 'cliente@example.com' } }),
  });

  assert.equal(result.calendar_sync_status, 'synced');
  assert.equal(result.calendar_synced, false);
  assert.equal(result.invite_requested, false);
  assert.equal(result.invite_sent, false);
});

test('não solicita outro convite quando o evento já estava sincronizado', async () => {
  const result = await syncConversionCalendarJob(11, {
    syncJob: async () => 'already_synced',
    loadJob: async () => ({ google_event_id: 'google-event-11', clients: { email: 'cliente@example.com' } }),
  });

  assert.equal(result.calendar_synced, true);
  assert.equal(result.invite_requested, false);
  assert.equal(result.invite_sent, false);
});

test('expõe agenda desconectada sem impedir a conversão', async () => {
  const result = await syncConversionCalendarJob(8, {
    syncJob: async () => 'not_connected',
    loadJob: async () => ({ google_event_id: null, clients: { email: 'cliente@example.com' } }),
  });

  assert.equal(result.calendar_sync_status, 'not_connected');
  assert.equal(result.calendar_synced, false);
  assert.equal(result.invite_requested, false);
  assert.equal(result.invite_sent, false);
  assert.equal(result.google_calendar_connected, false);
});

test('transforma falha inesperada em estado explícito e ainda relê o ensaio', async () => {
  const errors: string[] = [];
  let jobReloaded = false;

  const result = await syncConversionCalendarJob(9, {
    syncJob: async () => {
      throw new Error('Google indisponível');
    },
    loadJob: async () => {
      jobReloaded = true;
      return { google_event_id: null, clients: { email: 'cliente@example.com' } };
    },
    reportError: (message) => errors.push(message),
  });

  assert.equal(jobReloaded, true);
  assert.equal(result.calendar_sync_status, 'failed');
  assert.equal(result.calendar_synced, false);
  assert.equal(result.invite_requested, false);
  assert.equal(result.invite_sent, false);
  assert.equal(result.google_calendar_connected, null);
  assert.equal(errors.length, 1);
});

test('sem ensaio mantém os campos de calendário compatíveis e não chama dependências', async () => {
  let called = false;
  const result = await syncConversionCalendarJob(null, {
    syncJob: async () => {
      called = true;
      return 'synced';
    },
    loadJob: async () => {
      called = true;
      return null;
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    calendar_sync_status: 'skipped',
    calendar_synced: false,
    google_event_id: null,
    invite_email: null,
    invite_requested: false,
    invite_sent: false,
    google_calendar_connected: null,
  });
});
