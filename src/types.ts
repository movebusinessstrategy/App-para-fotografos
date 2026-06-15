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
  address_number?: string;
  address_complement?: string;
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
  amount_paid?: number;
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
  position?: number;
  cover_image_url?: string | null;
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
  follow_up_message?: string | null;
  auto_follow_up_enabled?: boolean;
  follow_up_delay_hours?: number;
  follow_up_template_id?: number | null;
}

export interface PipelineLabel {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Deal {
  id: string;
  user_id: string;
  client_id: number | null;
  title: string;
  value: number;
  stage: DealStage;
  labels?: string[];
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
  catalog_type?: 'combo' | 'produto' | 'servico' | null;
  catalog_id?: string | null;
  catalog_name?: string | null;
  catalog_value?: number | null;
  items?: DealItem[];
  assigned_to?: string | null;
}

export interface DealItem {
  id: string;
  deal_id: number;
  catalog_type: 'combo' | 'produto' | 'servico';
  catalog_id: string;
  catalog_name: string;
  catalog_value: number;
  quantidade: number;
  created_at: string;
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
  tipo_pessoa?: 'PF' | 'PJ';
  cnpj?: string;
  cpf?: string;
  contato?: string;
  whatsapp?: string;
  email?: string;
  prazo_entrega?: number;
  observacoes?: string;
  created_at: string;
  updated_at?: string;
}

export interface CategoriaCatalogo {
  id: string;
  user_id?: string;
  nome: string;
  cor?: string;
  created_at: string;
}

export interface TipoEnsaio {
  id: string;
  user_id?: string;
  nome: string;
  created_at: string;
}

export type UnidadeProduto = 'un' | 'cx' | 'pct' | 'par' | 'kit';

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
  categoria: string;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  preco_custo: number;
  preco_venda: number;
  margem_lucro?: number;
  unidade: UnidadeProduto;
  estoque?: number;
  controla_estoque?: boolean;
  sob_encomenda?: boolean;
  estoque_minimo?: number;
  prazo_entrega?: number;
  ncm?: string;
  cfop?: string;
  origem?: string;
  ativo: boolean;
  created_at: string;
  updated_at?: string;
}

export type CompraStatus = 'analise' | 'aprovado' | 'comprado' | 'cancelado';

export interface Compra {
  id: string;
  user_id?: string;
  produto_id: string | null;
  produto_nome: string;
  quantidade: number;
  status: CompraStatus;
  observacao?: string | null;
  job_id?: number | null;
  job_item_id?: string | null;
  cliente_nome?: string | null;
  valor_pago?: number | null;
  fin_despesa_id?: string | null;
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

export interface ContractTemplate {
  id: number;
  user_id: string;
  name: string;
  category: string;
  body: string;
  default_data: Record<string, string | number>;
  is_default: boolean;
  is_legacy: boolean;
  archived: boolean;
  created_at: string;
  updated_at?: string;
}

export type WhatsAppTemplateStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION'
  | 'DELETED'
  | 'LIMIT_EXCEEDED'
  | (string & {});
export type WhatsAppTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WhatsAppButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

export interface WhatsAppTemplateButton {
  type: WhatsAppButtonType;
  text: string;
  url?: string;            // só p/ URL
  phone_number?: string;   // só p/ PHONE_NUMBER
}

export interface WhatsAppMessageTemplate {
  id: number;
  user_id: string;
  meta_template_id: string | null;
  name: string;
  category: WhatsAppTemplateCategory;
  language: string;
  body_text: string;
  example_values: string[];
  header_text: string | null;
  footer_text: string | null;
  buttons: WhatsAppTemplateButton[];
  status: WhatsAppTemplateStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at?: string;
}
