-- 061: google_auth — trava de 1 linha por conta (UNIQUE em user_id)
--
-- A PK da tabela é `id` e user_id NÃO tinha UNIQUE. Na prática o upsert do
-- callback atualiza a linha existente (verificado ao vivo — não acumulava
-- duplicata), mas isso depende do comportamento do PostgREST e não estava
-- garantido no banco. Esta constraint torna o invariante explícito: uma única
-- conexão Google por conta, sem depender do driver.
--
-- O servidor já lê com limit(1)/count e o callback já grava com delete+insert,
-- então nada quebra antes ou depois desta migration.

-- 1) Se por acaso existir duplicata, preserva a conexão mais recente (maior id)
DELETE FROM google_auth a
USING google_auth b
WHERE a.user_id = b.user_id
  AND a.id < b.id;

-- 2) Trava: uma conexão Google por conta
ALTER TABLE google_auth
  ADD CONSTRAINT google_auth_user_id_unique UNIQUE (user_id);
