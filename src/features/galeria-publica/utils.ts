import type React from "react";
import type { MapaSelecoes, ProtecaoGaleria, TotaisSelecao } from "./types";

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

export function calcularTotais(
  selecoes: MapaSelecoes,
  incluidas: number,
  precoExtra: number
): TotaisSelecao {
  const selecionadas = Object.values(selecoes).filter((s) => s.selected).length;
  const extras = Math.max(0, selecionadas - (incluidas || 0));
  return { selecionadas, incluidas: incluidas || 0, extras, valor: extras * (precoExtra || 0) };
}
