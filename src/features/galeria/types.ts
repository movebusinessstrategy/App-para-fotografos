// Tipos do módulo de Galerias de seleção (proofing).
// Shapes seguem o contrato das rotas /api/galleries* do server.

export type GalleryStatus = "draft" | "sent" | "selected" | "delivered";

export interface Gallery {
  id: string;
  title: string;
  status: GalleryStatus;
  category: string | null;
  client_id: number | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  job_id: number | null;
  included_count: number;
  extra_price: number;
  share_token: string;
  view_count: number;
  sent_at: string | null;
  selected_at: string | null;
  selection_deadline?: string | null;
  created_at: string;
  photo_count: number;
  selected_count: number;
  extra_count: number;
  pending_amount: number;
  paid_amount: number;
  cover_thumb_url: string | null;
  require_login?: boolean;
  download_mode?: "off" | "with_watermark" | "clean";
  pricing_mode?: "no_charge" | "extra_avulso" | "upgrade_packs" | "sell_all";
}

export interface GalleryPhoto {
  id: string;
  file_name: string;
  sort_order: number;
  process_status: string; // pending | processing | done | error
  thumb_url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
}

export interface GallerySelection {
  photo_id: string;
  selected: boolean;
  client_comment: string | null;
}

export interface GalleryDetailResponse {
  gallery: Gallery;
  photos: GalleryPhoto[];
  selections: GallerySelection[];
}

export interface RevenueOrder {
  order_code: string;
  client_name: string | null;
  gallery_title: string | null;
  extra_count: number;
  amount: number;
  status: string; // pending | paid | ...
  created_at: string;
  paid_at: string | null;
}

export interface RevenueResponse {
  to_receive: number;
  received_month: number;
  avg_ticket: number;
  pending_count: number;
  orders: RevenueOrder[];
}

export interface GallerySettings {
  sender_name?: string | null;
  sender_email?: string | null;
  watermark_type?: "text" | "logo";
  watermark_text?: string | null;
  watermark_logo_path?: string | null;
  watermark_logo_url?: string | null;
  watermark_opacity?: number;
  watermark_include_client_name?: boolean;
  categories?: string[];
  mp_access_token?: string | null;
  mp_access_token_set?: boolean;
  mp_connected?: boolean;
  mp_email?: string | null;
  mp_user_id?: string | null;
  mp_oauth_available?: boolean;
  notify_studio_whatsapp?: boolean;
  protect_right_click?: boolean;
  protect_download?: boolean;
  custom_domain?: string | null;
  default_included_count?: number;
  default_extra_price?: number;
}

export interface SendResult {
  ok: boolean;
  link: string;
  email_sent: boolean;
  whatsapp_sent: boolean;
}
