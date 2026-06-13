// Exportação no navegador: desenha cada lâmina num <canvas> e baixa JPG.
// Não gera PDF de gráfica — é só prévia visual de aprovação.
import { templateById, slotAreas } from "../templates";
import type { PageLayout } from "../templates";
import { ratioOfSize } from "./SpreadView";
import type { AlbumAsset, AlbumSpread } from "../types";

interface Rect { x: number; y: number; w: number; h: number }

// Converte "1fr 2fr 1fr" em frações somando 1.
function parseFr(track: string): number[] {
  const parts = track.trim().split(/\s+/).map((t) => parseFloat(t.replace("fr", "")) || 1);
  const total = parts.reduce((a, b) => a + b, 0) || 1;
  return parts.map((p) => p / total);
}

// Mapeia cada letra de área (a,b,c…) para um retângulo dentro da página,
// resolvendo o grid-template-areas em colunas/linhas proporcionais.
function areaRects(layout: PageLayout, page: Rect, gap: number): Record<string, Rect> {
  const colFr = parseFr(layout.cols);
  const rowFr = parseFr(layout.rows);
  // areas vem como '"a b" "a c"' → cada par de aspas é uma linha do grid.
  const rows = (layout.areas || '"a"').match(/"([^"]*)"/g)?.map((r) => r.replace(/"/g, "").trim().split(/\s+/)) || [["a"]];

  const colX: number[] = [];
  let acc = page.x;
  colFr.forEach((f, i) => { colX[i] = acc; acc += f * page.w + (i < colFr.length - 1 ? gap : 0); });
  const rowY: number[] = [];
  acc = page.y;
  rowFr.forEach((f, i) => { rowY[i] = acc; acc += f * page.h + (i < rowFr.length - 1 ? gap : 0); });

  const out: Record<string, { x0: number; y0: number; x1: number; y1: number }> = {};
  rows.forEach((cells, ri) => {
    cells.forEach((letter, ci) => {
      if (letter === ".") return;
      const x0 = colX[ci];
      const y0 = rowY[ri];
      const x1 = colX[ci] + colFr[ci] * page.w;
      const y1 = rowY[ri] + rowFr[ri] * page.h;
      const cur = out[letter];
      out[letter] = cur
        ? { x0: Math.min(cur.x0, x0), y0: Math.min(cur.y0, y0), x1: Math.max(cur.x1, x1), y1: Math.max(cur.y1, y1) }
        : { x0, y0, x1, y1 };
    });
  });

  const rects: Record<string, Rect> = {};
  Object.entries(out).forEach(([k, r]) => {
    rects[k] = { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
  });
  return rects;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img"));
    img.src = src;
  });
}

// Desenha a imagem preenchendo o retângulo (object-fit: cover).
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: Rect) {
  const ir = img.width / img.height;
  const rr = r.w / r.h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ir > rr) { sw = img.height * rr; sx = (img.width - sw) / 2; }
  else { sh = img.width / rr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
}

async function drawPage(
  ctx: CanvasRenderingContext2D,
  layout: PageLayout,
  baseIndex: number,
  spread: AlbumSpread,
  assetById: Map<string, AlbumAsset>,
  page: Rect,
  gap: number,
) {
  const rects = areaRects(layout, page, gap);
  const letters = slotAreas(layout);
  for (let i = 0; i < letters.length; i++) {
    const rect = rects[letters[i]];
    if (!rect) continue;
    const fill = spread.slots[baseIndex + i];
    const asset = fill?.asset_id ? assetById.get(fill.asset_id) : undefined;
    const url = asset?.preview_url || asset?.thumb_url;
    if (!url) {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      continue;
    }
    try {
      const img = await loadImage(url);
      drawCover(ctx, img, rect);
    } catch {
      ctx.fillStyle = "#d1d5db";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
}

// Renderiza UMA lâmina num canvas e devolve o dataURL JPG.
async function renderSpreadToDataURL(
  spread: AlbumSpread,
  assets: AlbumAsset[],
  size: string,
): Promise<string> {
  const t = templateById(spread.template_id) || templateById("classico")!;
  const ratio = ratioOfSize(size);
  const H = 1400;
  const W = Math.round(H * ratio * 2);
  const gap = Math.round(W * 0.006);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const assetById = new Map<string, AlbumAsset>();
  assets.forEach((a) => assetById.set(a.id, a));

  const half = (W - gap) / 2;
  const leftPage: Rect = { x: 0, y: 0, w: half, h: H };
  const rightPage: Rect = { x: half + gap, y: 0, w: half, h: H };

  await drawPage(ctx, t.left, 0, spread, assetById, leftPage, gap);
  await drawPage(ctx, t.right, t.left.slots, spread, assetById, rightPage, gap);

  return canvas.toDataURL("image/jpeg", 0.9);
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "album";

// Gera e baixa um JPG por lâmina. Chama onProgress(done, total) entre cada uma.
export async function exportSpreadsAsJpg(
  title: string,
  spreads: AlbumSpread[],
  assets: AlbumAsset[],
  size: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const base = slug(title);
  for (let i = 0; i < spreads.length; i++) {
    const url = await renderSpreadToDataURL(spreads[i], assets, size);
    triggerDownload(url, `${base}-lamina-${String(i + 1).padStart(2, "0")}.jpg`);
    onProgress?.(i + 1, spreads.length);
  }
}
