-- 074: permite uma credencial Google por tenant.
--
-- A tabela antiga nasceu como singleton e ainda carregava CHECK (id = 1).
-- Depois que google_auth passou a aceitar uma linha por user_id, essa trava
-- recusava a segunda conta com "Erro ao salvar credenciais Google".
-- A UNIQUE(user_id) da migration 061 continua garantindo uma só conexão por
-- tenant; o id segue sendo gerado pela sequence criada na migration 062.

ALTER TABLE public.google_auth
DROP CONSTRAINT IF EXISTS google_auth_id_check;
