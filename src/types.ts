export interface TeamMember {
  id: string;
  owner_user_id: string;
  name: string;
  email?: string;
  color: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string;
  birth_date: string;
  cpf: string;
  cep: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  age: number;
  child_name: string;
  instagram: string;
  closing_date: string;
  notes: string;
  first_contact_date: string;
  last_contact_date: string;
  lead_source: string;
  status: string;
  created_at: string;
  jobs?: Job[];
  opportunities?: Opportunity[];
  tier?: string;
  total_invested?: number;
}

export interface Job {
  id: number;
  client_id: number;
  client_name?: string;
  job_type: string;
  job_date: string;
  job_time?: string;
  job_end_time?: string;
  job_name: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string;
  google_event_id?: string;
  created_at: string;
  production_stage?: string | null;
  production_stage_entered_at?: string | null;
  labels?: string[];
  assignee_id?: string | null;
}

export interface ProductionProcess {
  id: string;
  name: string;
  position: number;
  color: string;
  is_special?: boolean;
}

export interface ProductionStageV2 {
  id: string;
  name: string;
  position: number;
  color: string;
  process_id: string;
  expected_hours: number;
  is_final?: boolean;
  is_won?: boolean;
}

export interface FunnelStage {
  id: number;
  name: string;
  position: number;
}

export interface Lead {
  id: number;
  client_name: string;
  job_type_interest: string;
  contact_date: string;
  estimated_value: number;
  status: string;
  notes: string;
  stage_id: number;
  created_at: string;
}

export interface Opportunity {
  id: number;
  client_id: number;
  client_name?: string;
  type: string;
  suggested_date: string;
  status: 'future' | 'active' | 'urgent' | 'converted' | 'dismissed';
  notes: string;
  estimated_value?: number;
  created_at: string;
  priority?: 'future' | 'active' | 'urgent'; // Derived field
}

export interface OpportunityRule {
  id: number;
  trigger_job_type: string;
  target_job_type: string;
  days_offset: number;
  is_active: number;
}

export interface DashboardStats {
  totalClientsBase: number;
  totalClientsMonth: number;
  totalJobsMonth: number;
  activeLeads: number;
  revenueByType: { job_type: string; total: number }[];
  dailyRevenue: { date: string; total: number }[];
}

export type DealStage = string; // dynamic stages stored in deal_stages table
export type DealPriority = 'low' | 'medium' | 'high';
export type DealTemperature = 'cold' | 'warm' | 'hot';

export interface PipelineStage {
  id: DealStage;
  name: string;
  color: string;
  position: number;
  is_final: boolean;
  is_won: boolean;
  stage_type?: string;
}

export interface Deal {
  id: string;
  user_id: string;
  client_id: number | null;
  title: string;
  value: number;
  stage: DealStage;
  stage_entered_at?: string | null;
  current_stage_entered_at?: string | null;
  stage_history?: StageHistoryEntry[];
  priority: DealPriority;
  temperature?: DealTemperature | null;
  temperature_locked?: boolean;
  temperature_score?: number;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_instagram?: string | null;
  lead_source?: string | null;
  activity_count?: number;
  last_activity_at?: string | null;
  converted?: boolean;
  converted_at?: string | null;
  converted_client_id?: number | null;
  converted_job_id?: number | null;
  lost_reason?: string | null;
  lost_notes?: string | null;
  expected_close_date: string | null;
  next_follow_up: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
}

export interface StageHistoryEntry {
  stage_id: string;
  stage_name?: string;
  entered_at: string;
  left_at?: string | null;
}

export interface DealActivity {
  id: number;
  deal_id: number;
  user_id: string;
  type: string;
  description: string | null;
  created_at: string;
}

export interface DealStageEvent {
  id: number;
  deal_id: number;
  from_stage: DealStage | null;
  to_stage: DealStage;
  created_at: string;
  duration_ms?: number | null;
}

export interface PipelineAnalytics {
  conversionRate: number;
  conversionByStage: { stageId: DealStage; rate: number; from: number; to: number }[];
  stalledDeals: number;
  avgStageTime: { stageId: DealStage; hours: number }[];
  lostReasons: Record<string, number>;
  temperatureDistribution: Record<DealTemperature, number>;
  forecastHotValue: number;
  overdueFollowUps: number;
}

export interface Filho {
  id: string;
  cliente_id: number;
  nome: string;
  data_nascimento: string;
  sexo?: string;
  created_at: string;
  updated_at: string;
}

export interface Oportunidade {
  id: string;
  cliente_id: number;
  cliente_nome?: string;
  cliente_telefone?: string;
  cliente_email?: string;
  filho_id?: string;
  tipo: string;
  status: string;
  prioridade: string;
  data_oportunidade: string;
  data_contato?: string;
  valor_proposta?: number;
  notas?: string;
  created_at: string;
  updated_at: string;
}

export interface Cupom {
  id: string;
  codigo: string;
  cliente_id?: number;
  oportunidade_id?: string;
  tipo_desconto: 'PERCENTUAL' | 'VALOR_FIXO';
  valor_desconto: number;
  data_validade: string;
  usado: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  assignee_id?: string | null;
  job_id?: number | null;
  stage_id?: string | null;
  due_date: string;
  created_at: string;
  completed_at?: string | null;
}

export interface Aniversariante {
  tipo: 'MAE' | 'FILHO';
  nome: string;
  filhoId?: string;
  clienteId: number;
  clienteNome: string;
  telefone: string;
  email?: string;
  dataNascimento: string;
  diasParaAniversario: number;
  idade: number;
  sexo?: string;
  nivel?: string;
}

// ============ CATÁLOGO: PRODUTOS, SERVIÇOS E COMBOS ============

export interface Fornecedor {
  id: string;
  user_id?: string;
  nome: string;
  cnpj?: string;
  contato?: string;
  whatsapp?: string;
  email?: string;
  prazo_entrega?: number;
  observacoes?: string;
  created_at: string;
  updated_at?: string;
}

export type CategoriaProduto =
  | 'album_fotolivro'
  | 'impressao_fineart'
  | 'pendrive_midia'
  | 'moldura_quadro'
  | 'props_acessorios'
  | 'figurino_roupa'
  | 'embalagem_caixa'
  | 'outros';

export type UnidadeProduto = 'un' | 'cx' | 'pct' | 'par' | 'kit';

export const CATEGORIA_LABELS: Record<CategoriaProduto, string> = {
  album_fotolivro: 'Álbum / Fotolivro',
  impressao_fineart: 'Impressão Fine Art',
  pendrive_midia: 'Pendrive / Mídia',
  moldura_quadro: 'Moldura / Quadro',
  props_acessorios: 'Props / Acessórios',
  figurino_roupa: 'Figurino / Roupa',
  embalagem_caixa: 'Embalagem / Caixa',
  outros: 'Outros',
};

export const TIPO_ENSAIO_LABELS: Record<string, string> = {
  anunciacao: 'Anunciação',
  newborn: 'Newborn',
  smash_the_cake: 'Smash the Cake',
  parto: 'Parto',
  gestante: 'Gestante',
  cha_revelacao: 'Chá Revelação',
  cha_de_bebe: 'Chá de Bebê',
  ensaio_feminino: 'Ensaio Feminino',
  pre_party_15_anos: 'Pré-Party 15 Anos',
  corporativo: 'Corporativo',
  batizado: 'Batizado',
  festa_aniversario: 'Festa de Aniversário',
  ensaio_aniversario: 'Ensaio de Aniversário',
  acompanhamento: 'Acompanhamento',
  sessao_unica: 'Sessão Única',
  revelacao: 'Revelação',
};

export interface Produto {
  id: string;
  user_id?: string;
  nome: string;
  descricao?: string;
  categoria: CategoriaProduto;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  preco_custo: number;
  preco_venda: number;
  margem_lucro?: number;
  unidade: UnidadeProduto;
  estoque?: number;
  ncm?: string;
  cfop?: string;
  ativo: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Servico {
  id: string;
  user_id?: string;
  nome: string;
  descricao?: string;
  tipo_ensaio: string;
  preco_base: number;
  inclui_edicao: boolean;
  qtd_fotos_entrega?: number;
  cnae?: string;
  codigo_servico?: string;
  iss_aliquota?: number;
  ativo: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ComboItem {
  id: string;
  combo_id: string;
  tipo: 'produto' | 'servico';
  item_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
}

export interface Combo {
  id: string;
  user_id?: string;
  nome: string;
  descricao?: string;
  itens: ComboItem[];
  desconto: number;
  total_produtos: number;
  total_servicos: number;
  subtotal: number;
  preco_final: number;
  ativo: boolean;
  created_at: string;
  updated_at?: string;
}
