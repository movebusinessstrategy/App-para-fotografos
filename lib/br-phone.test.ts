import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baileysJid,
  brazilianPhoneVariants,
  canonicalPhoneKey,
  digitsOnly,
  maskPhone,
  normalizeBrazilianPhone13,
  samePhone,
} from './br-phone.js';

const FORMS = ['5543996817638', '554396817638', '43996817638', '4396817638', '+55 (43) 99681-7638'];

test('todas as formas do mesmo celular têm a mesma chave e as duas variantes', () => {
  for (const form of FORMS) {
    assert.equal(canonicalPhoneKey(form), '554396817638', form);
    const variants = brazilianPhoneVariants(form);
    assert.ok(variants.includes('5543996817638'), form);
    assert.ok(variants.includes('554396817638'), form);
  }
});

test('chave de 11 dígitos começando com 55 recebe o prefixo do país', () => {
  assert.equal(canonicalPhoneKey('55991234567'), '555591234567');
});

test('entrada vazia devolve lista e chave vazias', () => {
  assert.deepEqual(brazilianPhoneVariants(''), []);
  assert.deepEqual(brazilianPhoneVariants(null), []);
  assert.equal(canonicalPhoneKey(''), '');
  assert.equal(canonicalPhoneKey(undefined), '');
  assert.equal(digitsOnly(null), '');
  assert.equal(normalizeBrazilianPhone13(''), '');
});

test('normaliza para 13 dígitos', () => {
  assert.equal(normalizeBrazilianPhone13('554396817638'), '5543996817638');
  assert.equal(normalizeBrazilianPhone13('5543996817638'), '5543996817638');
  assert.equal(normalizeBrazilianPhone13('43996817638'), '5543996817638');
  assert.equal(normalizeBrazilianPhone13('4396817638'), '5543996817638');
  assert.equal(normalizeBrazilianPhone13('+55 (43) 99681-7638'), '5543996817638');
  assert.equal(normalizeBrazilianPhone13('55123'), '55123');
  assert.equal(normalizeBrazilianPhone13('123'), '123');
});

test('variantes seguem a ordem de inserção do servidor e não repetem', () => {
  assert.deepEqual(brazilianPhoneVariants('5543996817638'), [
    '5543996817638', '43996817638', '4396817638', '554396817638',
  ]);
  assert.deepEqual(brazilianPhoneVariants('554396817638'), [
    '554396817638', '4396817638', '43996817638', '5543996817638',
  ]);
  const variants = brazilianPhoneVariants('4396817638');
  assert.equal(new Set(variants).size, variants.length);
});

test('JID do Baileys', () => {
  assert.equal(baileysJid('5543996817638', []), '554396817638');
  assert.equal(baileysJid('5511987654321', []), '5511987654321');
  assert.equal(baileysJid('5511987654321', ['551187654321']), '551187654321');
  assert.equal(baileysJid('5543996817638', ['5511987654321']), '554396817638');
  assert.equal(baileysJid('554396817638', []), '554396817638');
});

test('samePhone compara pelas variantes', () => {
  assert.equal(samePhone('554396817638', '5543996817638'), true);
  assert.equal(samePhone('+55 43 99681-7638', '4396817638'), true);
  assert.equal(samePhone('5543996817638', '5511987654321'), false);
  assert.equal(samePhone('', ''), false);
});

test('máscara mostra só os 4 últimos dígitos', () => {
  assert.equal(maskPhone('5543996817638'), '…7638');
  assert.equal(maskPhone('123'), '…');
  assert.equal(maskPhone(null), '…');
});
