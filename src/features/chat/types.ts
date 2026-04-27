export interface Conversation {
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
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
}
