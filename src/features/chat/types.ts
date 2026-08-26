export interface Conversation {
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  last_from_me?: boolean; // última mensagem foi nossa → mostra ✓✓ na lista
  /** Estado operacional do atendimento. `needs_human` mantém compatibilidade
   * com conversas gravadas antes da máquina de estados da Lia. */
  needs_human?: boolean;
  agent_status?: 'idle' | 'lia_active' | 'quote_sent' | 'needs_human' | 'human_active' | null;
  handoff_reason?: string | null;
  handoff_at?: string | null;
  human_assumed_at?: string | null;
}

export interface Message {
  message_id: string;
  body: string;
  from_me: boolean;
  timestamp: string;
  type: string;
  status: string;
  media_url: string | null;
  duration?: number | null;
  waveform?: number[] | null;
  transcription?: string | null; // texto do áudio (Whisper) / descrição da imagem (Vision)
}
