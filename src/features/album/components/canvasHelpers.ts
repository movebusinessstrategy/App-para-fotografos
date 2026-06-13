// Helpers de fabric.js para o editor livre de álbum.
// Mantém a lógica de canvas fora dos componentes React (complexidade baixa).
import { Canvas, FabricImage, Textbox, Rect, Circle, FabricObject } from "fabric";
import type { FreeTemplate } from "../templates";

// Props custom que serializamos junto do toObject (pra reidratar metadados).
export const EXTRA_PROPS = ["assetId", "nomeFoto", "isPlaceholder"];

// Registra as props custom no fabric v7 (assim toObject as inclui sempre).
FabricObject.customProperties = EXTRA_PROPS;

// Serializa a cena atual (equivalente ao toJSON com props custom no v7).
export function serializeCanvas(canvas: Canvas): Record<string, unknown> {
  return canvas.toObject(EXTRA_PROPS) as Record<string, unknown>;
}

export type FabricObjAny = FabricObject & {
  assetId?: string;
  nomeFoto?: string;
  isPlaceholder?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fill?: string;
  text?: string;
};

// Fontes seguras oferecidas no painel de texto.
export const FONTS = [
  "Playfair Display",
  "Poppins",
  "Dancing Script",
  "Roboto Slab",
  "Arial",
] as const;

// Escala uma imagem pra caber (contain) num retângulo, centralizada nele.
function fitInto(
  img: FabricImage,
  box: { x: number; y: number; w: number; h: number },
): void {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const scale = Math.min(box.w / iw, box.h / ih);
  img.set({
    scaleX: scale,
    scaleY: scale,
    left: box.x + (box.w - iw * scale) / 2,
    top: box.y + (box.h - ih * scale) / 2,
  });
}

// Carrega uma FabricImage de uma URL (sempre crossOrigin pra exportar JPG).
export async function loadFabricImage(url: string): Promise<FabricImage> {
  return FabricImage.fromURL(url, { crossOrigin: "anonymous" });
}

// Adiciona uma foto ao canvas, escalada pra caber e centralizada.
export async function addPhoto(
  canvas: Canvas,
  url: string,
  meta: { assetId: string; nomeFoto: string },
): Promise<void> {
  const img = (await loadFabricImage(url)) as FabricObjAny;
  const box = {
    x: canvas.width * 0.12,
    y: canvas.height * 0.12,
    w: canvas.width * 0.76,
    h: canvas.height * 0.76,
  };
  fitInto(img as FabricImage, box);
  img.assetId = meta.assetId;
  img.nomeFoto = meta.nomeFoto;
  img.set({ cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false });
  canvas.add(img as FabricObject);
  canvas.setActiveObject(img as FabricObject);
  canvas.requestRenderAll();
}

// Troca a imagem de um objeto selecionado mantendo posição/escala aproximada.
export async function swapPhoto(
  canvas: Canvas,
  target: FabricObjAny,
  url: string,
  meta: { assetId: string; nomeFoto: string },
): Promise<void> {
  const box = {
    x: target.left || 0,
    y: target.top || 0,
    w: (target.width || 0) * (target.scaleX || 1),
    h: (target.height || 0) * (target.scaleY || 1),
  };
  const img = (await loadFabricImage(url)) as FabricObjAny;
  fitInto(img as FabricImage, box);
  img.assetId = meta.assetId;
  img.nomeFoto = meta.nomeFoto;
  img.isPlaceholder = false;
  img.set({ cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false });
  const idx = canvas.getObjects().indexOf(target as FabricObject);
  canvas.remove(target as FabricObject);
  canvas.add(img as FabricObject);
  if (idx >= 0) canvas.moveObjectTo(img as FabricObject, idx);
  canvas.setActiveObject(img as FabricObject);
  canvas.requestRenderAll();
}

// Adiciona um texto editável centralizado.
export function addText(canvas: Canvas): void {
  const box = new Textbox("Toque pra editar", {
    left: canvas.width * 0.5,
    top: canvas.height * 0.5,
    width: canvas.width * 0.4,
    fontSize: Math.round(canvas.height * 0.06),
    fontFamily: "Playfair Display",
    fill: "#222222",
    originX: "center",
    originY: "center",
    textAlign: "center",
    cornerColor: "#D4537E",
  });
  canvas.add(box);
  canvas.setActiveObject(box);
  canvas.requestRenderAll();
}

// Adiciona uma forma (retângulo ou círculo).
export function addShape(canvas: Canvas, kind: "rect" | "circle"): void {
  const size = Math.min(canvas.width, canvas.height) * 0.3;
  const common = {
    left: canvas.width * 0.5 - size / 2,
    top: canvas.height * 0.5 - size / 2,
    fill: "#D4537E",
    cornerColor: "#D4537E",
  };
  const shape =
    kind === "rect"
      ? new Rect({ ...common, width: size, height: size, rx: 8, ry: 8 })
      : new Circle({ ...common, radius: size / 2 });
  canvas.add(shape);
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
}

// Aplica um template livre: cria placeholders cinza nos retângulos do layout.
export function applyTemplate(canvas: Canvas, tpl: FreeTemplate): void {
  tpl.slots.forEach((s) => {
    const rect = new Rect({
      left: s.x * canvas.width,
      top: s.y * canvas.height,
      width: s.w * canvas.width,
      height: s.h * canvas.height,
      fill: "#e9e4ea",
      stroke: "#D4537E",
      strokeDashArray: [6, 6],
      strokeWidth: 1.5,
      rx: 6,
      ry: 6,
      cornerColor: "#D4537E",
    }) as FabricObjAny;
    rect.isPlaceholder = true;
    canvas.add(rect as FabricObject);
  });
  canvas.requestRenderAll();
}

// Camadas / remoção do objeto ativo.
export function bringForward(canvas: Canvas): void {
  const o = canvas.getActiveObject();
  if (o) { canvas.bringObjectForward(o); canvas.requestRenderAll(); }
}

export function sendBackward(canvas: Canvas): void {
  const o = canvas.getActiveObject();
  if (o) { canvas.sendObjectBackwards(o); canvas.requestRenderAll(); }
}

export function deleteActive(canvas: Canvas): void {
  const objs = canvas.getActiveObjects();
  objs.forEach((o) => canvas.remove(o));
  canvas.discardActiveObject();
  canvas.requestRenderAll();
}
