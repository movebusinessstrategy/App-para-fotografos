import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadDossierLogo, usesPitoriDossierBrand } from './dossier-brand.js';

const legacy = 'https://drive.google.com/file/d/1WzWueHNV_hL3ANvUcr-VzQO-gZgmiVnM/view?usp=sharing';
test('marca aprovada do Pitori usa PNG transparente e dispensa a pagina do Drive', async () => {
  const logo = await loadDossierLogo('Estúdio Pitori', legacy, async () => { throw new Error('Não deve baixar HTML'); });
  assert.ok(logo);
  assert.equal((await sharp(logo.png).metadata()).hasAlpha, true);
  assert.ok(logo.width > logo.height);
});
test('preserva a marca de outros estudios e futuros arquivos do Pitori', () => {
  assert.equal(usesPitoriDossierBrand('Outro estúdio', legacy), false);
  assert.equal(usesPitoriDossierBrand('Estúdio Pitori', 'https://example.com/logo.png'), false);
  assert.equal(usesPitoriDossierBrand('Estúdio Pitori', legacy.replace('drive.google.com', 'example.com')), false);
});
