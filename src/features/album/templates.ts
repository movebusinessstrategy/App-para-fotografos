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

// Aceita medida arbitrária "LxA" em cm (ex.: "30x30", "29.7x29,7", "20x25"),
// pra cada linha de gráfica ter o tamanho EXATO dela — não só os 8 presets.
export function parsePageCm(size: string | undefined): { w: number; h: number } | null {
  if (!size) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*$/i.exec(size);
  if (!m) return null;
  const w = parseFloat(m[1].replace(",", "."));
  const h = parseFloat(m[2].replace(",", "."));
  if (!(w > 0 && h > 0) || w > 200 || h > 200) return null;
  return { w, h };
}

// Página fechada (cm) de um size (id de preset OU "LxA").
function pageCmDe(size: string): { w: number; h: number } {
  const preset = SIZE_INDEX[size];
  if (preset) return preset.pageCm;
  return parsePageCm(size) || ALBUM_SIZES[1].pageCm;
}

// Rótulo amigável: usa o label do preset, ou "L × A cm" pra medida custom.
export function sizeLabel(size: string): string {
  const preset = SIZE_INDEX[size];
  if (preset) return preset.label;
  const cm = parsePageCm(size);
  return cm ? `${cm.w} × ${cm.h} cm` : size;
}

export type SpreadKind = "cover" | "spread" | "backcover";

// Sangria padrão pra gráfica (cm de cada lado). Lab típico pede 0,5 cm.
export const BLEED_CM = 0.5;
export const PRINT_DPI = 300;
// Maior lado do canvas do EDITOR em px (proporção sempre exata à medida real).
const EDITOR_LONG = 1400;

// Medida REAL (cm) da página aberta: capa/contracapa = 1 página; lâmina = 2.
export function spreadCm(size: string, kind: SpreadKind = "spread"): { w: number; h: number } {
  const page = pageCmDe(size);
  const w = kind === "spread" ? page.w * 2 : page.w;
  return { w, h: page.h };
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
// O molde é FIXO: as caixas nunca saem da lâmina. Só a FOTO se mexe (dentro
// da caixa, com recorte). Geramos por "bandas" pra sempre preencher certo.
export interface FreeSlot { x: number; y: number; w: number; h: number }
export interface FreeTemplate { id: string; name: string; slots: FreeSlot[] }

const MG = 0.02; // margem padrão entre caixas / borda

// Divide a lâmina em bandas horizontais; cada banda em N colunas iguais.
// bands([2]) = 2 lado a lado; bands([1,2]) = 1 em cima + 2 embaixo; etc.
// SEMPRE cabe em [0,1] (sem estourar a lâmina).
function bands(perRow: number[], m = MG): FreeSlot[] {
  const R = perRow.length;
  const ch = (1 - m * (R + 1)) / R;
  const slots: FreeSlot[] = [];
  perRow.forEach((cols, r) => {
    const y = m + r * (ch + m);
    const cw = (1 - m * (cols + 1)) / cols;
    for (let c = 0; c < cols; c++) slots.push({ x: m + c * (cw + m), y, w: cw, h: ch });
  });
  return slots;
}

// 1 caixa grande de um lado + N pequenas empilhadas do outro.
function destaque(bigLeft: boolean, smalls: number, bigFrac = 0.62, m = MG): FreeSlot[] {
  const bigW = bigFrac - m * 1.5;
  const colW = 1 - bigFrac - m * 1.5;
  const bigX = bigLeft ? m : 1 - m - bigW;
  const colX = bigLeft ? 1 - m - colW : m;
  const slots: FreeSlot[] = [{ x: bigX, y: m, w: bigW, h: 1 - m * 2 }];
  const ch = (1 - m * (smalls + 1)) / smalls;
  for (let i = 0; i < smalls; i++) slots.push({ x: colX, y: m + i * (ch + m), w: colW, h: ch });
  return slots;
}

// 1 faixa grande em cima/baixo + uma grade do outro lado.
function faixaMaisGrade(topBig: boolean, cols: number, bigFrac = 0.6, m = MG): FreeSlot[] {
  const bigH = bigFrac - m * 1.5;
  const smallH = 1 - bigFrac - m * 1.5;
  const cw = (1 - m * (cols + 1)) / cols;
  const bigY = topBig ? m : 1 - m - bigH;
  const rowY = topBig ? 1 - m - smallH : m;
  const slots: FreeSlot[] = [{ x: m, y: bigY, w: 1 - m * 2, h: bigH }];
  for (let c = 0; c < cols; c++) slots.push({ x: m + c * (cw + m), y: rowY, w: cw, h: smallH });
  return slots;
}

// Caixas centralizadas (com respiro) — visual mais clean.
function centradas(n: number, frac = 0.78, m = MG): FreeSlot[] {
  const totalW = frac;
  const x0 = (1 - totalW) / 2;
  const cw = (totalW - m * (n - 1)) / n;
  const h = frac;
  const y = (1 - h) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + m), y, w: cw, h }));
}

export const FREE_TEMPLATES: FreeTemplate[] = [
  // 1 foto
  { id: "cheia", name: "Foto cheia", slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  { id: "respiro", name: "Respiro", slots: [{ x: 0.07, y: 0.09, w: 0.86, h: 0.82 }] },
  { id: "faixa-central", name: "Faixa central", slots: [{ x: 0, y: 0.22, w: 1, h: 0.56 }] },
  { id: "quadro-central", name: "Quadro central", slots: centradas(1, 0.7) },
  // 2 fotos
  { id: "dupla", name: "Dupla", slots: bands([2]) },
  { id: "dupla-v", name: "Dupla deitada", slots: bands([1, 1]) },
  { id: "duas-altas", name: "Duas altas", slots: centradas(2, 0.78) },
  { id: "dupla-70-30", name: "Dupla 70/30", slots: destaque(true, 1, 0.68) },
  { id: "dupla-30-70", name: "Dupla 30/70", slots: destaque(false, 1, 0.68) },
  // 3 fotos
  { id: "tripla", name: "Tripla", slots: bands([3]) },
  { id: "tripla-v", name: "Tripla deitada", slots: bands([1, 1, 1]) },
  { id: "destaque-esq", name: "Destaque esquerda", slots: destaque(true, 2) },
  { id: "destaque-dir", name: "Destaque direita", slots: destaque(false, 2) },
  { id: "um-mais-dois", name: "1 cima + 2", slots: bands([1, 2]) },
  { id: "dois-mais-um", name: "2 + 1 baixo", slots: bands([2, 1]) },
  { id: "tres-centradas", name: "3 centradas", slots: centradas(3, 0.86) },
  // 4 fotos
  { id: "mosaico", name: "Mosaico 2×2", slots: bands([2, 2]) },
  { id: "tira-4", name: "Tira de 4", slots: bands([4]) },
  { id: "quatro-v", name: "4 deitadas", slots: bands([1, 1, 1, 1]) },
  { id: "destaque-4", name: "Destaque + 3", slots: faixaMaisGrade(false, 3, 0.62) },
  { id: "topo-3", name: "Faixa + 3", slots: faixaMaisGrade(true, 3, 0.6) },
  { id: "um-mais-tres", name: "1 + 3", slots: destaque(true, 3) },
  // 5 fotos
  { id: "tira-5", name: "Tira de 5", slots: bands([5]) },
  { id: "destaque-5", name: "Destaque + 4", slots: destaque(true, 4) },
  { id: "dois-mais-tres", name: "2 + 3", slots: bands([2, 3]) },
  { id: "tres-mais-dois", name: "3 + 2", slots: bands([3, 2]) },
  // 6 fotos
  { id: "grade-6", name: "Grade 3×2", slots: bands([3, 3]) },
  { id: "grade-6v", name: "Grade 2×3", slots: bands([2, 2, 2]) },
  { id: "faixa-mais-5", name: "Faixa + 5", slots: faixaMaisGrade(true, 5, 0.58) },
  // 7-9 fotos
  { id: "tira-6", name: "Tira de 6", slots: bands([6]) },
  { id: "grade-8", name: "Grade 4×2", slots: bands([4, 4]) },
  { id: "grade-9", name: "Grade 3×3", slots: bands([3, 3, 3]) },
  { id: "grade-12", name: "Grade 4×3", slots: bands([4, 4, 4]) },
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
