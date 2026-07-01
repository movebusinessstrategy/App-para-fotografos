// Gera o PDF do dossiê de alinhamento (A4) — resumo da venda, falas de
// referência da cliente, preferências, combinados e as fotos de referência
// que ela mandou na conversa. Visual sóbrio: cabeçalho verde-oceano, seções
// com título em teal, citações em itálico. Fontes padrão (sans) do jsPDF.
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import type { DossierContent } from './ai-agent.js';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOT_Y = PAGE_H - 10;

const TEAL = '#008069';
const INK = '#1f2937';
const GRAY = '#6b7280';

export interface DossierPhoto {
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface DossierPdfInput {
  clientName: string;
  phone?: string | null;
  jobLabel?: string | null; // "Gestante — 15/08/2026 — 14:00"
  generatedAt: string;      // ISO
  content: Partial<DossierContent>;
  photos: DossierPhoto[];
}

// Converte a mídia bruta (qualquer formato que o WhatsApp mande, incl. webp)
// pra JPEG compacto pro PDF. Retorna null se não for imagem decodificável.
export async function normalizePhotoToJpeg(input: Buffer): Promise<DossierPhoto | null> {
  try {
    const jpeg = await sharp(input)
      .rotate() // respeita EXIF
      .resize({ width: 900, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    const meta = await sharp(jpeg).metadata();
    return { jpeg, width: meta.width || 900, height: meta.height || 900 };
  } catch {
    return null;
  }
}

interface Cursor { y: number }

function ensureSpace(doc: jsPDF, cur: Cursor, needed: number) {
  if (cur.y + needed <= PAGE_H - 16) return;
  doc.addPage();
  cur.y = MARGIN;
}

function drawHeader(doc: jsPDF, d: DossierPdfInput, cur: Cursor) {
  doc.setFillColor(TEAL);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Dossiê de Alinhamento', MARGIN, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const meta = [d.clientName, d.jobLabel, d.phone ? `+${String(d.phone).replace(/\D/g, '')}` : '']
    .filter(Boolean).join('   •   ');
  doc.text(meta, MARGIN, 21);
  doc.setFontSize(8);
  const when = new Date(d.generatedAt);
  doc.text(`Gerado pela IA a partir da conversa do WhatsApp — ${when.toLocaleDateString('pt-BR')} ${when.toLocaleTimeString('pt-BR').slice(0, 5)}`, MARGIN, 26.5);
  cur.y = 38;
}

function drawSectionTitle(doc: jsPDF, cur: Cursor, title: string, color = TEAL) {
  ensureSpace(doc, cur, 14);
  doc.setTextColor(color);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(title.toUpperCase(), MARGIN, cur.y);
  doc.setDrawColor(color);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, cur.y + 1.6, MARGIN + CONTENT_W, cur.y + 1.6);
  cur.y += 7;
}

function drawParagraph(doc: jsPDF, cur: Cursor, text: string) {
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  for (const line of lines) {
    ensureSpace(doc, cur, 5.2);
    doc.text(line, MARGIN, cur.y);
    cur.y += 5;
  }
  cur.y += 2;
}

function drawBullets(doc: jsPDF, cur: Cursor, items: string[], opts: { italic?: boolean; quote?: boolean } = {}) {
  doc.setTextColor(INK);
  doc.setFont('helvetica', opts.italic ? 'italic' : 'normal');
  doc.setFontSize(10);
  for (const item of items) {
    const body = opts.quote ? `“${item}”` : item;
    const lines = doc.splitTextToSize(body, CONTENT_W - 6);
    ensureSpace(doc, cur, lines.length * 5 + 2);
    doc.setTextColor(opts.quote ? GRAY : TEAL);
    doc.text(opts.quote ? '›' : '•', MARGIN + 1, cur.y);
    doc.setTextColor(INK);
    lines.forEach((line: string, i: number) => {
      doc.text(line, MARGIN + 6, cur.y);
      if (i < lines.length - 1) cur.y += 5;
    });
    cur.y += 6;
  }
  cur.y += 1;
}

function drawListSection(doc: jsPDF, cur: Cursor, title: string, items: string[] | undefined, opts: { color?: string; quote?: boolean } = {}) {
  const list = (items || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return;
  drawSectionTitle(doc, cur, title, opts.color || TEAL);
  drawBullets(doc, cur, list, { quote: opts.quote, italic: opts.quote });
}

function drawPhotos(doc: jsPDF, cur: Cursor, photos: DossierPhoto[]) {
  if (!photos.length) return;
  drawSectionTitle(doc, cur, 'Fotos de referência da cliente');
  const gap = 6;
  const colW = (CONTENT_W - gap) / 2;
  for (let i = 0; i < photos.length; i += 2) {
    const row = photos.slice(i, i + 2);
    const heights = row.map((p) => Math.min(colW * (p.height / p.width), 110));
    const rowH = Math.max(...heights);
    ensureSpace(doc, cur, rowH + 6);
    row.forEach((p, j) => {
      const h = heights[j];
      const w = Math.min(colW, h * (p.width / p.height));
      const x = MARGIN + j * (colW + gap) + (colW - w) / 2;
      const dataUrl = `data:image/jpeg;base64,${p.jpeg.toString('base64')}`;
      doc.addImage(dataUrl, 'JPEG', x, cur.y, w, h);
    });
    cur.y += rowH + 6;
  }
}

function drawFooters(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setTextColor(GRAY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Dossiê gerado automaticamente pelo CRM — confira os combinados antes do ensaio.', MARGIN, FOOT_Y);
    doc.text(`${i}/${pages}`, PAGE_W - MARGIN, FOOT_Y, { align: 'right' });
  }
}

export function buildDossierPdf(d: DossierPdfInput): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cur: Cursor = { y: MARGIN };
  drawHeader(doc, d, cur);

  const c = d.content || {};
  if (c.resumo && String(c.resumo).trim()) {
    drawSectionTitle(doc, cur, 'Resumo');
    drawParagraph(doc, cur, String(c.resumo).trim());
  }
  drawListSection(doc, cur, 'O que a cliente quer', c.o_que_quer);
  drawListSection(doc, cur, 'Falas de referência', c.falas_referencia, { quote: true });
  drawListSection(doc, cur, 'Preferências', c.preferencias);
  drawListSection(doc, cur, 'Combinados', c.combinados);
  drawListSection(doc, cur, 'Evitar / cuidados', c.evitar, { color: '#b91c1c' });
  drawPhotos(doc, cur, d.photos || []);
  drawFooters(doc);
  return Buffer.from(doc.output('arraybuffer'));
}
