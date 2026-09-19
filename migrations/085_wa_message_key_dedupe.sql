-- 085 Dedupe entre canais (Meta x Baileys) pelo id de chave embutido no wamid.
--
-- OPCIONAL. Pré-requisito de allow_baileys=true: o PUT /api/followups/config
-- sonda rpc('wa_message_key_id') e recusa o QR sem esta função.
--
-- Por quê: em coexistência, a mensagem enviada pelo aparelho (Baileys) volta pela
-- Meta como smb_message_echo com wamid. O UNIQUE (user_id, message_id) não pega
-- porque os ids são diferentes, e o dedupe exato do runtime exige o mesmo
-- timestamp, o que não acontece entre canais. Sem isso: bolha dupla,
-- markHumanActive indevido (desliga a Aurora para o cliente) e fala humana falsa
-- no rastreador do funil.
--
-- O wamid é base64 de uma struct Thrift Compact do MessageKey do WhatsApp:
--   1C 18 LL <remote> 15 XX 00 (11|12) 18 LL <key.id> 00
-- remote = telefone do cliente ou 'BR.<id>' (ecos do app); 11 = fromMe, 12 = recebida.
-- key.id é o mesmo id que o Baileys grava em message_id. O formato não é
-- documentado pela Meta: qualquer falha devolve o próprio valor (sem dedupe,
-- mas nada quebra). Espelho em TS: lib/whatsapp-message-key.ts (mesmo algoritmo).
--
-- COMO APLICAR (SQL Editor, em 3 execuções separadas):
--   1. Rode o bloco begin ... commit abaixo (função + grants). Pode repetir.
--   2. Rode a pré-checagem (comentada no meio do arquivo). Tem que voltar 0 linhas.
--      Se voltar alguma, NÃO crie o índice: mande as linhas para revisão.
--   3. Selecione SÓ o create unique index concurrently e rode sozinho, fora de
--      transação e fora do pico. Junto com outros comandos na mesma execução o
--      Postgres recusa ("cannot run inside a transaction block").
--
-- Exige Postgres 17 (produção é 17). A função tem bloco EXCEPTION e é PARALLEL
-- SAFE; no 16 ou anterior, uma consulta paralela que a chame falha com
-- "cannot start subtransactions during a parallel operation".
--
-- ROLLBACK: drop index if exists public.wa_messages_key_id_uidx;
--   (a função pode ficar; sem o índice ela não muda nada. Para removê-la também:
--    drop function if exists public.wa_message_key_id(text); mas aí o PUT volta
--    a recusar allow_baileys.)

begin;

create or replace function public.wa_message_key_id(raw text)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  b64 text;
  bytes bytea;
  remote_len integer;
  rest bytea;
  field_at integer;
  key_len integer;
  c integer;
  key_id text := '';
begin
  if raw is null or raw !~ '^wamid\.[A-Za-z0-9+/_-]+={0,2}$' then
    return raw;
  end if;
  b64 := translate(rtrim(substr(raw, 7), '='), '-_', '+/');
  if length(b64) % 4 = 1 then
    return raw;
  end if;
  bytes := decode(rpad(b64, ((length(b64) + 3) / 4) * 4, '='), 'base64');
  if length(bytes) < 3 or get_byte(bytes, 0) <> 28 or get_byte(bytes, 1) <> 24 then
    return raw;
  end if;
  -- pula o remote (tamanho em 1 byte: remote nunca passa de 127)
  remote_len := get_byte(bytes, 2);
  if remote_len > 127 then
    return raw;
  end if;
  rest := substring(bytes from 4 + remote_len);
  -- próximo 0x18 depois do remote = campo key.id
  field_at := position('\x18'::bytea in rest);
  if field_at = 0 or field_at >= length(rest) then
    return raw;
  end if;
  key_len := get_byte(rest, field_at);
  if key_len < 8 or key_len > 64 or field_at + 1 + key_len > length(rest) then
    return raw;
  end if;
  for i in field_at + 1 .. field_at + key_len loop
    c := get_byte(rest, i);
    if c < 33 or c > 126 then
      return raw;
    end if;
    key_id := key_id || chr(c);
  end loop;
  return key_id;
exception when others then
  return raw;
end
$fn$;

comment on function public.wa_message_key_id(text) is
  '085: key.id embutido no wamid da Meta (= message_id do Baileys), qualquer outro valor volta igual. Espelho: lib/whatsapp-message-key.ts';

-- Sem REVOKE de PUBLIC de propósito: a função é pura (não lê tabela) e o índice
-- abaixo a avalia com o papel de quem insere em wa_messages; sem EXECUTE, o
-- INSERT falharia com "permission denied for function".
grant execute on function public.wa_message_key_id(text) to service_role;
grant execute on function public.wa_message_key_id(text) to authenticated;

commit;

-- PRÉ-CHECAGEM (passo 2; depois do bloco acima, antes do índice). Tem que voltar 0 linhas:
-- select user_id, public.wa_message_key_id(message_id), count(*)
--   from public.wa_messages where message_id is not null
--  group by 1, 2 having count(*) > 1 limit 20;

-- PASSO 3: rodar SOZINHO, fora de transação, fora do pico.
-- Se uma tentativa anterior falhou no meio, o índice fica INVALID e o
-- "if not exists" pula em silêncio. Conferir depois:
--   select indisvalid from pg_index where indexrelid = 'public.wa_messages_key_id_uidx'::regclass;
-- Se vier false: drop index concurrently public.wa_messages_key_id_uidx; e rodar de novo.
create unique index concurrently if not exists wa_messages_key_id_uidx
  on public.wa_messages (user_id, public.wa_message_key_id(message_id))
  where message_id is not null;

-- NOTA: com o índice, o INSERT do handler Baileys recebe 23505 quando a Meta
-- gravou a mesma mensagem antes (e vice-versa no runtime Meta, que já trata a
-- duplicata sem atualizar conversa, sem scheduleReply e sem markHumanActive).
-- O scheduleAutonomousReply do handler Baileys (server.ts:28581-28584) roda mesmo
-- em duplicata: revisar o debounce (ou somar && !messageWasDuplicate) antes de
-- ligar o QR.
