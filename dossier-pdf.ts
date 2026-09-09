// Dossiê editorial para conferência do ensaio: identidade do estúdio e fotos integrais.
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import type { DossierContent } from './ai-agent.js';

const W = 210, H = 297, M = 20, CW = W - M * 2;
const INK = '#211f1b', MUTED = '#57524a', GOLD = '#8b6e3c', PAPER = '#fbf8f2', LINE = '#e7decd';
export interface DossierPhoto { jpeg: Buffer; width: number; height: number; id?: string; caption?: string }
export interface DossierLogo { png: Buffer; width: number; height: number }
export interface DossierPdfInput {
  clientName: string; phone?: string | null; jobLabel?: string | null; generatedAt: string;
  content: Partial<DossierContent>; referencePhotos: DossierPhoto[]; paymentPhotos: DossierPhoto[];
  studioName?: string; logo?: DossierLogo | null; audience?: 'client' | 'internal';
  choices?: Array<{ title: string; value: string }>;
  questions?: Array<{ title: string; question: string }>;
  missingPhotos?: number; example?: boolean;
}
export async function normalizePhotoToJpeg(input: Buffer): Promise<DossierPhoto | null> {
  try {
    const jpeg = await sharp(input).rotate().resize({ width: 1400, withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    const meta = await sharp(jpeg).metadata();
    return { jpeg, width: meta.width || 1400, height: meta.height || 1400 };
  } catch { return null; }
}
export async function normalizeDossierLogo(input: Buffer): Promise<DossierLogo | null> {
  try {
    const { data, info } = await sharp(input).rotate()
      .resize({ width: 1200, height: 400, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height };
  } catch { return null; }
}
interface Layout { doc: jsPDF; y: number; input: DossierPdfInput }
function text(doc: jsPDF, value: string) {
  return String(value).replace(/[–—−]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF\n]/g, '').trim();
}
function page(l: Layout, first = false) {
  if (!first) l.doc.addPage();
  l.doc.setFillColor(PAPER); l.doc.rect(0, 0, W, H, 'F');
  l.y = 35;
}
function brand(l: Layout) {
  l.doc.setTextColor(INK); l.doc.setFont('times', 'normal'); l.doc.setFontSize(14);
  const logo = l.input.logo;
  if (logo) {
    const scale = Math.min(48 / logo.width, 14 / logo.height);
    const width = logo.width * scale, height = logo.height * scale;
    l.doc.addImage(logo.png, 'PNG', M, 7 + (14 - height) / 2, width, height);
  } else {
    l.doc.text(text(l.doc, l.input.studioName || 'Estúdio'), M, 17);
  }
  l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(7.5); l.doc.setTextColor(GOLD);
  l.doc.text(l.input.example ? 'EXEMPLO DE APRESENTAÇÃO' : 'SEU ENSAIO', W - M, 17, { align: 'right' });
  l.doc.setDrawColor(LINE); l.doc.setLineWidth(.25); l.doc.line(M, 23, W - M, 23);
}
function room(l: Layout, size: number) { if (l.y + size > H - 24) page(l); }
function label(l: Layout, title: string) {
  room(l, 16); l.doc.setFont('helvetica', 'bold'); l.doc.setFontSize(8); l.doc.setTextColor(GOLD);
  l.doc.text(text(l.doc, title).toUpperCase(), M, l.y); l.y += 7;
}
function paragraph(l: Layout, value: string, width = CW, x = M, size = 10) {
  l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(size); l.doc.setTextColor(MUTED);
  const lines: string[] = l.doc.splitTextToSize(text(l.doc, value), width);
  for (const line of lines) { room(l, 5.4); l.doc.text(line, x, l.y); l.y += 5.4; }
  l.y += 3;
}
function title(l: Layout, value: string) {
  room(l, 23); l.doc.setFont('times', 'normal'); l.doc.setTextColor(INK); l.doc.setFontSize(26);
  l.doc.text(value, M, l.y); l.y += 13;
}
function photo(l: Layout, p: DossierPhoto, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / p.width, h / p.height);
  const iw = p.width * scale, ih = p.height * scale;
  l.doc.setFillColor('#f4efe5'); l.doc.rect(x, y, w, h, 'F');
  l.doc.addImage(p.jpeg, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'FAST');
}
function intro(l: Layout) {
  const hero = l.input.referencePhotos[0];
  l.doc.setFont('times', 'normal'); l.doc.setFontSize(34); l.doc.setTextColor(INK);
  l.doc.text('O seu ensaio,', M, 45); l.doc.text('do seu jeito.', M, 59);
  l.y = 76; label(l, l.input.clientName);
  paragraph(l, l.input.jobLabel || 'Vamos preparar suas fotos.', hero ? 78 : CW, M, 10);
  paragraph(l, 'Reunimos suas ideias, as referências e os detalhes que conversamos. Vamos conferir tudo com carinho?', hero ? 78 : CW, M, 10);
  if (hero) { photo(l, hero, 113, 33, 77, 108); l.y = Math.max(l.y, 153); }
  else l.y = Math.max(l.y, 118);
  if (l.input.example) paragraph(l, 'Cliente fictícia. Fotos dos materiais do estúdio usadas apenas para demonstrar o dossiê.', CW, M, 8);
}
function choices(l: Layout) {
  const rows = l.input.choices || [];
  if (!rows.length) {
    if (l.input.content.resumo) { label(l, 'O que imaginamos'); paragraph(l, l.input.content.resumo); }
    list(l, 'Suas preferências', l.input.content.preferencias);
    list(l, 'Ideias para o ensaio', l.input.content.o_que_quer); return;
  }
  label(l, 'O que já combinamos');
  for (let i = 0; i < rows.length; i += 2) choiceRow(l, rows.slice(i, i + 2));
}
function choiceRow(l: Layout, rows: Array<{title: string; value: string}>) {
  l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(10);
  const values = rows.map(row => l.doc.splitTextToSize(text(l.doc, row.value), 79) as string[]);
  const height = Math.max(...values.map(lines => lines.length)) * 5 + 13;
  if (height > 90) {
    for (const row of rows) { label(l, row.title); paragraph(l, row.value); } return;
  }
  room(l, height); const y = l.y;
  rows.forEach((row, i) => {
    const x = M + i * 88;
    l.doc.setFont('helvetica', 'bold'); l.doc.setFontSize(9); l.doc.setTextColor(INK);
    l.doc.text(text(l.doc, row.title), x, y);
    l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(10); l.doc.setTextColor(MUTED);
    l.doc.text(values[i], x, y + 6);
  }); l.y += height;
}

function list(l: Layout, name: string, values: string[] | undefined) {
  if (!values?.length) return;
  label(l, name); for (const value of values) paragraph(l, value);
}
function references(l: Layout) {
  const photos = l.input.referencePhotos;
  if (!photos.length && !l.input.missingPhotos) return;
  page(l); title(l, 'Suas referências');
  paragraph(l, l.input.example ? 'Exemplos visuais dos materiais do Estúdio Pitori.' : 'As imagens que você compartilhou para nos mostrar o que imagina.');
  for (let i = 0; i < photos.length; i += 2) {
    l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(9);
    const row = photos.slice(i, i + 2);
    const captions = row.map(p => l.doc.splitTextToSize(text(l.doc, p.caption || 'Imagem compartilhada como inspiração. O detalhe a aproveitar ainda precisa ser confirmado.'), 82) as string[]);
    const height = 119 + Math.max(...captions.map(lines => lines.length)) * 4.2;
    room(l, height);
    const y = l.y;
    row.forEach((p, j) => {
      const x = M + j * 88;
      photo(l, p, x, y, 82, 100);
      l.doc.setFont('helvetica', 'bold'); l.doc.setFontSize(8); l.doc.setTextColor(GOLD);
      l.doc.text(`REFERÊNCIA ${String(i + j + 1).padStart(2, '0')}`, x, y + 107);
      l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(9); l.doc.setTextColor(MUTED);
      l.doc.text(captions[j], x, y + 113);
    });
    l.y = y + height;
  }
  if (l.input.missingPhotos) paragraph(l, `${l.input.missingPhotos} referência(s) não puderam ser recuperadas. Vamos conferir essas imagens antes de finalizar.`, CW, M, 9);
}
function questions(l: Layout) {
  const pending = l.input.questions || [];
  if (!pending.length) return;
  room(l, 42); title(l, 'Só falta combinar');
  paragraph(l, 'Você pode responder pelo WhatsApp. Vamos acrescentar suas escolhas aqui.');
  pending.forEach((item, index) => { room(l, 20); label(l, `${index + 1}. ${item.title}`); paragraph(l, item.question); });
}
function internalNotes(l: Layout) {
  if (l.input.audience !== 'internal') return;
  page(l); title(l, 'Notas da equipe');
  list(l, 'Combinados da venda', l.input.content.combinados);
  list(l, 'Pagamentos', l.input.content.pagamentos);
  list(l, 'Cuidados', l.input.content.evitar);
  list(l, 'Links internos', l.input.content.links_importantes);
  for (const p of l.input.paymentPhotos) { room(l, 100); photo(l, p, M, l.y, 80, 90); l.y += 100; }
}
function finish(l: Layout) {
  room(l, 20); l.doc.setDrawColor(LINE); l.doc.line(M, l.y, W - M, l.y); l.y += 7;
  paragraph(l, 'É assim que você imaginou? Se quiser mudar algo, é só nos contar.', CW, M, 11);
  const pages = l.doc.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    l.doc.setPage(n); brand(l); l.doc.setFont('helvetica', 'normal'); l.doc.setFontSize(7.5); l.doc.setTextColor(MUTED);
    l.doc.text(l.input.audience === 'internal' ? 'Uso interno da equipe' : 'Preparado para conferirmos juntos', M, H - 12);
    l.doc.text(`${n} / ${pages}`, W - M, H - 12, { align: 'right' });
  }
}
export function buildDossierPdf(input: DossierPdfInput): Buffer {
  const l: Layout = { doc: new jsPDF({ unit: 'mm', format: 'a4', compress: true }), y: M, input };
  page(l, true); intro(l); choices(l); references(l); questions(l); internalNotes(l); finish(l);
  return Buffer.from(l.doc.output('arraybuffer'));
}
