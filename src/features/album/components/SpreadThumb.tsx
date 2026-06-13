import React, { useEffect, useRef, useState } from "react";
import { StaticCanvas } from "fabric";

import { canvasDims } from "../templates";
import type { AlbumSpread } from "../types";

// Renderiza uma miniatura da lâmina (canvas_json) num StaticCanvas offscreen.
// Reage a mudanças no canvas_json regenerando o dataURL.
export function SpreadThumb({ spread, size }: { spread: AlbumSpread; size: string; key?: React.Key | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const lastJson = useRef<string>("");

  useEffect(() => {
    const json = spread.canvas_json;
    const key = json ? JSON.stringify(json) : "";
    if (key === lastJson.current) return;
    lastJson.current = key;
    if (!json) { setUrl(null); return; }

    let cancelled = false;
    const dims = canvasDims(size, spread.kind);
    const c = new StaticCanvas(undefined, {
      width: dims.w,
      height: dims.h,
      backgroundColor: "#ffffff",
      renderOnAddRemove: false,
    });
    c.loadFromJSON(json)
      .then(() => {
        if (cancelled) return;
        c.renderAll();
        setUrl(c.toDataURL({ format: "jpeg", quality: 0.6, multiplier: 0.25 }));
      })
      .catch(() => { if (!cancelled) setUrl(null); })
      .finally(() => c.dispose());
    return () => { cancelled = true; };
  }, [spread.canvas_json, spread.kind, size]);

  if (url) {
    return <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800 text-[9px] text-gray-400">
      em branco
    </div>
  );
}
