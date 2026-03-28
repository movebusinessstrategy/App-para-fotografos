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
