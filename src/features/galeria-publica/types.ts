// Tipos das rotas públicas da galeria de proofing (GET /api/public/gallery/:token).

// O backend pode mandar a proteção como flag, string ou objeto — lê defensivo.
export type ProtecaoGaleria =
  | boolean
  | string
  | { enabled?: boolean; notice?: boolean; show_notice?: boolean }
  | null;

export type ModoDesconto = "none" | "flat" | "single_pct" | "progressive";

export type ModoCobranca = "no_charge" | "extra_avulso" | "upgrade_packs" | "sell_all";

export interface RegraDesconto {
  percent: number;
  min_photos: number;
}

export interface GaleriaPublica {
  title: string;
  status: string;
  included_count: number;
  extra_price: number;
  pricing_mode?: ModoCobranca;
  discount_mode?: ModoDesconto;
  cart_discount?: number;
  discount_single_pct?: number;
  discount_rules?: RegraDesconto[];
  category?: string | null;
  studio_name?: string | null;
  protection?: ProtecaoGaleria;
}

export interface FotoPublica {
  id: string;
  file_name: string;
  thumb_url: string;
  preview_url: string;
}

export interface SelecaoFoto {
  selected: boolean;
  comment?: string | null;
}

export type MapaSelecoes = Record<string, SelecaoFoto>;

export interface RespostaGaleriaPublica {
  gallery: GaleriaPublica;
  photos: FotoPublica[];
  selections: MapaSelecoes;
}

export interface RespostaSelect {
  ok: boolean;
  selected_count: number;
  extra_count: number;
  amount: number;
}

export interface RespostaFinalize extends RespostaSelect {
  payment_url?: string | null;
  order_code?: string | null;
  // false = pagamento pendente; a seleção só fecha quando o MP confirmar.
  finalized?: boolean;
  payment_required?: boolean;
}

export interface RespostaPaymentStatus {
  status: string | null;
  // payment_url é opcional no contrato — usado se o backend devolver.
  payment_url?: string | null;
}

export interface TotaisSelecao {
  selecionadas: number;
  incluidas: number;
  extras: number;
  subtotal: number;
  desconto: number;
  descontoPct: number;
  valor: number;
}
