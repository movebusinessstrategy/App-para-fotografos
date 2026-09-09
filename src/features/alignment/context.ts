import { ALIGNMENT_KINDS, BABY_MATERIALS, buildAlignmentSteps } from './playbook';
import type { AlignmentConfig, AlignmentEvidence, AlignmentPreparation } from './types';
export interface AlignmentSource { id: string; label: string; text: string; messageId?: string }
export interface ExtractedFact { field: string; value: unknown; sourceId: string; quote: string }
export interface ExtractedAlignment { config: ExtractedFact[]; answers: ExtractedFact[]; issues: string[] }

function evidenceFor(fact: ExtractedFact, sources: AlignmentSource[]): AlignmentEvidence {
  const match = sources.find(s => s.id === fact.sourceId);
  if (!match || typeof fact.quote !== 'string' || !fact.quote.trim() || !match.text.includes(fact.quote)) {
    throw new Error('A leitura retornou uma informação sem origem verificável. Tente ler o contexto novamente.');
  }
  return { sourceId: match.id, label: match.label, quote: fact.quote };
}
const configValidators: Record<string, (v: unknown) => boolean> = {
  kind: v => typeof v === 'string' && Object.hasOwn(ALIGNMENT_KINDS, v),
  packageName: v => typeof v === 'string' && Boolean(v.trim()) && v.length <= 300,
  environments: v => typeof v === 'string' && Boolean(v.trim()) && v.length <= 500,
  productions: v => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 3,
  hasVideo: v => typeof v === 'boolean',
  babyMaterial: v => BABY_MATERIALS.some(m => m.id === v),
};
const LABELS = { kind: 'Tipo de ensaio', packageName: 'Pacote contratado', environments: 'Ambientes incluídos no pacote', productions: 'Quantidade de produções', hasVideo: 'Se o pacote inclui vídeo', babyMaterial: 'Material para a idade do bebê', contractChecked: 'Envio do contrato registrado' };
export function missingAlignmentConfig(config: Partial<AlignmentConfig>): AlignmentPreparation['missing'] {
  const fields: Array<keyof typeof LABELS> = ['kind', 'packageName', 'contractChecked'];
  const kind = config.kind || '';
  if (['gestante', 'lifestyle', 'smash', 'revelacao'].includes(kind)) fields.push('environments');
  if (['newborn', 'smash', 'baby'].includes(kind)) fields.push('productions');
  if (['anunciacao', 'revelacao', 'cha_revelacao', 'aniversario', 'batizado'].includes(kind)) fields.push('hasVideo');
  if (kind === 'baby') fields.push('babyMaterial');
  return fields.filter(field => config[field] === undefined || config[field] === '' || (field === 'contractChecked' && !config[field]))
    .map(field => ({ field, label: LABELS[field] }));
}

export function buildAlignmentPreparation(raw: ExtractedAlignment, sources: AlignmentSource[], slot: AlignmentConfig['slot'], contractChecked: boolean): AlignmentPreparation {
  if (!Array.isArray(raw?.config) || !Array.isArray(raw?.answers) || !Array.isArray(raw?.issues)) throw new Error('Não consegui ler o contexto do trabalho.');
  const config: Partial<AlignmentConfig> = { slot, contractChecked };
  const evidence: Record<string, AlignmentEvidence> = {};
  for (const fact of raw.config) {
    if (fact.value === null) continue;
    if (!configValidators[fact.field]?.(fact.value)) throw new Error(`A leitura retornou um dado de pacote inválido (${fact.field}).`);
    if (evidence[fact.field]) throw new Error('A leitura retornou informações duplicadas. Confira o contexto.');
    evidence[fact.field] = evidenceFor(fact, sources);
    Object.assign(config, { [fact.field]: fact.value });
  }
  const answers = mapHistoricalAnswers(raw.answers, config, sources);
  return { config, answers, evidence, missing: missingAlignmentConfig(config),
    issues: raw.issues.filter(x => typeof x === 'string').map(x => x.slice(0, 500)), sources: sources.map(({ id, label }) => ({ id, label })) };
}

function mapHistoricalAnswers(facts: ExtractedFact[], config: Partial<AlignmentConfig>, sources: AlignmentSource[]) {
  const answers: AlignmentPreparation['answers'] = {};
  if (!config.kind) return answers;
  const fields = new Set(buildAlignmentSteps(completeAlignmentConfig(config)).map(s => s.id));
  for (const fact of facts) {
    if (!fields.has(fact.field) || typeof fact.value !== 'string' || !fact.value.trim() || fact.value.length > 1200) continue;
    const evidence = evidenceFor(fact, sources);
    const messageId = sources.find(s => s.id === fact.sourceId)?.messageId;
    answers[fact.field] = { value: fact.value, source: 'history', messageIds: messageId ? [messageId] : [], evidence };
  }
  return answers;
}

// Defaults apenas de campos que não participam do roteiro escolhido. Os campos
// obrigatórios são verificados em missingAlignmentConfig antes de salvar/enviar.
export function completeAlignmentConfig(c: Partial<AlignmentConfig>): AlignmentConfig {
  return { kind: 'gestante', slot: 'posvenda', packageName: '', environments: '', productions: 1, hasVideo: false, babyMaterial: '', contractChecked: false, ...c };
}
