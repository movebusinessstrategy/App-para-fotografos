import assert from 'node:assert/strict';
import test from 'node:test';
import { detectOptOut, normalizeForMatch } from './optout-detect.js';

test('normaliza acento, caixa e espaços', () => {
  assert.equal(normalizeForMatch('  NÃO   me\n mande  MAIS '), 'nao me mande mais');
  assert.equal(normalizeForMatch('NÃO'), 'nao');
});

test('pedidos explícitos de saída são hard', () => {
  for (const text of ['pare de me mandar', 'NÃO me mande mais', 'me tira dessa lista', 'Pare', 'descadastrar']) {
    const found = detectOptOut(text);
    assert.equal(found?.kind, 'hard', text);
    assert.equal(typeof found?.pattern, 'string', text);
  }
  assert.equal(detectOptOut('Pare!!')?.kind, 'hard');
  assert.equal(detectOptOut('por favor não entrem mais em contato')?.kind, 'hard');
});

test('desinteresse é soft', () => {
  for (const text of ['não tenho mais interesse, obrigada', 'já fechei com outra fotógrafa', 'desisti']) {
    assert.equal(detectOptOut(text)?.kind, 'soft', text);
  }
  assert.equal(detectOptOut('não vamos mais fazer')?.kind, 'soft');
});

test('o padrão devolvido é a fonte da regex que casou', () => {
  assert.equal(detectOptOut('desisti')?.pattern, '\\bdesisti\\b');
  assert.equal(detectOptOut('descadastrar')?.pattern, 'descadastr');
});

test('frases comuns de conversa não são opt-out', () => {
  const texts = [
    'não tenho interesse em álbum, só nas digitais',
    'pode parar o carro ali',
    'quero parar de enrolar e fechar logo!',
    'vou ver com meu marido e te falo',
    '',
    '   ',
  ];
  for (const text of texts) assert.equal(detectOptOut(text), null, JSON.stringify(text));
  assert.equal(detectOptOut(null), null);
  assert.equal(detectOptOut(undefined), null);
});

test('texto normalizado com mais de 400 caracteres é ignorado', () => {
  const prefix = 'pare de me mandar ';
  const long = prefix + 'x'.repeat(401 - prefix.length);
  assert.equal(long.length, 401);
  assert.equal(detectOptOut(long), null);
  const limit = prefix + 'x'.repeat(400 - prefix.length);
  assert.equal(detectOptOut(limit)?.kind, 'hard');
});
