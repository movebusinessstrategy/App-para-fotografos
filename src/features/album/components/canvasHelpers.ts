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

// Aplica um template livre: posiciona as caixas do layout sobre a lâmina
// inteira. Usa as dimensões VIVAS do canvas (nunca valores defasados).
// Limpa placeholders/fotos antigos e RE-ENCAIXA as fotos que já estavam na
// página nas novas caixas (na ordem); sobra vira placeholder pra preencher.
export function applyTemplate(canvas: Canvas, tpl: FreeTemplate): void {
  const W = canvas.getWidth();
  const H = canvas.getHeight();

  // Fotos já presentes (preserva pra reencaixar); remove tudo da página.
  const fotos = canvas.getObjects().filter((o) => o.type === "image") as FabricObjAny[];
  canvas.getObjects().slice().forEach((o) => canvas.remove(o));

  tpl.slots.forEach((s, i) => {
    const box = { x: s.x * W, y: s.y * H, w: s.w * W, h: s.h * H };
    const foto = fotos[i];
    if (foto) {
      fitInto(foto as unknown as FabricImage, box);
      foto.isPlaceholder = false;
      foto.set({ cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false });
      canvas.add(foto as FabricObject);
    } else {
      const rect = new Rect({
        left: box.x, top: box.y, width: box.w, height: box.h,
        fill: "#ece9ef",
        stroke: "#D4537E",
        strokeDashArray: [6, 6],
        strokeWidth: 1.5,
        rx: 6, ry: 6,
        cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false,
      }) as FabricObjAny;
      rect.isPlaceholder = true;
      canvas.add(rect as FabricObject);
    }
  });
  canvas.discardActiveObject();
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
