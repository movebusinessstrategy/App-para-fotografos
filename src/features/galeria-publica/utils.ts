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
function calcularDesconto(
  subtotal: number,
  selecionadas: number,
  galeria?: Pick<GaleriaPublica, "discount_mode" | "cart_discount" | "discount_single_pct" | "discount_rules">
): { desconto: number; pct: number } {
  const mode = galeria?.discount_mode || "flat";
  if (mode === "none" || subtotal <= 0) return { desconto: 0, pct: 0 };
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
  galeria?: Pick<GaleriaPublica, "pricing_mode" | "discount_mode" | "cart_discount" | "discount_single_pct" | "discount_rules">
): TotaisSelecao {
  const selecionadas = Object.values(selecoes).filter((s) => s.selected).length;
  const extras = Math.max(0, selecionadas - (incluidas || 0));
  const subtotal = calcularSubtotal(galeria?.pricing_mode, selecionadas, extras, precoExtra);
  const { desconto: descontoBruto, pct } = calcularDesconto(subtotal, selecionadas, galeria);
  // Nunca abate mais que o subtotal (espelha o backend).
  const desconto = Math.min(Math.max(0, descontoBruto), subtotal);
  const valor = Math.max(0, subtotal - desconto);
  return { selecionadas, incluidas: incluidas || 0, extras, subtotal, desconto, descontoPct: pct, valor };
}
