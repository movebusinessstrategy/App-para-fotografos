import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TRACKER_CONFIG } from '../src/features/followups/types.js';
import { isQuoteDocument, materialKeysFrom, quoteNameKey, type QuoteCandidate, type QuoteRules } from './quote-document.js';

const MATERIALS = [
  { nome_arquivo: 'GESTANTE 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'gestante' },
  { nome_arquivo: 'NEWBORN 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'newborn' },
  { nome_arquivo: 'PRODUTOS 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'produtos' },
  { nome_arquivo: 'Dicas gestante.pdf', tipo: 'dicas', nicho: 'gestante' },
];

function rules(overrides: Partial<QuoteRules> = {}): QuoteRules {
  return {
    materialKeys: materialKeysFrom(MATERIALS),
    keywords: DEFAULT_TRACKER_CONFIG.quote_keywords,
    exclusions: DEFAULT_TRACKER_CONFIG.quote_exclusions,
    genericPdfIsQuote: DEFAULT_TRACKER_CONFIG.generic_pdf_is_quote,
    ...overrides,
  };
}

function doc(filename: string | null, extra: Partial<QuoteCandidate> = {}): QuoteCandidate {
  return { direction: 'out', type: 'document', filename, body: null, mimeType: 'application/pdf', ...extra };
}

test('chave do nome ignora acento, ano, "(n)" e extensão repetida', () => {
  assert.equal(quoteNameKey('GESTANTE 2025 - Estúdio Pitori..pdf'), 'gestante estudio pitori');
  assert.equal(quoteNameKey('gestante 2026 - estúdio pitori (1).pdf'), 'gestante estudio pitori');
  assert.equal(quoteNameKey('arquivo.pdf.pdf'), 'arquivo');
  assert.equal(quoteNameKey('CATALOGO DE 1 ANO (1) (1).pdf'), 'catalogo de ano');
  assert.equal(quoteNameKey('ESTÚDIO'), 'estudio');
  assert.equal(quoteNameKey(null), '');
  assert.equal(quoteNameKey('2026.pdf'), '');
});

test('materiais de orçamento: só tipo pacote e fora do nicho de produtos', () => {
  assert.deepEqual([...materialKeysFrom(MATERIALS)].sort(), ['gestante estudio pitori', 'newborn estudio pitori']);
  assert.equal(materialKeysFrom([{ nome_arquivo: null, tipo: 'pacote', nicho: 'gestante' }]).size, 0);
});

test('reconhece orçamentos pelo material ou pela palavra-chave', () => {
  for (const name of [
    'GESTANTE 2025 - Estúdio Pitori..pdf',
    'gestante 2026 - estúdio pitori (1).pdf',
    'Newborn 2026 - Estudio Pitori.pdf',
    'Orçamento X.pdf',
  ]) {
    assert.equal(isQuoteDocument(doc(name), rules()), true, name);
    assert.equal(isQuoteDocument(doc(name.normalize('NFD')), rules()), true, `NFD ${name}`);
  }
});

test('material gravado em Unicode decomposto também casa', () => {
  const nfdRules = rules({
    materialKeys: materialKeysFrom([{ nome_arquivo: 'GESTANTE 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'gestante' }]),
  });
  assert.equal(isQuoteDocument(doc('GESTANTE 2025 - Estúdio Pitori..pdf'), nfdRules), true);
  assert.equal(isQuoteDocument(doc('GESTANTE 2025 - Estúdio Pitori..pdf'), nfdRules), true);
});

test('variações reais de nome enviadas pelo WhatsApp casam com o material', () => {
  const real = rules({
    materialKeys: materialKeysFrom([
      { nome_arquivo: 'CASAL 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'casal' },
      { nome_arquivo: 'BATIZADO 2026 - ESTUDIO PITORI.pdf', tipo: 'pacote', nicho: 'batizado' },
      { nome_arquivo: 'ANIVERSÁRIO 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'aniversario' },
      { nome_arquivo: 'GESTANTE 2026 - ESTÚDIO PITORI.pdf', tipo: 'pacote', nicho: 'gestante' },
    ]),
  });
  for (const name of [
    'CASAL 2026 - ESTÚDIO PITORI .pdf',
    'BATIZADO 2026 -  ESTUDIO PITORI.pdf',
    'ANIVERSÁRIO 2026 - ESTÚDIO PITORI (1)',
    '01 GESTANTE 2026 - ESTÚDIO PITORI.pdf',
  ]) {
    assert.equal(isQuoteDocument(doc(null, { body: name.normalize('NFD') }), real), true, name);
  }
});

test('dicas, catálogo, comprovante, imagem e entrada não são orçamento', () => {
  for (const name of [
    'Dicas gestante.pdf',
    'PRODUTOS 2026 - ESTUDIO PITORI.pdf',
    'CATALOGO DE 1 ANO (1) (1).pdf',
    'COMPROVANTE-BOLETO-ITAU.pdf',
  ]) {
    assert.equal(isQuoteDocument(doc(name), rules()), false, name);
  }
  assert.equal(isQuoteDocument(doc('Orçamento X.jpg', { type: 'image', mimeType: 'image/jpeg' }), rules()), false);
  assert.equal(isQuoteDocument(doc('Orçamento X.pdf', { direction: 'in' }), rules()), false);
  assert.equal(isQuoteDocument(doc('Orçamento X.pdf', { direction: 'in', quoteHint: true }), rules()), false);
  assert.equal(isQuoteDocument(doc('Contrato pacote gestante.pdf'), rules()), false);
  assert.equal(isQuoteDocument(doc('Nota fiscal pacote.pdf'), rules()), false);
});

test('PDF genérico só conta com genericPdfIsQuote', () => {
  const name = 'DIA DOS PAIS 2026 (1).pdf';
  assert.equal(isQuoteDocument(doc(name), rules()), false);
  assert.equal(isQuoteDocument(doc(name), rules({ genericPdfIsQuote: true })), true);
  assert.equal(isQuoteDocument(doc(name, { mimeType: null }), rules({ genericPdfIsQuote: true })), true);
  assert.equal(isQuoteDocument(doc('DIA DOS PAIS..pdf', { mimeType: null }), rules({ genericPdfIsQuote: true })), true);
  assert.equal(isQuoteDocument(doc('DIA DOS PAIS.docx', { mimeType: null }), rules({ genericPdfIsQuote: true })), false);
});

test('quoteHint marca orçamento mesmo em mensagem de texto', () => {
  const text: QuoteCandidate = { direction: 'out', type: 'text', filename: null, body: 'segue', mimeType: null, quoteHint: true };
  assert.equal(isQuoteDocument(text, rules()), true);
  assert.equal(isQuoteDocument({ ...text, quoteHint: false }, rules()), false);
});

test('o nome do arquivo tem prioridade sobre o texto', () => {
  assert.equal(isQuoteDocument(doc('Dicas gestante.pdf', { body: 'Orçamento gestante' }), rules()), false);
  assert.equal(isQuoteDocument(doc('Orçamento gestante.pdf', { body: 'dicas' }), rules()), true);
  assert.equal(isQuoteDocument(doc(null, { body: 'Orçamento gestante.pdf' }), rules()), true);
  assert.equal(isQuoteDocument(doc(null, { body: null }), rules()), false);
});
