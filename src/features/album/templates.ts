// Medidas e modelos do álbum.
// Trabalhamos em CM REAIS. A lâmina (spread) = 2 páginas abertas.
// O editor usa um canvas em px com a MESMA proporção da medida real, e a
// exportação escala pra 300 DPI exatos (px = cm / 2,54 * 300) — pronto pra
// gráfica, com sangria opcional.
import type React from "react";

// ── Tamanhos de álbum (medida da página FECHADA, em cm) ─────────────────────
export interface AlbumSize {
  id: string;
  label: string;
  pageCm: { w: number; h: number }; // página fechada (1 lado)
  ratio: number;                    // largura/altura da página (compat)
}

// Medidas reais comuns de laboratório fotográfico no Brasil.
export const ALBUM_SIZES: AlbumSize[] = [
  { id: "sq15", label: "Quadrado 15×15", pageCm: { w: 15, h: 15 }, ratio: 1 },
  { id: "sq20", label: "Quadrado 20×20", pageCm: { w: 20, h: 20 }, ratio: 1 },
  { id: "sq25", label: "Quadrado 25×25", pageCm: { w: 25, h: 25 }, ratio: 1 },
  { id: "sq30", label: "Quadrado 30×30", pageCm: { w: 30, h: 30 }, ratio: 1 },
  { id: "port20x30", label: "Retrato 20×30", pageCm: { w: 20, h: 30 }, ratio: 0.667 },
  { id: "port30x40", label: "Retrato 30×40", pageCm: { w: 30, h: 40 }, ratio: 0.75 },
  { id: "land30x20", label: "Paisagem 30×20", pageCm: { w: 30, h: 20 }, ratio: 1.5 },
  // compat com álbuns antigos já criados:
  { id: "land40x30", label: "Paisagem 40×30", pageCm: { w: 40, h: 30 }, ratio: 1.333 },
];

const SIZE_INDEX: Record<string, AlbumSize> = Object.fromEntries(
  ALBUM_SIZES.map((s) => [s.id, s]),
);

export type SpreadKind = "cover" | "spread" | "backcover";

// Sangria padrão pra gráfica (cm de cada lado). Lab típico pede 0,5 cm.
export const BLEED_CM = 0.5;
export const PRINT_DPI = 300;
// Maior lado do canvas do EDITOR em px (proporção sempre exata à medida real).
const EDITOR_LONG = 1400;

// Medida REAL (cm) da página aberta: capa/contracapa = 1 página; lâmina = 2.
export function spreadCm(size: string, kind: SpreadKind = "spread"): { w: number; h: number } {
  const s = SIZE_INDEX[size] || ALBUM_SIZES[1];
  const w = kind === "spread" ? s.pageCm.w * 2 : s.pageCm.w;
  return { w, h: s.pageCm.h };
}

// Dimensão do canvas do EDITOR (px), proporção EXATA da medida real.
export function canvasDims(size: string, kind: SpreadKind = "spread"): { w: number; h: number } {
  const cm = spreadCm(size, kind);
  const k = EDITOR_LONG / Math.max(cm.w, cm.h);
  return { w: Math.round(cm.w * k), h: Math.round(cm.h * k) };
}

// Dimensão de IMPRESSÃO (px a 300 DPI) + em mm — com ou sem sangria.
export function printDims(
  size: string,
  kind: SpreadKind = "spread",
  opts: { dpi?: number; bleedCm?: number } = {},
): { w: number; h: number; wmm: number; hmm: number } {
  const dpi = opts.dpi ?? PRINT_DPI;
  const bleed = opts.bleedCm ?? 0;
  const cm = spreadCm(size, kind);
  const totalW = cm.w + bleed * 2;
  const totalH = cm.h + bleed * 2;
  const f = dpi / 2.54;
  return {
    w: Math.round(totalW * f),
    h: Math.round(totalH * f),
    wmm: Math.round(totalW * 10),
    hmm: Math.round(totalH * 10),
  };
}

// Rótulo da medida pra mostrar na UI ("40 × 20 cm").
export function spreadCmLabel(size: string, kind: SpreadKind = "spread"): string {
  const cm = spreadCm(size, kind);
  return `${cm.w} × ${cm.h} cm`;
}

// ── Modelos de diagramação (caixas de foto em coords NORMALIZADAS 0..1) ──────
export interface FreeSlot { x: number; y: number; w: number; h: number }
export interface FreeTemplate { id: string; name: string; slots: FreeSlot[] }

// Gera uma grade cols×rows com margem uniforme — SEMPRE preenche a lâmina
// inteira corretamente (sem sobra/sobreposição). Base de quase todos os modelos.
function grid(cols: number, rows: number, m = 0.025): FreeSlot[] {
  const cw = (1 - m * (cols + 1)) / cols;
  const ch = (1 - m * (rows + 1)) / rows;
  const slots: FreeSlot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: m + c * (cw + m), y: m + r * (ch + m), w: cw, h: ch });
    }
  }
  return slots;
}

// 1 caixa grande + N pequenas empilhadas ao lado.
function destaque(bigLeft: boolean, smalls: number, m = 0.025): FreeSlot[] {
  const bigW = 0.62 - m * 1.5;
  const colW = 0.38 - m * 1.5;
  const bigX = bigLeft ? m : 1 - m - bigW;
  const colX = bigLeft ? 1 - m - colW : m;
  const slots: FreeSlot[] = [{ x: bigX, y: m, w: bigW, h: 1 - m * 2 }];
  const ch = (1 - m * (smalls + 1)) / smalls;
  for (let i = 0; i < smalls; i++) {
    slots.push({ x: colX, y: m + i * (ch + m), w: colW, h: ch });
  }
  return slots;
}

export const FREE_TEMPLATES: FreeTemplate[] = [
  { id: "cheia", name: "Foto cheia", slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { id: "respiro", name: "Respiro", slots: [{ x: 0.07, y: 0.09, w: 0.86, h: 0.82 }] },
  { id: "faixa-central", name: "Faixa central", slots: [{ x: 0, y: 0.2, w: 1, h: 0.6 }] },
  { id: "dupla", name: "Dupla", slots: grid(2, 1) },
  { id: "dupla-v", name: "Dupla deitada", slots: grid(1, 2) },
  { id: "tripla", name: "Tripla", slots: grid(3, 1) },
  { id: "mosaico", name: "Mosaico 2×2", slots: grid(2, 2) },
  { id: "grade-6", name: "Grade 3×2", slots: grid(3, 2) },
  { id: "tira-4", name: "Tira de 4", slots: grid(4, 1) },
  { id: "trio-esq", name: "Destaque esquerda", slots: destaque(true, 2) },
  { id: "trio-dir", name: "Destaque direita", slots: destaque(false, 2) },
  { id: "trio-baixo", name: "1 + 3 embaixo", slots: [
    { x: 0.025, y: 0.025, w: 0.95, h: 0.6 },
    ...grid(3, 1).map((s) => ({ ...s, y: 0.66, h: 0.31 })),
  ] },
  { id: "duas-altas", name: "Duas altas", slots: [
    { x: 0.14, y: 0.06, w: 0.34, h: 0.88 },
    { x: 0.52, y: 0.06, w: 0.34, h: 0.88 },
  ] },
];

const FREE_TEMPLATE_INDEX: Record<string, FreeTemplate> = Object.fromEntries(
  FREE_TEMPLATES.map((t) => [t.id, t]),
);

export function freeTemplateById(id: string): FreeTemplate | undefined {
  return FREE_TEMPLATE_INDEX[id];
}

// ── Legado (editor de slots antigo — mantido só pra não quebrar imports) ─────
export interface PageLayout { cols: string; rows: string; areas?: string; slots: number }
export interface AlbumTemplate { id: string; name: string; left: PageLayout; right: PageLayout; pano?: boolean }
export const ALBUM_TEMPLATES: AlbumTemplate[] = [];
export function templateById(_id: string): AlbumTemplate | undefined { return undefined; }
export function slotCount(_id: string): number { return 0; }
export function gridStyle(layout: PageLayout): React.CSSProperties {
  return { display: "grid", gridTemplateColumns: layout.cols, gridTemplateRows: layout.rows };
}
export function slotAreas(layout: PageLayout): string[] {
  return Array.from({ length: layout.slots }, (_, i) => "abcdefghijklmnop"[i]);
}
