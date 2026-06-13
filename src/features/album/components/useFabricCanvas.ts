// Hook que gerencia o ciclo de vida do canvas fabric do editor livre:
// criação, carga da página atual (canvas_json), autosave debounced e troca
// de página. Mantém o componente React enxuto.
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, FabricObject } from "fabric";
import type { AlbumSpread } from "../types";
import { canvasDims } from "../templates";
import { serializeCanvas, clampToFrame, clampToCanvas, type FabricObjAny } from "./canvasHelpers";

export interface FabricSelection {
  type: "image" | "textbox" | "rect" | "circle" | "none";
  obj: FabricObject | null;
}

interface Params {
  size: string;
  readOnly: boolean;
  currentSpread: AlbumSpread | undefined;
  // Persiste o canvas_json da página atual no array de spreads.
  onSaveCurrent: (json: Record<string, unknown>) => void;
}

const EMPTY_SELECTION: FabricSelection = { type: "none", obj: null };

// Mapeia o objeto ativo do fabric pro tipo do painel de propriedades.
function selectionFromObject(obj: FabricObject | null | undefined): FabricSelection {
  if (!obj) return EMPTY_SELECTION;
  const t = obj.type;
  if (t === "image") return { type: "image", obj };
  if (t === "textbox" || t === "text" || t === "i-text") return { type: "textbox", obj };
  if (t === "circle") return { type: "circle", obj };
  if (t === "rect") return { type: "rect", obj };
  return { type: "none", obj };
}

export function useFabricCanvas(params: Params) {
  const { size, readOnly, currentSpread, onSaveCurrent } = params;
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<FabricSelection>(EMPTY_SELECTION);
  const [bgColor, setBgColor] = useState("#ffffff");

  const saveTimer = useRef<number | null>(null);
  const onSaveRef = useRef(onSaveCurrent);
  onSaveRef.current = onSaveCurrent;
  const loadingRef = useRef(false);

  // Salva (debounced) a cena atual no spread.
  const scheduleSave = useCallback(() => {
    if (loadingRef.current || readOnly) return;
    const c = fabricRef.current;
    if (!c) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!fabricRef.current) return;
      onSaveRef.current(serializeCanvas(fabricRef.current));
    }, 1200);
  }, [readOnly]);

  // Cria o canvas fabric uma vez.
  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;
    const dims = canvasDims(size, currentSpread?.kind);
    const c = new Canvas(canvasElRef.current, {
      width: dims.w,
      height: dims.h,
      backgroundColor: "#ffffff",
      selection: !readOnly,
      preserveObjectStacking: true,
    });
    fabricRef.current = c;

    const onSel = () => setSelection(selectionFromObject(c.getActiveObject()));
    const onClear = () => setSelection(EMPTY_SELECTION);
    // Foto presa ao quadro (clamp) e objetos livres dentro da lâmina.
    const onConstrain = (e: { target?: FabricObject }) => {
      const o = e.target as FabricObjAny | undefined;
      if (!o) return;
      if (o.frame) clampToFrame(o);
      else clampToCanvas(o, c.getWidth(), c.getHeight());
    };
    c.on("selection:created", onSel);
    c.on("selection:updated", onSel);
    c.on("selection:cleared", onClear);
    c.on("object:moving", onConstrain);
    c.on("object:scaling", onConstrain);
    c.on("object:modified", onConstrain);
    c.on("object:modified", scheduleSave);
    c.on("object:added", scheduleSave);
    c.on("object:removed", scheduleSave);

    setReady(true);
    return () => {
      c.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Troca de TAMANHO do álbum: redimensiona o canvas e reescala os objetos
  // proporcionalmente (mantém a composição relativa).
  const sizeRef = useRef(size);
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || !ready) return;
    if (sizeRef.current === size) return;
    const oldDims = canvasDims(sizeRef.current, currentSpread?.kind);
    const newDims = canvasDims(size, currentSpread?.kind);
    sizeRef.current = size;
    const sx = newDims.w / (oldDims.w || 1);
    const sy = newDims.h / (oldDims.h || 1);
    c.setDimensions({ width: newDims.w, height: newDims.h });
    c.getObjects().forEach((o) => {
      o.set({
        left: (o.left || 0) * sx,
        top: (o.top || 0) * sy,
        scaleX: (o.scaleX || 1) * sx,
        scaleY: (o.scaleY || 1) * sy,
      });
      o.setCoords();
    });
    c.requestRenderAll();
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ready]);

  // Aplica readOnly em runtime (canvas e objetos).
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.selection = !readOnly;
    c.getObjects().forEach((o) => {
      o.selectable = !readOnly;
      o.evented = !readOnly;
    });
    c.requestRenderAll();
  }, [readOnly, ready]);

  // Carrega a página atual (ou limpa) quando o spread muda de id.
  const loadSpread = useCallback(async (spread: AlbumSpread | undefined) => {
    const c = fabricRef.current;
    if (!c) return;
    loadingRef.current = true;
    const dims = canvasDims(size, spread?.kind);
    c.setDimensions({ width: dims.w, height: dims.h });
    const json = spread?.canvas_json;
    if (json && typeof json === "object") {
      await c.loadFromJSON(json);
      const bg = (json as { background?: string }).background;
      if (typeof bg === "string") setBgColor(bg);
      else setBgColor("#ffffff");
    } else {
      c.clear();
      c.backgroundColor = "#ffffff";
      setBgColor("#ffffff");
    }
    c.getObjects().forEach((o) => {
      o.selectable = !readOnly;
      o.evented = !readOnly;
      o.set({ cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false });
    });
    c.discardActiveObject();
    setSelection(EMPTY_SELECTION);
    c.requestRenderAll();
    loadingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, readOnly]);

  // Ajusta o TAMANHO EXIBIDO (CSS) mantendo o backstore na resolução do
  // editor. Mantém a proporção EXATA (fabric cssOnly) — sem transform frágil,
  // que era a causa do "desconfigurado / saiu da lâmina / tamanho errado".
  const fitToWidth = useCallback((availW: number): { w: number; h: number } => {
    const c = fabricRef.current;
    if (!c || availW <= 0) return { w: 0, h: 0 };
    const bw = c.getWidth();
    const bh = c.getHeight();
    const cssW = Math.min(availW, bw);
    const cssH = (cssW * bh) / bw;
    c.setDimensions({ width: `${cssW}px`, height: `${cssH}px` }, { cssOnly: true });
    return { w: cssW, h: cssH };
  }, []);

  // Serializa a cena atual imediatamente (sem debounce) — usado ao trocar página.
  const snapshot = useCallback((): Record<string, unknown> | null => {
    const c = fabricRef.current;
    if (!c) return null;
    return serializeCanvas(c);
  }, []);

  // Muda a cor de fundo + agenda salvar.
  const changeBackground = useCallback((color: string) => {
    const c = fabricRef.current;
    if (!c) return;
    c.backgroundColor = color;
    setBgColor(color);
    c.requestRenderAll();
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  return {
    canvasElRef,
    fabricRef,
    ready,
    selection,
    bgColor,
    loadSpread,
    snapshot,
    fitToWidth,
    scheduleSave,
    changeBackground,
    refreshSelection: () => setSelection(selectionFromObject(fabricRef.current?.getActiveObject() ?? null)),
  };
}
