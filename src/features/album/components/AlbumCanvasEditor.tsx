import React, { useEffect, useImperativeHandle, useRef, useState } from "react";

import type { AlbumAsset, AlbumSpread } from "../types";
import { canvasDims, FREE_TEMPLATES, freeTemplateById } from "../templates";
import {
  addPhoto, addShape, addText, applyTemplate, bringForward,
  deleteActive, sendBackward, swapPhoto, FabricObjAny,
} from "./canvasHelpers";
import { useFabricCanvas } from "./useFabricCanvas";
import { PropriedadesPainel } from "./PropriedadesPainel";

export interface AlbumCanvasEditorHandle {
  addPhoto: (asset: AlbumAsset) => void;
  addText: () => void;
  addShape: (kind: "rect" | "circle") => void;
  applyTemplate: (templateId: string) => void;
  setBackground: (color: string) => void;
}

interface Props {
  spreads: AlbumSpread[];
  assets: AlbumAsset[];
  size: string;
  currentIndex: number;
  readOnly?: boolean;
  onSpreadsChange: (spreads: AlbumSpread[]) => void;
  // Bandeja embutida (cliente) ou externa (estúdio): controla a foto a inserir.
  onReady?: (handle: AlbumCanvasEditorHandle) => void;
}

// Escala o elemento DOM do canvas pra caber no container, mantendo proporção.
function useResponsiveScale(
  containerRef: React.RefObject<HTMLDivElement | null>,
  baseW: number,
  baseH: number,
): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth;
      if (availW <= 0) return;
      setScale(Math.min(1, availW / baseW));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, baseW, baseH]);
  return scale;
}

// Editor de canvas reutilizável (estúdio + cliente). Toda a edição livre
// (mover, redimensionar, girar, texto, formas, fundo) vem do fabric.
const AlbumCanvasEditor = React.forwardRef<AlbumCanvasEditorHandle, Props>(
  function AlbumCanvasEditor(props, ref) {
    const { spreads, assets, size, currentIndex, readOnly = false, onSpreadsChange, onReady } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const spreadsRef = useRef(spreads);
    spreadsRef.current = spreads;
    const prevIndexRef = useRef(currentIndex);
    const prevLoadedRef = useRef<number | null>(null);

    const current = spreads[currentIndex];

    // Salva o canvas_json da página i no array de spreads.
    const persistCurrent = (json: Record<string, unknown>) => {
      const idx = prevIndexRef.current;
      const next = spreadsRef.current.map((s, i) =>
        i === idx ? { ...s, canvas_json: json } : s,
      );
      onSpreadsChange(next);
    };

    const fc = useFabricCanvas({
      size,
      readOnly,
      currentSpread: current,
      onSaveCurrent: persistCurrent,
    });

    const dims = canvasDims(size, current?.kind);
    const scale = useResponsiveScale(containerRef, dims.w, dims.h);

    // Troca de página: salva a anterior antes de carregar a nova. Dispara por
    // índice (não por id) — assim a troca tmp-id → id real não recarrega a cena.
    useEffect(() => {
      if (!fc.ready) return;
      if (prevLoadedRef.current === currentIndex) return;
      // Salva snapshot da página que estava aberta (se havia).
      if (prevLoadedRef.current !== null && !readOnly) {
        const snap = fc.snapshot();
        const oldIdx = prevIndexRef.current;
        if (snap) {
          const updated = spreadsRef.current.map((s, i) =>
            i === oldIdx ? { ...s, canvas_json: snap } : s,
          );
          spreadsRef.current = updated;
          onSpreadsChange(updated);
        }
      }
      prevLoadedRef.current = currentIndex;
      prevIndexRef.current = currentIndex;
      fc.loadSpread(current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, fc.ready]);

    // Tecla Delete remove o objeto ativo.
    useEffect(() => {
      if (readOnly) return;
      const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const c = fc.fabricRef.current;
        if (!c) return;
        const active = c.getActiveObject() as FabricObjAny | undefined;
        // Não apaga enquanto edita texto.
        const editing = active && active.type === "textbox" && (active as { isEditing?: boolean }).isEditing;
        if ((e.key === "Delete" || e.key === "Backspace") && !editing) {
          e.preventDefault();
          deleteActive(c);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [readOnly, fc.fabricRef]);

    // API imperativa pra barra de ferramentas do estúdio.
    const handle: AlbumCanvasEditorHandle = {
      addPhoto: (asset) => {
        const c = fc.fabricRef.current;
        const url = asset.preview_url || asset.thumb_url;
        if (!c || !url) return;
        const active = c.getActiveObject() as FabricObjAny | undefined;
        const meta = { assetId: asset.id, nomeFoto: asset.original_name || "" };
        if (active && active.isPlaceholder) {
          void swapPhoto(c, active, url, meta);
        } else {
          void addPhoto(c, url, meta);
        }
      },
      addText: () => fc.fabricRef.current && addText(fc.fabricRef.current),
      addShape: (kind) => fc.fabricRef.current && addShape(fc.fabricRef.current, kind),
      applyTemplate: (templateId) => {
        const c = fc.fabricRef.current;
        const tpl = freeTemplateById(templateId);
        if (c && tpl) applyTemplate(c, tpl);
      },
      setBackground: fc.changeBackground,
    };
    useImperativeHandle(ref, () => handle);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    useEffect(() => {
      if (fc.ready) onReadyRef.current?.(handle);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fc.ready]);

    const cssW = dims.w * scale;
    const cssH = dims.h * scale;

    return (
      <div className="flex w-full flex-col gap-3 lg:flex-row">
        <div ref={containerRef} className="min-w-0 flex-1">
          <div
            className="mx-auto shadow-lg ring-1 ring-black/10 dark:ring-white/10"
            style={{ width: cssW || "100%", height: cssH || "auto" }}
          >
            <div
              style={{
                width: dims.w,
                height: dims.h,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <canvas ref={fc.canvasElRef} />
            </div>
          </div>
        </div>

        {!readOnly && (
          <div className="w-full flex-shrink-0 lg:w-60">
            <PropriedadesPainel
              selection={fc.selection}
              bgColor={fc.bgColor}
              fabricRef={fc.fabricRef}
              onChanged={() => { fc.scheduleSave(); fc.refreshSelection(); }}
              onBackground={fc.changeBackground}
              onBringForward={() => fc.fabricRef.current && bringForward(fc.fabricRef.current)}
              onSendBackward={() => fc.fabricRef.current && sendBackward(fc.fabricRef.current)}
              onDelete={() => fc.fabricRef.current && deleteActive(fc.fabricRef.current)}
              assets={assets}
              onReplacePhoto={(asset) => {
                const c = fc.fabricRef.current;
                const active = fc.selection.obj as FabricObjAny | null;
                const url = asset.preview_url || asset.thumb_url;
                if (c && active && url) {
                  void swapPhoto(c, active, url, { assetId: asset.id, nomeFoto: asset.original_name || "" });
                }
              }}
            />
          </div>
        )}
      </div>
    );
  },
);

export { FREE_TEMPLATES };
export default AlbumCanvasEditor;
