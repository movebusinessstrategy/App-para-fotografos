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
