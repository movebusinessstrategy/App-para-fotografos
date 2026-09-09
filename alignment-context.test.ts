import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlignmentPreparation, completeAlignmentConfig, missingAlignmentConfig } from './src/features/alignment/context.js';
import { fixtureExtraction, simulationSources, runAlignmentSimulation } from './scripts/alignment-simulation.js';
import { firstAlignmentText } from './src/features/alignment/messages.js';
import { collectAlignmentSources } from './alignment-context.js';

test('reaproveita a conversa e começa pelos looks, sem repetir quatro escolhas', async () => {
  const trace = await runAlignmentSimulation();
  assert.deepEqual(Object.keys(trace.draft.data.answers), ['intencao', 'ambiente', 'participantes', 'estilo']);
  assert.match(firstAlignmentText(trace.draft.data), /quais looks/);
  assert.deepEqual(trace.stages.map(s => s.session.data.asked), ['looks', 'edicao', 'confirmacao', null]);
  assert.equal(trace.stages.at(-1)?.session.status, 'review');
  assert.equal(trace.draft.data.answers.participantes.evidence?.sourceId, 'message:old-1');
});

test('uma fonte inventada não preenche o pacote', () => {
  const raw = structuredClone(fixtureExtraction);
  raw.config[1].sourceId = 'outra-cliente';
  assert.throws(() => buildAlignmentPreparation(raw, simulationSources, 'posvenda', true), /origem verificável/);
});

test('um trecho inexistente não elimina uma pergunta', () => {
  const raw = structuredClone(fixtureExtraction);
  raw.answers[0].quote = 'quero fotos em Paris';
  assert.throws(() => buildAlignmentPreparation(raw, simulationSources, 'posvenda', true), /origem verificável/);
});

test('não transforma ausência de informação de vídeo em pacote sem vídeo', () => {
  const missing = missingAlignmentConfig({ kind: 'anunciacao', packageName: 'Anunciação', contractChecked: true });
  assert.deepEqual(missing, [{ field: 'hasVideo', label: 'Se o pacote inclui vídeo' }]);
});

test('não presume duas produções nem idade do bebê', () => {
  const missing = missingAlignmentConfig({ kind: 'baby', packageName: 'Baby', contractChecked: true });
  assert.deepEqual(missing.map(m => m.field), ['productions', 'babyMaterial']);
});

test('dossiê reaproveitado tem origem e não equivale à confirmação final', () => {
  const raw = structuredClone(fixtureExtraction);
  raw.answers = [{ field: 'participantes', value: 'Marido', sourceId: 'dossier', quote: 'participante: marido' },
    { field: 'confirmacao', value: 'Confirmado', sourceId: 'dossier', quote: 'participante: marido' }];
  const result = buildAlignmentPreparation(raw, simulationSources, 'posvenda', true);
  assert.equal(result.answers.participantes.source, 'history');
  assert.deepEqual(result.answers.participantes.messageIds, []);
  assert.equal(result.answers.confirmacao, undefined);
});

test('contrato ausente continua pendente mesmo com todos os outros dados', () => {
  const result = buildAlignmentPreparation(fixtureExtraction, simulationSources, 'posvenda', false);
  assert.deepEqual(result.missing.map(m => m.field), ['contractChecked']);
  assert.equal(completeAlignmentConfig(result.config).contractChecked, false);
});

test('inconsistência detectada pela leitura fica visível, sem perder dados aproveitados', () => {
  const result = buildAlignmentPreparation({ ...fixtureExtraction, issues: ['Contrato e venda mostram pacotes diferentes.'] }, simulationSources, 'posvenda', true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.config.packageName, 'Gestante Memória');
});

function fakeDatabase() {
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const rows: Record<string, unknown> = {
    jobs: { id: 901, created_at: '2026-09-01' }, deals: [{ id: 5, created_at: '2026-08-01' }],
    job_items: [], contracts: [{ id: 3, status: 'cancelled' }], deal_items: [],
    alignment_dossiers: [{ id: 'd1', status: 'ready', content: { preferencias: ['Natural'] } }], wa_messages: [],
  };
  return { queries, db: { from(table: string) {
    const query = { table, filters: [] as Array<[string, string, unknown]> }; queries.push(query);
    const builder: any = { select: () => builder, order: () => builder, limit: () => builder, single: () => builder,
      eq: (key: string, value: unknown) => { query.filters.push(['eq', key, value]); return builder; },
      in: (key: string, value: unknown) => { query.filters.push(['in', key, value]); return builder; },
      gte: (key: string, value: unknown) => { query.filters.push(['gte', key, value]); return builder; },
      then: (resolve: (v: unknown) => void) => resolve({ data: rows[table], error: null }),
    }; return builder;
  } } };
}

test('coleta apenas o dono, trabalho/venda vinculados e canais permitidos', async () => {
  const { db, queries } = fakeDatabase();
  const result = await collectAlignmentSources(db as any, { userId: 'owner', jobId: 901, phoneVariants: ['551100000000'], channels: ['permitted-channel'] });
  for (const query of queries.filter(q => !['job_items', 'deal_items'].includes(q.table))) {
    assert.ok(query.filters.some(f => f[1] === 'user_id' && f[2] === 'owner'), query.table);
  }
  assert.ok(queries.find(q => q.table === 'job_items')?.filters.some(f => f[1] === 'job_id' && f[2] === 901));
  assert.ok(queries.find(q => q.table === 'deal_items')?.filters.some(f => f[1] === 'deal_id' && f[2] === 5));
  const messages = queries.find(q => q.table === 'wa_messages')!;
  assert.deepEqual(messages.filters.find(f => f[1] === 'wa_number')?.[2], ['permitted-channel']);
  assert.equal(messages.filters.find(f => f[1] === 'timestamp')?.[2], '2026-08-01');
  assert.equal(result.contractChecked, false);
  assert.equal(result.sources.filter(s => s.id === 'dossier:d1').length, 1);
});
