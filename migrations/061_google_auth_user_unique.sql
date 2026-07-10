-- 061: google_auth — 1 linha por conta (UNIQUE em user_id)
--
-- A PK da tabela é `id` e user_id NÃO tinha UNIQUE. O upsert do callback do
-- OAuth (sem onConflict) conflitava na PK — que nunca conflita — então cada
-- clique em "Conectar" INSERIA uma linha nova. Com 2+ linhas, as leituras com
-- .single()/.maybeSingle() erravam e a sincronização do Google Calendar morria
-- em silêncio, com a tela mostrando "Desconectado" mesmo com tokens salvos.
--
-- O servidor já foi corrigido (delete+insert no callback e leituras com
-- limit(1)), então NADA quebra antes ou depois desta migration — ela é a trava
-- de banco pra garantir que duplicata nunca mais entre.

-- 1) Remove duplicatas existentes, preservando a conexão mais recente (maior id)
DELETE FROM google_auth a
USING google_auth b
WHERE a.user_id = b.user_id
  AND a.id < b.id;

-- 2) Trava: uma conexão Google por conta
ALTER TABLE google_auth
  ADD CONSTRAINT google_auth_user_id_unique UNIQUE (user_id);
