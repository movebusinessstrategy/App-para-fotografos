import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverDossierPhotos, loadDossierConversationPhotos } from './dossier-media.js';
const photo = (id: string, transcription = 'Foto de gestante com vestido claro.') => ({ message_id: id, from_me: false, type: 'image', transcription });
test('dossie antigo com lista vazia recupera fotos sem nova chamada de IA', () => {
  const result = recoverDossierPhotos({ reference_photo_ids: [] }, [photo('a'),photo('b')]);
  assert.deepEqual(result.reference_photo_ids, ['a','b']);
  assert.deepEqual(result.excluded_reference_ids, []);
});
test('comprovantes, documentos, catalogos e imagens do estudio ficam fora', () => {
  const result = recoverDossierPhotos({ reference_photo_ids: ['receipt'], payment_photo_ids: ['paid'] }, [
    photo('receipt','Comprovante de transferência Pix.'),photo('id','Print de autenticação e identidade.'),
    photo('catalog','Print do pacote Premium.'),photo('paid'),{...photo('studio'),from_me:true},photo('good'),
  ]);
  assert.deepEqual(result.reference_photo_ids,['good']);
});
test('foto sem descricao aparece para conferir mas nao entra automaticamente no PDF', () => {
  const result = recoverDossierPhotos({},[photo('unknown','')]);
  assert.deepEqual(result.reference_photo_ids,['unknown']);
  assert.deepEqual(result.excluded_reference_ids,['unknown']);
  assert.deepEqual(result.reference_review_ids,['unknown']);
});
test('selecao e exclusoes da equipe sobrevivem a novas leituras', () => {
  const result = recoverDossierPhotos({reference_photo_ids:['unknown','a'],excluded_reference_ids:['a']},[photo('unknown',''),photo('a'),photo('b')]);
  assert.deepEqual(result.excluded_reference_ids,['a']);
  assert.deepEqual(result.reference_photo_ids,['unknown','a','b']);
});
test('consulta das fotos respeita dono, telefone e limite do historico',async()=>{
  const calls: unknown[]=[];
  const query:any={select:(...a:unknown[])=>{calls.push(['select',...a]);return query;},eq:(...a:unknown[])=>{calls.push(['eq',...a]);return query;},in:(...a:unknown[])=>{calls.push(['in',...a]);return query;},order:()=>query,limit:async(n:number)=>{calls.push(['limit',n]);return {data:[photo('a')],error:null};}};
  const db:any={from:(table:string)=>{assert.equal(table,'wa_messages');return query;}};
  const result=await loadDossierConversationPhotos(db,'owner',{status:'ready',content:{}},['phone']);
  assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['eq','user_id','owner'])));
  assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['in','phone',['phone']])));
  assert.deepEqual(result.content.reference_photo_ids,['a']);
});
