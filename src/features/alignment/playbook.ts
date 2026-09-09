import type { AlignmentConfig, AlignmentKind, AlignmentMaterial, AlignmentStep } from './types';

export const ALIGNMENT_SOURCE = 'https://docs.google.com/document/d/1P8gmQW5SZeTAvYmwq9RXHjW1TzCrqC-Oypb2wu7AG8Q/edit';
export const ALIGNMENT_KINDS: Record<AlignmentKind, string> = {
  gestante: 'Gestante', newborn: 'Newborn posicionado', lifestyle: 'Newborn lifestyle',
  smash: 'Smash the Cake', baby: 'Acompanhamento / Baby', anunciacao: 'Anunciação',
  revelacao: 'Ensaio de revelação', cha_revelacao: 'Chá revelação',
  aniversario: 'Aniversário / Festa', batizado: 'Batizado', marca_pessoal: 'Marca pessoal',
};
const pdf = (id: string, title: string): AlignmentMaterial => ({ id, title, url: `https://drive.google.com/file/d/${id}/view` });
export const MATERIALS = {
  gestante: pdf('11H0ADRMrgAJnK_VM0WO9hCIYuwC7XY3W', 'Dicas e looks — Gestante'),
  newborn: pdf('149_waQYNfBkszcW70PqOnnvbLtxTvrJG', 'Dicas — Newborn'),
  newbornSets: pdf('1cDUvPkk74cn3r3jSjUjsX9CNshouGv5J', 'Produções — Newborn'),
  smash: pdf('1kNf2a25j3agTt8-cZt3rQPgzeC_gH9Rg', 'Dicas — Smash the Cake'),
  smashSets: pdf('1E_guIDSRDx-aTOT2D3IP7EbetV_UUiEV', 'Produções — Smash the Cake'),
  oneYear: pdf('1hAkLVdTvkYdXiyDU0CiupcAj3-c9Npfu', 'Catálogo de roupas — 1 ano'),
  baby: pdf('1HbwWMmZk0ie7lD_wEtJlgw_AIMtr_Ubh', 'Dicas — Acompanhamento / Baby'),
  marca: pdf('13yAhXx_r1-zUFCEDRqnkqf7FgWF_Hso3', 'Dicas — Marca pessoal'),
};
export const BABY_MATERIALS = [
  pdf('1KDP4TWMh-waPml0jSnCzyMpf4pFKeQOc', 'Produções menina — 3 meses'),
  pdf('1YmoaXJOX7LqgT31RjVvhWUFmdmjqhqzx', 'Produções menino — 3 meses'),
  pdf('1FtlxIVzn6bYjNRAsWxvI5_QViw7TVOUh', 'Produções menino — 6 a 11 meses'),
  pdf('1SIrBZ4-0MdLnQ7LrFiYdkPLPGWKPILwl', 'Produções menina — 6 a 11 meses'),
];
const step = (id: string, title: string, question: string, materials: AlignmentMaterial[] = []): AlignmentStep => ({ id, title, question, materials });
const intent = () => step('intencao', 'Ideias e referências', 'Como você imaginou as fotos? Se tiver inspirações, pode me mandar por aqui ❤️');
const palette = () => step('cores', 'Cores', 'Quais cores você gostaria de usar nas fotos? Pode também me dizer se prefere que a gente sugira.');
const music = () => step('musica', 'Música do vídeo', 'Como o seu pacote inclui vídeo, tem alguma música que vocês gostariam de usar? Pode mandar o nome ou link, ou deixar a escolha com a gente 😊');
const place = (c: AlignmentConfig) => step('ambiente', 'Ambiente', `Dentro do que foi contratado (${c.environments}), qual ambiente você gostaria de usar?`);
const tips = (material: AlignmentMaterial) => step('orientacoes', 'Orientações recebidas', 'Aqui estão as orientações para preparar o ensaio. Conseguiu abrir e ficou alguma dúvida?', [material]);
const looks = (materials: AlignmentMaterial[] = []) => step('looks', 'Looks e acessórios', 'Você já pensou em quais looks gostaria de usar? Se quiser, pode mandar fotos das peças para alinharmos 😊', materials);
const sets = (c: AlignmentConfig, materials: AlignmentMaterial[]) => step('producoes', 'Produções', `Vamos combinar as produções? Aqui estão as opções para você escolher ${c.productions}. Pode mandar o nome, número ou a imagem das escolhidas ❤️`, materials);

function gestante(c: AlignmentConfig): AlignmentStep[] {
  return [intent(), place(c), step('participantes', 'Participantes', 'Mais alguém irá participar do ensaio com você?'),
    looks([MATERIALS.gestante]), step('edicao', 'Cuidados na edição', 'Tem algum detalhe que costuma incomodar vocês e que gostariam que tivéssemos um cuidado especial na edição?'),
    step('estilo', 'Estilo das fotos', 'Você prefere fotos mais suaves e claras ou com mais contraste e sombras? Podemos variar conforme o ambiente e o look escolhido ❤️')];
}
function newborn(c: AlignmentConfig): AlignmentStep[] {
  return [sets(c, [MATERIALS.newbornSets]), step('cores', 'Cores por produção', 'Qual cor você gostaria para cada uma das produções escolhidas? Vou registrar as preferências para conferirmos as opções disponíveis ❤️'), tips(MATERIALS.newborn)];
}
function lifestyle(c: AlignmentConfig): AlignmentStep[] {
  return [place(c), step('espaco', 'Espaço das fotos', 'Em qual cantinho desse local vocês imaginam as fotos? Pode me mandar referências do espaço 😊'), palette(), intent()];
}
function smash(c: AlignmentConfig): AlignmentStep[] {
  return [place(c), sets(c, [MATERIALS.smashSets]),
    step('bolo', 'Bolo e restrições', 'Vocês gostariam do bolo no ensaio? O material informa ovos, leite e farinha; me avise se houver alguma alergia ou restrição para conferirmos com cuidado.', [MATERIALS.smash]),
    looks([MATERIALS.oneYear]), tips(MATERIALS.smash)];
}
function baby(c: AlignmentConfig): AlignmentStep[] {
  const material = BABY_MATERIALS.find(m => m.id === c.babyMaterial);
  return [sets(c, material ? [material] : []), step('cores', 'Cores das produções', 'Podem ser as cores dessas produções ou vocês têm outra paleta de preferência?'), tips(MATERIALS.baby)];
}
function announcement(c: AlignmentConfig): AlignmentStep[] {
  const items = [intent(), step('acessorios', 'Roupas e acessórios', 'Vocês pensaram em levar ultrassom, teste, roupinha ou sapatinhos? Peças claras também combinam com esse momento 😊')];
  if (c.hasVideo) items.push(music());
  return items;
}
function revelation(c: AlignmentConfig): AlignmentStep[] {
  const items = [place(c), step('revelacao', 'Item da revelação', 'O que vocês pensaram em usar na revelação? Dentro do estúdio não é permitido usar pó ou fumaça.'), ...announcement(c)];
  return items;
}
function event(c: AlignmentConfig): AlignmentStep[] {
  const items = [step('local', 'Local do evento', 'Pode confirmar o nome e o endereço do local do evento?'), step('horario', 'Data e horário', 'Pode confirmar a data e o horário de início para conferirmos com o agendamento?')];
  if (c.kind === 'cha_revelacao') items.push(step('revelacao', 'Momento da revelação', 'Como vocês planejaram o momento da revelação?'), intent());
  if (c.hasVideo) items.push(music());
  items.push(step('registros', 'Registros importantes', 'Tem alguma pessoa ou momento que vocês fazem questão de registrar?'));
  return items;
}
function brand(): AlignmentStep[] {
  return [tips(MATERIALS.marca), step('atuacao', 'Área de atuação', 'Me conta um pouco do seu trabalho e da imagem que você quer transmitir com essas fotos 😊'),
    intent(), palette(), looks(), step('uso', 'Uso das fotos', 'Onde você pretende usar as fotos: Instagram, site, perfil profissional ou algum outro material?'),
    step('objetos', 'Objetos de trabalho', 'Tem algum objeto do seu trabalho que gostaria de levar para compor as fotos?')];
}
const BUILDERS: Record<AlignmentKind, (c: AlignmentConfig) => AlignmentStep[]> = {
  gestante, newborn, lifestyle, smash, baby, anunciacao: announcement, revelacao: revelation,
  cha_revelacao: event, aniversario: event, batizado: event, marca_pessoal: brand,
};
export const buildAlignmentSteps = (config: AlignmentConfig): AlignmentStep[] => BUILDERS[config.kind](config);

export function validateAlignmentConfig(c: AlignmentConfig): void {
  if (!c || !Object.hasOwn(ALIGNMENT_KINDS, c.kind)) throw new Error('Escolha um roteiro do manual.');
  if (!['main', 'posvenda'].includes(c.slot)) throw new Error('Escolha o WhatsApp de envio.');
  validatePackage(c);
  validateMaterials(c);
  if (typeof c.hasVideo !== 'boolean' || c.contractChecked !== true) throw new Error('Confira o pacote e o contrato antes de preparar o alinhamento.');
}
function validatePackage(c: AlignmentConfig): void {
  if (typeof c.packageName !== 'string' || !c.packageName.trim() || c.packageName.length > 300) throw new Error('Confira e informe o pacote contratado.');
  if (typeof c.environments !== 'string' || c.environments.length > 500) throw new Error('Confira os ambientes contratados.');
  if (['gestante', 'lifestyle', 'smash', 'revelacao'].includes(c.kind) && !c.environments.trim()) throw new Error('Informe apenas os ambientes incluídos no pacote.');
}
function validateMaterials(c: AlignmentConfig): void {
  if (!Number.isInteger(c.productions) || c.productions < 1 || c.productions > 3) throw new Error('Confira a quantidade de produções do pacote (1 a 3).');
  if (c.kind === 'baby' && !BABY_MATERIALS.some(m => m.id === c.babyMaterial)) throw new Error('Escolha o material correspondente à idade do bebê.');
}

export function renderAlignmentStep(s: AlignmentStep): string {
  return [s.question, ...s.materials.map(m => `${m.title}\n${m.url}`)].join('\n\n');
}
