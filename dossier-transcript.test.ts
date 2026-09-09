import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDossierTranscript, pickDossierPhotoIds } from './dossier-transcript.js';

test('inclui descricoes das fotos sem legenda e diferencia prints de referencias', () => {
  const transcript = buildDossierTranscript([
    { message_id: 'choice', from_me: false, type: 'text', body: 'Vou mandar fotos que gosto.' },
    { message_id: 'reference', from_me: false, type: 'image', body: '', transcription: 'Foto de gestante em jardim.' },
    { message_id: 'package', from_me: false, type: 'image', body: 'Esse pacote', transcription: 'Print do catálogo Premium 02.' },
    { message_id: 'receipt', from_me: false, type: 'image', transcription: 'Comprovante de pagamento.' },
  ]);
  assert.match(transcript, /\[#1\] CLIENTE: \[FOTO\]\n/);
  assert.match(transcript, /não é uma fala da cliente/);
  assert.match(transcript, /Foto de gestante em jardim/);
  assert.match(transcript, /Print do catálogo Premium 02/);
  assert.match(transcript, /Comprovante de pagamento/);
});
test('preserva indices originais ao omitir mensagens vazias e inclui audio transcrito', () => {
  const transcript = buildDossierTranscript([
    { message_id: 'empty', from_me: false, type: 'text', body: '' },
    { message_id: 'audio', from_me: false, type: 'audio', transcription: 'Prefiro o jardim.' },
    { message_id: 'photo', from_me: false, type: 'image' },
  ]);
  assert.match(transcript, /\[#1\] CLIENTE: \[AUDIO\]/);
  assert.match(transcript, /Prefiro o jardim/);
  assert.match(transcript, /\[#2\] CLIENTE: \[FOTO\]/);
});
test('seleciona somente imagens da cliente e nao perde nenhuma de uma sequencia', () => {
  const photos = Array.from({ length: 9 }, (_, i) => ({ message_id: `photo-${i}`, from_me: false, type: 'image' }));
  const messages = [...photos, { message_id: 'studio', from_me: true, type: 'image' }, { message_id: 'text', from_me: false, type: 'text' }];
  assert.deepEqual(pickDossierPhotoIds(messages, [0,1,2,3,4,5,6,7,8,8,9,10,-1,1.5,999]), photos.map(p => p.message_id));
});
