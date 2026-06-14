import type React from "react";
import { ALBUM_SIZES, parsePageCm } from "../album/templates";

export const ROSA = "#D4537E";

// Razão largura/altura de UMA página do álbum (default quadrado). Aceita preset
// (id) ou medida custom "LxA".
export function ratioDoTamanho(size: string | undefined): number {
  const found = ALBUM_SIZES.find((s) => s.id === size);
  if (found) return found.ratio || 1;
  const cm = parsePageCm(size);
  return cm ? cm.w / cm.h : 1;
}

const prevenir = (e: React.SyntheticEvent) => e.preventDefault();

// Proteção visual básica: sem arrastar pro desktop, sem menu de contexto.
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
