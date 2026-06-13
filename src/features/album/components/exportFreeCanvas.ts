// Exportação do álbum pronta pra GRÁFICA.
// Cada lâmina é uma cena fabric (canvas_json). Reidrata num StaticCanvas
// offscreen e exporta em 300 DPI EXATOS (px = cm/2,54*300), com sangria
// opcional. Gera PDF (mm exatos) e/ou JPGs por lâmina.
import { StaticCanvas } from "fabric";
import jsPDF from "jspdf";
import { canvasDims, printDims, spreadCm, BLEED_CM, type SpreadKind } from "../templates";
import type { AlbumSpread } from "../types";

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").toLowerCase() || "album";

const kindOf = (s: AlbumSpread): SpreadKind =>
  s.kind === "cover" || s.kind === "backcover" ? s.kind : "spread";

// Renderiza uma lâmina em JPEG na resolução de impressão (300 DPI).
// bleedCm > 0 estende o fundo pra sangria (a arte é centralizada).
async function renderSpreadJpeg(
  spread: AlbumSpread,
  size: string,
  bleedCm: number,
): Promise<string> {
  const kind = kindOf(spread);
  const editor = canvasDims(size, kind);          // proporção do editor
  const print = printDims(size, kind, { bleedCm: 0 }); // px finais (sem sangria)
  const multiplier = print.w / editor.w;          // editor → 300 DPI exato

  const c = new StaticCanvas(undefined, {
    width: editor.w,
    height: editor.h,
    backgroundColor: "#ffffff",
    renderOnAddRemove: false,
  });
  try {
    if (spread.canvas_json && typeof spread.canvas_json === "object") {
      await c.loadFromJSON(spread.canvas_json);
    }
    c.renderAll();
    const artUrl = c.toDataURL({ format: "jpeg", quality: 0.95, multiplier });
    if (bleedCm <= 0) return artUrl;

    // Sangria: desenha a arte centralizada num canvas maior (fundo branco).
    const full = printDims(size, kind, { bleedCm });
    const off = document.createElement("canvas");
    off.width = full.w;
    off.height = full.h;
    const ctx = off.getContext("2d");
    if (!ctx) return artUrl;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, full.w, full.h);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("img"));
      img.src = artUrl;
    });
    const bleedPx = Math.round((full.w - print.w) / 2);
    ctx.drawImage(img, bleedPx, bleedPx, print.w, print.h);
    return off.toDataURL("image/jpeg", 0.95);
  } finally {
    c.dispose();
  }
}

// Gera o PDF do álbum (cada lâmina = 1 página em mm exatos, 300 DPI).
export async function exportAlbumPdf(
  title: string,
  spreads: AlbumSpread[],
  size: string,
  opts: { bleed?: boolean } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const bleedCm = opts.bleed ? BLEED_CM : 0;
  let doc: jsPDF | null = null;
  for (let i = 0; i < spreads.length; i++) {
    const kind = kindOf(spreads[i]);
    const dim = printDims(size, kind, { bleedCm });
    const orientation = dim.wmm >= dim.hmm ? "landscape" : "portrait";
    if (!doc) {
      doc = new jsPDF({ orientation, unit: "mm", format: [dim.wmm, dim.hmm] });
    } else {
      doc.addPage([dim.wmm, dim.hmm], orientation);
    }
    const jpeg = await renderSpreadJpeg(spreads[i], size, bleedCm);
    doc.addImage(jpeg, "JPEG", 0, 0, dim.wmm, dim.hmm, undefined, "FAST");
    onProgress?.(i + 1, spreads.length);
  }
  if (doc) doc.save(`${slug(title)}-album-300dpi${bleedCm ? "-sangria" : ""}.pdf`);
}

// Gera e baixa um JPG por lâmina (300 DPI). onProgress(done, total).
export async function exportFreeSpreadsAsJpg(
  title: string,
  spreads: AlbumSpread[],
  size: string,
  opts: { bleed?: boolean } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const base = slug(title);
  const bleedCm = opts.bleed ? BLEED_CM : 0;
  for (let i = 0; i < spreads.length; i++) {
    const url = await renderSpreadJpeg(spreads[i], size, bleedCm);
    triggerDownload(url, `${base}-lamina-${String(i + 1).padStart(2, "0")}.jpg`);
    onProgress?.(i + 1, spreads.length);
  }
}

// Resumo das medidas pra UI / conferência.
export function medidasResumo(size: string): string {
  const pageCm = spreadCm(size, "cover");
  const spreadDim = spreadCm(size, "spread");
  const print = printDims(size, "spread", { bleedCm: BLEED_CM });
  return `Página ${pageCm.w}×${pageCm.h} cm · lâmina aberta ${spreadDim.w}×${spreadDim.h} cm · ${print.w}×${print.h}px (300 DPI c/ sangria ${BLEED_CM}cm)`;
}
