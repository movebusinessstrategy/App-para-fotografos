import test from 'node:test';
import assert from 'node:assert/strict';

await import('./whatsapp-extension/chat-identity.js');

const {
  canonicalChatJid,
  phoneFromCanonicalJid,
  isUnsupportedChatJid,
  preferredCanonicalChatJid,
  resolvePhone,
  mutationGuardDecision,
} = globalThis.FocalPointChatIdentity;

test('normaliza o JID sem incorporar prefixos mutáveis do data-id', () => {
  assert.equal(canonicalChatJid('false_5511988880000@c.us_MSG'), '5511988880000@c.us');
  assert.equal(canonicalChatJid('true_5511988880000@c.us_MSG'), '5511988880000@c.us');
  assert.equal(canonicalChatJid('5511988880000@s.whatsapp.net'), '5511988880000@s.whatsapp.net');
  assert.equal(canonicalChatJid('5511988880000@lid'), '5511988880000@lid');
  assert.equal(canonicalChatJid('preview 5511988880000@c.us'), '');
  assert.equal(canonicalChatJid(''), '');
  assert.equal(phoneFromCanonicalJid('5511988880000@c.us'), '5511988880000');
  assert.equal(phoneFromCanonicalJid('5511988880000@s.whatsapp.net'), '5511988880000');
  assert.equal(phoneFromCanonicalJid('5511988880000@lid'), '');
});

test('reconhece grupos e broadcast antes de qualquer JID de participante', () => {
  const groupDataId = 'false_120363123456789@g.us_MSG_5511988880000@c.us';
  const invertedDataId = 'false_5511988880000@c.us_MSG_120363123456789@g.us';
  assert.equal(canonicalChatJid(groupDataId), '120363123456789@g.us');
  assert.equal(canonicalChatJid(invertedDataId), '120363123456789@g.us');
  assert.equal(canonicalChatJid('status@broadcast'), 'status@broadcast');
  assert.equal(phoneFromCanonicalJid(groupDataId), '');
  assert.equal(isUnsupportedChatJid(groupDataId), true);
  assert.equal(isUnsupportedChatJid(invertedDataId), true);
  assert.equal(isUnsupportedChatJid('5511988880000@c.us'), false);
  assert.equal(preferredCanonicalChatJid([
    '5511988880000@c.us',
    '120363123456789@g.us',
  ]), '120363123456789@g.us');
});

test('usa a ancora quando o DOM ainda aponta para a conversa anterior', () => {
  const result = resolvePhone({
    rawPhone: '5511999990000',
    fallbackPhone: '5511988880000',
    anchorPhone: '5511988880000',
    rejectedPhones: new Set(['5511999990000']),
  });

  assert.deepEqual(result, {
    phone: '5511988880000',
    source: 'anchor',
    rawRejected: true,
  });
});

test('mantem o DOM atual quando ele nao foi rejeitado pela ancora', () => {
  const result = resolvePhone({
    rawPhone: '5511977770000',
    fallbackPhone: '5511988880000',
    anchorPhone: '5511988880000',
    rejectedPhones: new Set(),
  });

  assert.equal(result.phone, '5511977770000');
  assert.equal(result.source, 'dom');
});

test('usa a ancora quando o WhatsApp esconde o telefone do contato', () => {
  const result = resolvePhone({
    rawPhone: '',
    fallbackPhone: '5511999990000',
    anchorPhone: '5511988880000',
  });

  assert.equal(result.phone, '5511988880000');
  assert.equal(result.source, 'anchor');
});

test('cai no estado resolvido somente quando DOM e ancora estao ausentes', () => {
  const result = resolvePhone({ rawPhone: '', fallbackPhone: '5511988880000' });

  assert.equal(result.phone, '5511988880000');
  assert.equal(result.source, 'state');
});

test('bloqueia quando outra conversa foi selecionada antes do observer atualizar', () => {
  assert.equal(mutationGuardDecision({
    expectedOpaqueId: '111@lid',
    currentOpaqueId: '222@lid',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-b',
  }), 'deny');
});

test('exige confirmacao quando a faixa nasceu de uma ancora baseada apenas no nome', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '111@lid',
    currentOpaqueId: '111@lid',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-a',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: false,
  });

  assert.equal(result, 'confirm');
});

test('exige confirmacao se nome e selecao ainda estiverem vazios na transicao', () => {
  const result = mutationGuardDecision({
    expectedSelectionToken: '',
    currentSelectionToken: '',
    currentNamePresent: false,
    namesCompatible: true,
  });

  assert.equal(result, 'confirm');
});

test('nao deixa o mesmo token dominar um telefone atual incompatível', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '111@lid',
    currentOpaqueId: '111@lid',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-a',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: true,
    phoneMatches: false,
  });

  assert.equal(result, 'deny');
});

test('aceita rerender com token novo quando a identidade opaca e o telefone continuam iguais', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '111@lid',
    currentOpaqueId: '111@lid',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-a-rerender',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: true,
    phoneMatches: true,
  });

  assert.equal(result, 'allow');
});

test('sem identidade opaca nem telefone, token novo exige confirmacao do drawer', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '',
    currentOpaqueId: '',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-b',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: false,
  });

  assert.equal(result, 'confirm');
});

test('nome atual incompatível nega mesmo se o telefone do DOM ainda parece igual', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '111@lid',
    currentOpaqueId: '111@lid',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-a',
    currentNamePresent: true,
    namesCompatible: false,
    currentPhoneTrusted: true,
    phoneMatches: true,
  });

  assert.equal(result, 'deny');
});

test('ID opaco temporariamente ausente cai em confirmacao em vez de negar o mesmo chat', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '5511988880000@lid',
    currentOpaqueId: '',
    expectedSelectionToken: 'chat-a',
    currentSelectionToken: 'chat-a-rerender',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: false,
  });

  assert.equal(result, 'confirm');
});

test('header vazio nao bloqueia telefone e JID fortes do mesmo chat', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '5511988880000@c.us',
    currentOpaqueId: '5511988880000@c.us',
    currentNamePresent: false,
    namesCompatible: false,
    currentPhoneTrusted: true,
    phoneMatches: true,
  });

  assert.equal(result, 'allow');
});

test('grupo nunca autoriza mutacao de um participante individual', () => {
  const result = mutationGuardDecision({
    expectedOpaqueId: '120363123456789@g.us',
    currentOpaqueId: '120363123456789@g.us',
    currentNamePresent: true,
    namesCompatible: true,
    currentPhoneTrusted: true,
    phoneMatches: true,
    currentChatUnsupported: true,
  });

  assert.equal(result, 'deny');
});
