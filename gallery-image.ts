// Processamento de fotos da galeria de proofing.
// Gera preview (1600px, marca d'água) e thumb (400px, marca leve) a partir do
// original full-res. A marca d'água é um tile (SVG de texto ou PNG da logo)
// composto sobre a imagem com blend 'over' e tile:true.

import sharp from 'sharp';

export interface GalleryWatermarkOpts {
  watermarkType: 'text' | 'logo';
  watermarkText: string;
  logo?: Buffer | null;
  opacity: number;             // 0..1
  clientLabel?: string | null; // se vier, vira sufixo " · {cliente}" no texto
  // 'tiled' = logo diagonal repetida (padrão) · 'centered' = uma logo grande
  // centralizada. Só vale quando watermarkType === 'logo'.
  watermarkMode?: 'tiled' | 'centered';
}

export interface ProcessedGalleryPhoto {
  preview: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

const PREVIEW_MAX = 1600;
const PREVIEW_QUALITY = 75;
const THUMB_MAX = 400;
const THUMB_QUALITY = 70;

export async function processGalleryPhoto(
  original: Buffer,
  opts: GalleryWatermarkOpts
): Promise<ProcessedGalleryPhoto> {
  const meta = await sharp(original).metadata();
  const { width, height } = orientedDims(meta);
  const opacity = clampOpacity(opts.opacity);

  const preview = await buildVariant(original, PREVIEW_MAX, PREVIEW_QUALITY, opts, opacity);
  // thumb leva marca mais leve (metade da opacidade)
  const thumb = await buildVariant(original, THUMB_MAX, THUMB_QUALITY, opts, opacity * 0.5);

  return { preview, thumb, width, height };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return Math.min(1, Math.max(0.05, value));
}

// EXIF orientation >= 5 = foto "deitada" (90°/270°): largura e altura trocam.
function orientedDims(meta: sharp.Metadata): { width: number; height: number } {
  const swap = (meta.orientation || 1) >= 5;
  const w = meta.width || 0;
  const h = meta.height || 0;
  return swap ? { width: h, height: w } : { width: w, height: h };
}

async function buildVariant(
  original: Buffer,
  maxSide: number,
  quality: number,
  opts: GalleryWatermarkOpts,
  opacity: number
): Promise<Buffer> {
  // .rotate() sem args auto-orienta pelo EXIF ANTES de redimensionar
  const { data, info } = await sharp(original)
    .rotate()
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  // Modo "logo grande centralizada": uma única cópia no centro, sem tile.
  if (opts.watermarkMode === 'centered' && opts.watermarkType === 'logo' && opts.logo) {
    const single = await centeredLogo(opts.logo, info.width, info.height, opacity);
    return sharp(data)
      .composite([{ input: single, gravity: 'center', blend: 'over' }])
      .jpeg({ quality })
      .toBuffer();
  }

  const tile = await buildTile(info.width, info.height, opts, opacity);
  const safeTile = await fitTile(tile, info.width, info.height);

  return sharp(data)
    .composite([{ input: safeTile, tile: true, blend: 'over' }])
    .jpeg({ quality })
    .toBuffer();
}

// Logo única, grande e centralizada (sem rotação nem repetição). Ocupa quase a
// imagem inteira (~95%), mantendo a proporção — fit:inside cabe pela menor folga.
async function centeredLogo(
  logo: Buffer,
  imageWidth: number,
  imageHeight: number,
  opacity: number
): Promise<Buffer> {
  const boxW = Math.max(64, Math.round(imageWidth * 0.95));
  const boxH = Math.max(64, Math.round(imageHeight * 0.95));
  const alpha = Math.round(opacity * 255);
  return sharp(logo)
    // withoutEnlargement:false deixa AMPLIAR uma logo pequena até preencher a foto.
    .resize(boxW, boxH, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

async function buildTile(
  imageWidth: number,
  imageHeight: number,
  opts: GalleryWatermarkOpts,
  opacity: number
): Promise<Buffer> {
  if (opts.watermarkType === 'logo' && opts.logo) {
    return logoTile(opts.logo, imageWidth, opacity);
  }
  return textTile(watermarkLabel(opts), imageWidth, imageHeight, opacity);
}

function watermarkLabel(opts: GalleryWatermarkOpts): string {
  const base = (opts.watermarkText || '').trim() || 'PROVA';
  const client = (opts.clientLabel || '').trim();
  return client ? `${base} · ${client}` : base;
}

// O tile nunca pode ser maior que a imagem (composite com tile:true exige isso).
async function fitTile(tile: Buffer, maxW: number, maxH: number): Promise<Buffer> {
  const meta = await sharp(tile).metadata();
  if ((meta.width || 0) <= maxW && (meta.height || 0) <= maxH) return tile;
  return sharp(tile).resize(maxW, maxH, { fit: 'inside' }).png().toBuffer();
}

// Tile de texto: cópia central + cópias nos 4 cantos — quando repetido, vira
// um padrão diagonal intercalado cobrindo a imagem toda.
function textTile(text: string, imageWidth: number, imageHeight: number, opacity: number): Buffer {
  let fontSize = Math.max(12, Math.round(imageWidth / 32));
  let w = textTileWidth(text, fontSize);
  if (w > imageWidth) {
    fontSize = Math.max(8, Math.floor((fontSize * imageWidth) / w));
    w = textTileWidth(text, fontSize);
  }
  const h = Math.min(imageHeight, fontSize * 6);
  const esc = escapeXml(text);

  const textEl = (x: number, y: number) =>
    `<text x="${x}" y="${y}" dy="0.35em" text-anchor="middle" ` +
    `transform="rotate(-22 ${x} ${y})" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" ` +
    `fill="#ffffff" fill-opacity="${opacity}">${esc}</text>`;

  const positions: Array<[number, number]> = [
    [w / 2, h / 2],
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const texts = positions.map(([x, y]) => textEl(x, y)).join('\n  ');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">\n  ${texts}\n</svg>`
  );
}

function textTileWidth(text: string, fontSize: number): number {
  return Math.round(text.length * fontSize * 0.65 + fontSize * 4);
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Tile da logo: redimensiona p/ ~22% da largura, aplica opacidade no canal
// alfa (dest-in), rotaciona -22° e monta grade 2x2 com a segunda cópia
// deslocada meia célula — repetido, vira um padrão diagonal intercalado.
async function logoTile(logo: Buffer, imageWidth: number, opacity: number): Promise<Buffer> {
  const logoW = Math.max(48, Math.round(imageWidth * 0.22));
  const faded = await fadeLogo(logo, logoW, opacity);

  const rotated = await sharp(faded)
    .rotate(-22, { background: TRANSPARENT })
    .png()
    .toBuffer();
  const meta = await sharp(rotated).metadata();

  const gap = Math.round(logoW * 0.3);
  const half = Math.round(gap / 2);
  const cellW = (meta.width || logoW) + gap;
  const cellH = (meta.height || logoW) + gap;

  return sharp({ create: { width: cellW * 2, height: cellH * 2, channels: 4, background: TRANSPARENT } })
    .composite([
      { input: rotated, left: half, top: half },
      { input: rotated, left: cellW + half, top: cellH + half },
    ])
    .png()
    .toBuffer();
}

function fadeLogo(logo: Buffer, logoW: number, opacity: number): Promise<Buffer> {
  const alpha = Math.round(opacity * 255);
  return sharp(logo)
    .resize(logoW, logoW, { fit: 'inside' })
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
