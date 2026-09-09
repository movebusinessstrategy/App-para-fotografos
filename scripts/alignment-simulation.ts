import { AlignmentEngine, type AlignmentMessage, type AlignmentStore, type AlignmentDecision, type AlignmentEvaluator } from '../alignment-engine.js';
import { buildAlignmentPreparation, completeAlignmentConfig, type AlignmentSource, type ExtractedAlignment } from '../src/features/alignment/context.js';
import { buildAlignmentSteps } from '../src/features/alignment/playbook.js';
import { firstAlignmentText } from '../src/features/alignment/messages.js';
import type { AlignmentSession } from '../src/features/alignment/types.js';

export const simulationSources: AlignmentSource[] = [
  { id: 'job', label: 'Trabalho agendado · exemplo fictício', text: 'Ensaio gestante em 15/10/2026. Pacote contratado: Gestante Memória. Inclui estúdio e Fundo Encantado. Sem vídeo.' },
  { id: 'dossier', label: 'Dossiê já extraído · exemplo fictício', text: 'Combinados: usar estúdio e Fundo Encantado; participante: marido. Preferências: fotos suaves e claras, naturais, sem poses muito marcadas. Looks e cuidados na edição ainda não definidos.' },
  { id: 'message:old-1', messageId: 'old-1', label: 'Cliente · conversa anterior fictícia', text: 'Fechamos o Gestante Memória. Quero fazer no estúdio e no Fundo Encantado, com meu marido. Quero fotos naturais, sem poses muito marcadas, suaves e claras.' },
];
export const fixtureExtraction: ExtractedAlignment = {
  config: [
    { field: 'kind', value: 'gestante', sourceId: 'job', quote: 'Ensaio gestante' },
    { field: 'packageName', value: 'Gestante Memória', sourceId: 'job', quote: 'Pacote contratado: Gestante Memória' },
    { field: 'environments', value: 'estúdio e Fundo Encantado', sourceId: 'job', quote: 'Inclui estúdio e Fundo Encantado' },
  ],
  answers: [
    { field: 'intencao', value: 'Fotos naturais, sem poses muito marcadas', sourceId: 'message:old-1', quote: 'Quero fotos naturais, sem poses muito marcadas' },
    { field: 'ambiente', value: 'Estúdio e Fundo Encantado', sourceId: 'message:old-1', quote: 'Quero fazer no estúdio e no Fundo Encantado' },
    { field: 'participantes', value: 'Marido', sourceId: 'message:old-1', quote: 'com meu marido' },
    { field: 'estilo', value: 'Fotos suaves e claras', sourceId: 'message:old-1', quote: 'suaves e claras' },
  ], issues: [],
};
const replies = [
  { field: 'looks', body: 'Vou usar um vestido branco e um conjunto bege. Meu marido vai de camisa branca e calça bege.' },
  { field: 'edicao', body: 'Prefiro que preservem as marcas da minha barriga. Quero a edição bem natural, sem remover essas marcas.' },
  { field: 'confirmacao', body: 'Sim, o resumo está certinho. Pode manter tudo assim.' },
];
export const fixtureEvaluator: AlignmentEvaluator = async (s, messages) => ({ action: 'answer', reason: '', answers: [
  { field: s.data.asked!, value: messages[0].body, messageId: messages[0].message_id, quote: messages[0].body },
] });

export async function runAlignmentSimulation(raw = fixtureExtraction, evaluate = fixtureEvaluator) {
  const preparation = buildAlignmentPreparation(raw, simulationSources, 'posvenda', true);
  if (preparation.missing.length || preparation.issues.length) throw new Error('A leitura do cenário deixou pendências: ' + JSON.stringify(preparation));
  const config = completeAlignmentConfig(preparation.config);
  const steps = [...buildAlignmentSteps(config), { id: 'confirmacao', title: 'Confirmação da cliente', question: '', materials: [] }];
  let session: AlignmentSession = { id: 'simulacao', user_id: 'ficticio', job_id: 901, phone: 'cliente-ficticia', wa_number: 'canal-simulado', status: 'draft', revision: 0,
    updated_at: new Date().toISOString(), data: { config, steps, preparation, answers: preparation.answers, seen: [], sent: [], asked: null, startedAt: null, pending: null, reason: null, attempts: 0 } };
  const draft = structuredClone(session);
  const messages: AlignmentMessage[] = [];
  const decisions: AlignmentDecision[] = [];
  const stages: Array<{ session: AlignmentSession; messages: AlignmentMessage[] }> = [];
  const store: AlignmentStore = {
    get: async () => structuredClone(session),
    save: async (s, status, data) => {
      if (s.revision !== session.revision) return null;
      session = { ...s, status, data: structuredClone(data), revision: s.revision + 1 }; return structuredClone(session);
    },
    messages: async () => structuredClone(messages),
    checkJob: async () => {},
    recordSent: async (_s, text, messageId) => { messages.push({ message_id: messageId, body: text, from_me: true, type: 'chat', timestamp: new Date(Date.now() - 20_000).toISOString() }); },
  };
  const engine = new AlignmentEngine(store, { check: async () => {}, send: async () => `simulated-${messages.length}` }, async (s, incoming) => {
    const result = await evaluate(s, incoming); decisions.push(result); return result;
  });
  await engine.dispatch(session, firstAlignmentText(session.data), 'active');
  stages.push({ session: structuredClone(session), messages: structuredClone(messages) });
  for (const reply of replies) {
    if (session.data.asked !== reply.field) throw new Error(`A IA deveria perguntar ${reply.field}, mas perguntou ${session.data.asked}.`);
    messages.push({ message_id: `client-${reply.field}`, body: reply.body, from_me: false, type: 'chat', timestamp: new Date(Date.now() - 20_000).toISOString() });
    await engine.process(session);
    if (!['active', 'review'].includes(session.status)) throw new Error(`Conversa interrompida: ${session.data.reason}`);
    stages.push({ session: structuredClone(session), messages: structuredClone(messages) });
  }
  if (session.status !== 'review') throw new Error('A conversa não chegou à revisão do resumo.');
  return { draft, stages, decisions, sources: simulationSources };
}
