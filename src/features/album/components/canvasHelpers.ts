// Helpers de fabric.js para o editor livre de álbum.
// Mantém a lógica de canvas fora dos componentes React (complexidade baixa).
import { Canvas, FabricImage, Textbox, Rect, Circle, FabricObject } from "fabric";
import type { FreeTemplate } from "../templates";

// Props custom que serializamos junto do toObject (pra reidratar metadados).
// 'frame' = retângulo FIXO (px) onde a foto fica presa/recortada.
export const EXTRA_PROPS = ["assetId", "nomeFoto", "isPlaceholder", "frame"];

export interface Frame { x: number; y: number; w: number; h: number }

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
  frame?: Frame;
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

// Carrega uma FabricImage de uma URL (sempre crossOrigin pra exportar JPG).
export async function loadFabricImage(url: string): Promise<FabricImage> {
  return FabricImage.fromURL(url, { crossOrigin: "anonymous" });
}

// Recorta a imagem ao QUADRO FIXO (clipPath absoluto) e a escala pra COBRIR
// o quadro (sem deixar sobra branca), centralizada. O quadro nunca se mexe;
// só a foto, e ela nunca aparece fora do quadro (recorte).
function coverIntoFrame(img: FabricObjAny, frame: Frame): void {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const scale = Math.max(frame.w / iw, frame.h / ih);
  const clip = new Rect({
    originX: "left", originY: "top",
    left: frame.x, top: frame.y, width: frame.w, height: frame.h, absolutePositioned: true,
  });
  img.set({
    originX: "center", originY: "center",
    left: frame.x + frame.w / 2,
    top: frame.y + frame.h / 2,
    scaleX: scale, scaleY: scale,
    clipPath: clip,
    cornerColor: "#D4537E", cornerStyle: "circle", transparentCorners: false,
    lockRotation: true,
  });
  img.frame = frame;
  img.isPlaceholder = false;
}

// Mantém a foto SEMPRE cobrindo o quadro (sem gaps) ao mover/zoom. Usado no
// clamp de object:moving/scaling. Origem da imagem = center.
export function clampToFrame(o: FabricObjAny): void {
  const f = o.frame;
  if (!f) return;
  const iw = o.width || 1;
  const ih = o.height || 1;
  const minScale = Math.max(f.w / iw, f.h / ih);
  if ((o.scaleX || 1) < minScale - 0.0001) { o.scaleX = minScale; o.scaleY = minScale; }
  const halfW = (iw * (o.scaleX || 1)) / 2;
  const halfH = (ih * (o.scaleY || 1)) / 2;
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const maxDx = Math.max(0, halfW - f.w / 2);
  const maxDy = Math.max(0, halfH - f.h / 2);
  o.left = Math.min(Math.max(o.left || 0, cx - maxDx), cx + maxDx);
  o.top = Math.min(Math.max(o.top || 0, cy - maxDy), cy + maxDy);
  o.setCoords();
}

// Mantém um objeto livre (texto/forma) dentro da lâmina.
export function clampToCanvas(o: FabricObjAny, W: number, H: number): void {
  const w = o.getScaledWidth();
  const h = o.getScaledHeight();
  const ox = o.originX === "center" ? w / 2 : 0;
  const oy = o.originY === "center" ? h / 2 : 0;
  o.left = Math.min(Math.max(o.left || 0, ox), W - w + ox);
  o.top = Math.min(Math.max(o.top || 0, oy), H - h + oy);
  o.setCoords();
}

// Placeholder de um quadro vazio: fixo (não move/escala), clicável pra preencher.
function makePlaceholder(frame: Frame): FabricObjAny {
  const rect = new Rect({
    // fabric v7 usa origin 'center' por padrão — fixamos top-left pra que
    // left/top sejam o CANTO do quadro (senão a caixa sobe pra esquerda).
    originX: "left", originY: "top",
    left: frame.x, top: frame.y, width: frame.w, height: frame.h,
    fill: "#ece9ef",
    stroke: "#D4537E", strokeDashArray: [7, 7], strokeWidth: 1.5,
    selectable: true, evented: true,
    lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true,
    hasControls: false, hasBorders: true, hoverCursor: "pointer",
  }) as FabricObjAny;
  rect.isPlaceholder = true;
  rect.frame = frame;
  return rect;
}

// Preenche UM quadro (placeholder ou foto) com uma nova foto, no mesmo lugar.
export async function fillSlot(
  canvas: Canvas,
  target: FabricObjAny,
  url: string,
  meta: { assetId: string; nomeFoto: string },
): Promise<void> {
  const frame = target.frame;
  if (!frame) return;
  const img = (await loadFabricImage(url)) as FabricObjAny;
  img.assetId = meta.assetId;
  img.nomeFoto = meta.nomeFoto;
  coverIntoFrame(img, frame);
  const idx = canvas.getObjects().indexOf(target as FabricObject);
  canvas.remove(target as FabricObject);
  canvas.add(img as FabricObject);
  if (idx >= 0) canvas.moveObjectTo(img as FabricObject, idx);
  canvas.setActiveObject(img as FabricObject);
  canvas.requestRenderAll();
}

// Clique numa foto da bandeja: preenche o quadro ATIVO; senão o 1º vazio.
export async function addPhoto(
  canvas: Canvas,
  url: string,
  meta: { assetId: string; nomeFoto: string },
): Promise<void> {
  const active = canvas.getActiveObject() as FabricObjAny | undefined;
  if (active && active.frame) {
    await fillSlot(canvas, active, url, meta);
    return;
  }
  const empty = canvas.getObjects().find((o) => (o as FabricObjAny).isPlaceholder) as FabricObjAny | undefined;
  if (empty) {
    await fillSlot(canvas, empty, url, meta);
    return;
  }
  // Sem quadro: cria um quadro central e já preenche (continua "preso").
  const frame: Frame = {
    x: canvas.getWidth() * 0.15, y: canvas.getHeight() * 0.12,
    w: canvas.getWidth() * 0.7, h: canvas.getHeight() * 0.76,
  };
  const img = (await loadFabricImage(url)) as FabricObjAny;
  img.assetId = meta.assetId;
  img.nomeFoto = meta.nomeFoto;
  coverIntoFrame(img, frame);
  canvas.add(img as FabricObject);
  canvas.setActiveObject(img as FabricObject);
  canvas.requestRenderAll();
}

// Troca a foto de um quadro selecionado (mantém o quadro).
export async function swapPhoto(
  canvas: Canvas,
  target: FabricObjAny,
  url: string,
  meta: { assetId: string; nomeFoto: string },
): Promise<void> {
  if (target.frame) {
    await fillSlot(canvas, target, url, meta);
    return;
  }
  await addPhoto(canvas, url, meta);
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
    originX: "left" as const, originY: "top" as const,
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

// Aplica um template: cria os QUADROS FIXOS do layout sobre a lâmina inteira
// (dimensões vivas do canvas). Re-encaixa as fotos já presentes nos novos
// quadros (na ordem); quadro sem foto vira placeholder clicável. Textos/formas
// livres são preservados por cima.
export function applyTemplate(canvas: Canvas, tpl: FreeTemplate): void {
  const W = canvas.getWidth();
  const H = canvas.getHeight();

  const fotos = canvas.getObjects().filter((o) => o.type === "image") as FabricObjAny[];
  const livres = canvas.getObjects().filter(
    (o) => o.type !== "image" && !(o as FabricObjAny).isPlaceholder,
  );
  canvas.getObjects().slice().forEach((o) => canvas.remove(o));

  tpl.slots.forEach((s, i) => {
    const frame: Frame = { x: s.x * W, y: s.y * H, w: s.w * W, h: s.h * H };
    const foto = fotos[i];
    if (foto) {
      coverIntoFrame(foto, frame);
      canvas.add(foto as FabricObject);
    } else {
      canvas.add(makePlaceholder(frame) as FabricObject);
    }
  });
  // Textos/formas voltam por cima.
  livres.forEach((o) => canvas.add(o));
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
