// Exportação JPG do editor LIVRE: cada lâmina é uma cena fabric (canvas_json).
// Reidrata num StaticCanvas offscreen em alta resolução e baixa o JPG.
import { StaticCanvas } from "fabric";
import { canvasDims } from "../templates";
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

// Renderiza uma lâmina (canvas_json) num StaticCanvas e devolve o JPG dataURL.
async function renderSpread(spread: AlbumSpread, size: string): Promise<string> {
  const dims = canvasDims(size, spread.kind);
  const c = new StaticCanvas(undefined, {
    width: dims.w,
    height: dims.h,
    backgroundColor: "#ffffff",
    renderOnAddRemove: false,
  });
  try {
    if (spread.canvas_json && typeof spread.canvas_json === "object") {
      await c.loadFromJSON(spread.canvas_json);
    }
    c.renderAll();
    return c.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 2 });
  } finally {
    c.dispose();
  }
}

// Gera e baixa um JPG por lâmina. Chama onProgress(done, total).
export async function exportFreeSpreadsAsJpg(
  title: string,
  spreads: AlbumSpread[],
  size: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const base = slug(title);
  for (let i = 0; i < spreads.length; i++) {
    const url = await renderSpread(spreads[i], size);
    triggerDownload(url, `${base}-lamina-${String(i + 1).padStart(2, "0")}.jpg`);
    onProgress?.(i + 1, spreads.length);
  }
}
