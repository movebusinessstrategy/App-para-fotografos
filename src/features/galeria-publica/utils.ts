import type React from "react";
import type { GaleriaPublica, MapaSelecoes, ProtecaoGaleria, TotaisSelecao } from "./types";

export function formatarBRL(valor: number): string {
  return (valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

// Normaliza gallery.protection (flag/string/objeto) em algo que a UI entende.
export function lerProtecao(p: ProtecaoGaleria | undefined): { bloquear: boolean; aviso: boolean } {
  if (p == null || p === false) return { bloquear: false, aviso: false };
  if (p === true) return { bloquear: true, aviso: false };
  if (typeof p === "string") {
    const desligada = p === "off" || p === "none";
    return { bloquear: !desligada, aviso: p === "notice" };
  }
  return { bloquear: p.enabled !== false, aviso: Boolean(p.notice ?? p.show_notice) };
}

const prevenir = (e: React.SyntheticEvent) => e.preventDefault();

// Props aplicadas nas <img> quando a proteção está ligada.
export const propsImagemProtegida = {
  draggable: false,
  onContextMenu: prevenir,
  onDragStart: prevenir,
} as const;

export const estiloImagemProtegida: React.CSSProperties = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

// Espelha o computeGalleryDiscount do backend — pra prévia bater com a cobrança.
// Conta de gatilho do progressivo = nº de fotos escolhidas (carrinho).
// O cupom é validado no servidor (/totals); na prévia local ele não desconta.
// buy_n_get_m usa preço unitário uniforme (= preço por extra) como aproximação;
// o valor exato (abatendo as fotos mais baratas) vem do servidor na finalização.
function calcularDesconto(ctx: {
  subtotal: number;
  selecionadas: number;
  billableCount: number;
  precoUnit: number;
  galeria?: GaleriaPublica;
}): { desconto: number; pct: number } {
  const { subtotal, selecionadas, billableCount, precoUnit, galeria } = ctx;
  const mode = galeria?.discount_mode || "flat";
  if (mode === "none" || mode === "coupon" || subtotal <= 0) return { desconto: 0, pct: 0 };

  if (mode === "single_pct") {
    const pct = Math.min(100, Math.max(0, galeria?.discount_single_pct || 0));
    return { desconto: (subtotal * pct) / 100, pct };
  }
  if (mode === "progressive") {
    const regras = [...(galeria?.discount_rules || [])]
      .filter((r) => (r?.percent || 0) > 0 && (r?.min_photos || 0) >= 1)
      .sort((a, b) => a.min_photos - b.min_photos);
    let pct = 0;
    for (const r of regras) if (selecionadas >= r.min_photos) pct = r.percent;
    return { desconto: (subtotal * pct) / 100, pct };
  }
  if (mode === "progressive_value") {
    const regras = [...(galeria?.discount_value_rules || [])]
      .filter((r) => (r?.percent || 0) > 0 && (r?.min_value || 0) > 0)
      .sort((a, b) => a.min_value - b.min_value);
    let pct = 0;
    for (const r of regras) if (subtotal >= r.min_value) pct = r.percent;
    return { desconto: (subtotal * pct) / 100, pct };
  }
  if (mode === "deadline") {
    const pct = Math.min(100, Math.max(0, galeria?.deadline_discount_pct || 0));
    if (pct <= 0) return { desconto: 0, pct: 0 };
    const until = galeria?.deadline_discount_until;
    if (until) {
      const limite = new Date(`${until}T23:59:59`);
      if (isNaN(limite.getTime()) || new Date() > limite) return { desconto: 0, pct: 0 };
    }
    return { desconto: (subtotal * pct) / 100, pct };
  }
  if (mode === "buy_n_get_m") {
    const group = Math.max(0, Math.floor(galeria?.buy_n_group || 0));
    const free = Math.max(0, Math.floor(galeria?.buy_n_free || 0));
    if (group <= 0 || free <= 0 || billableCount <= 0) return { desconto: 0, pct: 0 };
    const freeCount = Math.min(Math.floor(selecionadas / group) * free, billableCount);
    if (freeCount <= 0) return { desconto: 0, pct: 0 };
    const desconto = freeCount * (precoUnit || 0);
    const pct = subtotal > 0 ? Math.round((desconto / subtotal) * 100) : 0;
    return { desconto, pct };
  }
  // flat — abatimento fixo em reais.
  return { desconto: Math.max(0, galeria?.cart_discount || 0), pct: 0 };
}

// Subtotal a cobrar antes do desconto, espelhando o galleryTotals do backend
// pros modos hoje alcançáveis na galeria pública:
//   no_charge      → 0 (cliente só seleciona)
//   sell_all       → toda foto escolhida é cobrada (preço padrão = extra_price)
//   extra_avulso   → só os extras além das incluídas
//   upgrade_packs  → cai no cálculo de extras (a finalização não passa pack)
function calcularSubtotal(
  modo: GaleriaPublica["pricing_mode"],
  selecionadas: number,
  extras: number,
  precoExtra: number
): number {
  if (modo === "no_charge") return 0;
  if (modo === "sell_all") return selecionadas * (precoExtra || 0);
  return extras * (precoExtra || 0);
}

export function calcularTotais(
  selecoes: MapaSelecoes,
  incluidas: number,
  precoExtra: number,
  galeria?: GaleriaPublica
): TotaisSelecao {
  const selecionadas = Object.values(selecoes).filter((s) => s.selected).length;
  const extras = Math.max(0, selecionadas - (incluidas || 0));
  const subtotal = calcularSubtotal(galeria?.pricing_mode, selecionadas, extras, precoExtra);
  // Fotos cobráveis (pro leve-N-pague-M): sell_all = todas; senão = extras.
  const billableCount = galeria?.pricing_mode === "sell_all" ? selecionadas : extras;
  const { desconto: descontoBruto, pct } = calcularDesconto({
    subtotal, selecionadas, billableCount, precoUnit: precoExtra || 0, galeria,
  });
  // Nunca abate mais que o subtotal (espelha o backend).
  const desconto = Math.min(Math.max(0, descontoBruto), subtotal);
  const valor = Math.max(0, subtotal - desconto);
  return { selecionadas, incluidas: incluidas || 0, extras, subtotal, desconto, descontoPct: pct, valor, cupomAplicado: null };
}

// Converte a resposta crua do servidor (/totals, /finalize — snake_case) em
// TotaisSelecao. Usado quando o cliente aplica um cupom (cálculo autoritativo).
export function totaisDoServidor(raw: any, incluidas: number): TotaisSelecao {
  const subtotal = Number(raw?.subtotal || 0);
  const desconto = Number(raw?.discount || 0);
  return {
    selecionadas: Number(raw?.selected_count || 0),
    incluidas: incluidas || 0,
    extras: Number(raw?.extra_count || 0),
    subtotal,
    desconto,
    descontoPct: Number(raw?.discount_pct || 0),
    valor: Number(raw?.amount ?? Math.max(0, subtotal - desconto)),
    cupomAplicado: raw?.coupon_applied ?? null,
  };
}
