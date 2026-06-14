// Tipos compartilhados do módulo de Diagramação de Álbum.
// Shapes seguem o contrato das rotas /api/albums* (e /api/public/album*) do server.

export type AlbumStatus = "draft" | "sent" | "approved";

export type AlbumAssetSource = "upload" | "gallery";

// Uma foto disponível no álbum (importada da galeria ou de upload próprio).
export interface AlbumAsset {
  id: string;
  source: AlbumAssetSource;
  preview_url: string | null;
  thumb_url: string | null;
  original_name: string | null;
  sort_order: number;
}

// Conteúdo de um slot de layout: qual foto ocupa e ajustes de enquadramento.
export interface SlotFill {
  asset_id: string | null;
  zoom?: number;
  offset_x?: number;
  offset_y?: number;
}

// Tipo de página: capa (1 pág.), lâmina interna (2 págs.) ou contracapa (1 pág.).
export type SpreadKind = "cover" | "spread" | "backcover";

// Uma página/lâmina. No editor LIVRE o conteúdo real fica em canvas_json
// (objeto serializado do fabric). slots/template_id ficam por compatibilidade
// com o backend e o editor antigo de slots.
export interface AlbumSpread {
  id: string;
  position: number;
  kind?: SpreadKind;
  template_id: string;
  slots: SlotFill[];
  // Cena do fabric.js daquela página (canvas.toJSON). null = página em branco.
  canvas_json?: Record<string, unknown> | null;
}

// Projeto de álbum completo (linha de album_projects).
export interface Album {
  id: string;
  user_id?: string;
  job_id?: number | null;
  gallery_id?: string | null;
  client_id?: number | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  title: string;
  size: string;
  status: AlbumStatus;
  share_token?: string;
  allow_client_edit: boolean;
  require_login?: boolean;
  created_at?: string;
  updated_at?: string;
  // Presente apenas na visão pública (cliente).
  studio_name?: string;
}

// Comentário/pedido de ajuste do cliente numa lâmina (ou geral).
export interface AlbumComment {
  id: string;
  author_name: string | null;
  spread_position: number | null;
  body: string;
  resolved: boolean;
  created_at: string;
  access_user_id?: string | null;
}

// Resposta de GET /api/albums/:id (e da rota pública).
export interface AlbumDetail {
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
}

// Item da listagem GET /api/albums.
export interface AlbumListItem {
  id: string;
  title: string;
  client_name: string | null;
  status: AlbumStatus;
  size: string;
  spread_count: number;
  asset_count: number;
  cover_thumb_url: string | null;
  created_at: string;
}

// Resposta de POST /api/albums/:id/send e da aprovação pública.
export interface AlbumSendChannel {
  sent: boolean;
  error?: string;
}

export interface AlbumSendResult {
  ok: boolean;
  link: string;
  email: AlbumSendChannel;
  whatsapp: AlbumSendChannel;
}

// Resposta de GET /api/albums/:id/export (a "lista": foto em cada lâmina).
export interface AlbumExportPage {
  spread: number;
  template: string;
  photos: string[];
}

export interface AlbumExport {
  album_title: string;
  pages: AlbumExportPage[];
}
