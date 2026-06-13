// Templates de layout das lâminas (spreads) do álbum.
// Cada lâmina = 2 páginas (left/right). Cada página tem um PageLayout em CSS grid.
// Renderização trivial nos editores via gridStyle()/slotAreas().
import type React from "react";

export interface PageLayout {
  cols: string;
  rows: string;
  areas?: string;
  slots: number;
}

export interface AlbumTemplate {
  id: string;
  name: string;
  left: PageLayout;
  right: PageLayout;
  pano?: boolean; // foto panorâmica atravessando as duas páginas
}

// Tamanhos de álbum (ratio = largura/altura de UMA página).
export interface AlbumSize {
  id: string;
  label: string;
  ratio: number;
}

export const ALBUM_SIZES: AlbumSize[] = [
  { id: "sq30", label: "Quadrado 30x30", ratio: 1 },
  { id: "sq20", label: "Quadrado 20x20", ratio: 1 },
  { id: "land40x30", label: "Paisagem 40x30", ratio: 1.333 },
  { id: "port20x30", label: "Retrato 20x30", ratio: 0.667 },
];

// --- Blocos de página reutilizáveis -----------------------------------------

// 1 foto ocupando a página inteira.
const full: PageLayout = {
  cols: "1fr",
  rows: "1fr",
  areas: '"a"',
  slots: 1,
};

// 1 foto com respiro (margem branca ao redor).
const inset: PageLayout = {
  cols: "1fr 6fr 1fr",
  rows: "1fr 6fr 1fr",
  areas: '". . ." ". a ." ". . ."',
  slots: 1,
};

// 2 fotos lado a lado (divisão horizontal).
const duoH: PageLayout = {
  cols: "1fr 1fr",
  rows: "1fr",
  areas: '"a b"',
  slots: 2,
};

// 2 fotos empilhadas (divisão vertical).
const duoV: PageLayout = {
  cols: "1fr",
  rows: "1fr 1fr",
  areas: '"a" "b"',
  slots: 2,
};

// 3 fotos: uma grande à esquerda + duas empilhadas à direita.
const trio: PageLayout = {
  cols: "2fr 1fr",
  rows: "1fr 1fr",
  areas: '"a b" "a c"',
  slots: 3,
};

// 4 fotos em grade 2x2.
const quad: PageLayout = {
  cols: "1fr 1fr",
  rows: "1fr 1fr",
  areas: '"a b" "c d"',
  slots: 4,
};

// 3 fotos horizontais empilhadas (tira de filme).
const tira3: PageLayout = {
  cols: "1fr",
  rows: "1fr 1fr 1fr",
  areas: '"a" "b" "c"',
  slots: 3,
};

// --- Os 8 templates ---------------------------------------------------------

export const ALBUM_TEMPLATES: AlbumTemplate[] = [
  { id: "classico", name: "Clássico", left: full, right: full },
  { id: "painel", name: "Painel", left: full, right: full, pano: true },
  { id: "dupla", name: "Dupla", left: duoH, right: full },
  { id: "trio", name: "Trio", left: trio, right: full },
  { id: "mosaico", name: "Mosaico", left: quad, right: duoV },
  { id: "respiro", name: "Respiro", left: inset, right: inset },
  { id: "tira", name: "Tira", left: tira3, right: full },
  { id: "capa", name: "Capa", left: full, right: full },
];

// --- Helpers ----------------------------------------------------------------

const TEMPLATE_INDEX: Record<string, AlbumTemplate> = Object.fromEntries(
  ALBUM_TEMPLATES.map((t) => [t.id, t]),
);

export function templateById(id: string): AlbumTemplate | undefined {
  return TEMPLATE_INDEX[id];
}

// Total de fotos de uma lâmina (left + right). 0 se o template não existe.
export function slotCount(id: string): number {
  const t = TEMPLATE_INDEX[id];
  if (!t) return 0;
  return t.left.slots + t.right.slots;
}

// Estilo CSS-in-JS pronto para o container grid de uma página.
export function gridStyle(layout: PageLayout): React.CSSProperties {
  const style: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: layout.cols,
    gridTemplateRows: layout.rows,
  };
  if (layout.areas) style.gridTemplateAreas = layout.areas;
  return style;
}

// Letras de grid-area usadas pelos slots: a, b, c, ... (na ordem dos slots).
const SLOT_LETTERS = "abcdefghijklmnop";

// Lista das grid-areas de cada slot da página (para posicionar cada foto).
// Ex.: trio -> ['a','b','c']; quad -> ['a','b','c','d'].
export function slotAreas(layout: PageLayout): string[] {
  return Array.from({ length: layout.slots }, (_, i) => SLOT_LETTERS[i]);
}
