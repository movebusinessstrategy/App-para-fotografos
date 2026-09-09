export type AlignmentKind = 'gestante' | 'newborn' | 'lifestyle' | 'smash' | 'baby' | 'anunciacao' | 'revelacao' | 'cha_revelacao' | 'aniversario' | 'batizado' | 'marca_pessoal';
export type AlignmentStatus = 'draft' | 'active' | 'processing' | 'sending' | 'paused' | 'needs_human' | 'review' | 'completed';
export interface AlignmentMaterial { id: string; title: string; url: string }
export interface AlignmentStep {
  id: string;
  title: string;
  question: string;
  materials: AlignmentMaterial[];
}
export interface AlignmentConfig {
  kind: AlignmentKind;
  slot: 'main' | 'posvenda';
  packageName: string;
  environments: string;
  productions: number;
  hasVideo: boolean;
  babyMaterial: string;
  contractChecked: boolean;
}
export interface AlignmentEvidence { sourceId: string; label: string; quote: string }
export interface AlignmentAnswer { value: string; source: 'operator' | 'client' | 'history'; messageIds: string[]; evidence?: AlignmentEvidence }
export interface AlignmentPreparation {
  config: Partial<AlignmentConfig>;
  answers: Record<string, AlignmentAnswer>;
  evidence: Record<string, AlignmentEvidence>;
  missing: Array<{ field: keyof AlignmentConfig; label: string }>;
  issues: string[];
  sources: Array<{ id: string; label: string }>;
  contextVersion?: string;
}
export interface AlignmentData {
  config: AlignmentConfig;
  steps: AlignmentStep[];
  answers: Record<string, AlignmentAnswer>;
  asked: string | null;
  seen: string[];
  sent: string[];
  startedAt: string | null;
  pending: { text: string; nextStatus: 'active' | 'review'; messageId?: string } | null;
  reason: string | null;
  attempts: number;
  preparation?: AlignmentPreparation;
}
export interface AlignmentSession {
  id: string; job_id: number; user_id: string; phone: string; wa_number: string;
  status: AlignmentStatus; revision: number; data: AlignmentData; updated_at: string;
}
