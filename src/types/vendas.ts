export type Channel = 'whatsapp' | 'instagram';
export type PipelineStage = string;
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  isFromClient: boolean;
  status?: MessageStatus;
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  instagramHandle?: string;
  channel: Channel;
  source?: string;
  status?: "inbox" | "pipeline" | "archived";
  stage: PipelineStage;
  serviceType: string;
  estimatedValue: number;
  tags: string[];
  notes: string;
  messages: Message[];
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuickReply {
  id: string;
  title: string;
  content: string;
}
