import { useEffect, useState } from "react";
import { StaticCanvas } from "fabric";
import { canvasDims, type SpreadKind } from "../../album/templates";
import type { AlbumSpread } from "../../album/types";

// Renderiza cada lâmina (canvas_json do fabric) numa imagem (dataURL) em
// resolução de tela, pra apresentação no livro 3D ficar fluida (sem um canvas
// fabric vivo por página). Resolução = dims do editor (~1400px no lado maior),
// nítida o suficiente pro preview.

const kindOf = (s: AlbumSpread): SpreadKind =>
  s.kind === "cover" || s.kind === "backcover" ? s.kind : "spread";

async function renderOne(spread: AlbumSpread, size: string): Promise<string | null> {
  const dims = canvasDims(size, kindOf(spread));
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
    return c.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 1 });
  } catch {
    return null;
  } finally {
    c.dispose();
  }
}

export interface SpreadImagesState {
  images: (string | null)[];
  ready: boolean;
  progress: number;
  total: number;
}

export function useSpreadImages(spreads: AlbumSpread[], size: string, enabled = true): SpreadImagesState {
  const [state, setState] = useState<SpreadImagesState>({ images: [], ready: false, progress: 0, total: spreads.length });

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    setState({ images: [], ready: false, progress: 0, total: spreads.length });
    (async () => {
      const out: (string | null)[] = [];
      for (let i = 0; i < spreads.length; i++) {
        if (cancel) return;
        out.push(await renderOne(spreads[i], size));
        if (cancel) return;
        setState((s) => ({ ...s, progress: i + 1 }));
      }
      if (!cancel) setState({ images: out, ready: true, progress: spreads.length, total: spreads.length });
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreads, size, enabled]);

  return state;
}
