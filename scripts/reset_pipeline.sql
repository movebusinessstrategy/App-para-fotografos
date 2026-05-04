-- ============================================================
-- RESET TOTAL — limpa Vendas + Produção + Clientes + dados derivados
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- ⚠️ DESTRUTIVO. Sem volta. Use apenas pra começar do zero.
-- Não toca em: studio_settings (config empresa + chave Autentique),
--               deal_stages (etapas do funil), production_processes,
--               wa_conversations, wa_messages
-- ============================================================

-- 1) UUID do user (se não for o seu, troque):

DO $$
DECLARE
  target_user TEXT := 'b6608c80-b993-444e-8ba8-ddde5bd18ac0';  -- Luan (do log do Baileys)
  jobs_count INT;
  deals_count INT;
  opps_count INT;
  clients_count INT;
  contracts_count INT;
BEGIN
  IF target_user = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Você precisa trocar o target_user pelo seu UUID antes de rodar.';
  END IF;

  -- Contagem antes (pra log)
  -- Cast `user_id::text` em ambos os lados pra funcionar tanto pra colunas UUID
  -- quanto TEXT (banco tem mistura dos dois tipos historicamente)
  SELECT count(*) INTO jobs_count      FROM jobs           WHERE user_id::text = target_user;
  SELECT count(*) INTO deals_count     FROM deals          WHERE user_id::text = target_user;
  SELECT count(*) INTO opps_count      FROM opportunities  WHERE user_id::text = target_user;
  SELECT count(*) INTO contracts_count FROM contracts      WHERE user_id::text = target_user;
  SELECT count(*) INTO clients_count   FROM clients        WHERE user_id::text = target_user;

  RAISE NOTICE 'Antes: % clientes, % jobs, % deals, % contratos, % oportunidades',
    clients_count, jobs_count, deals_count, contracts_count, opps_count;

  -- ── PRODUÇÃO ────────────────────────────────────────────────────────────
  DELETE FROM job_payments
    WHERE job_id IN (SELECT id FROM jobs WHERE user_id::text = target_user);

  DELETE FROM job_stage_history
    WHERE job_id IN (SELECT id FROM jobs WHERE user_id::text = target_user);

  DELETE FROM contracts WHERE user_id::text = target_user;

  DELETE FROM jobs WHERE user_id::text = target_user;

  -- ── VENDAS ──────────────────────────────────────────────────────────────
  DELETE FROM deal_items
    WHERE deal_id IN (SELECT id FROM deals WHERE user_id::text = target_user);

  DELETE FROM deals WHERE user_id::text = target_user;

  -- ── OPORTUNIDADES INTERNAS ──────────────────────────────────────────────
  DELETE FROM opportunities WHERE user_id::text = target_user;

  -- ── CLIENTES ────────────────────────────────────────────────────────────
  DELETE FROM clients WHERE user_id::text = target_user;

  RAISE NOTICE '✅ Reset concluído. Apagados: % clientes, % jobs, % deals, % contratos, % oportunidades',
    clients_count, jobs_count, deals_count, contracts_count, opps_count;
END $$;

-- ============================================================
-- Depois de rodar:
--   • Clientes (/clients)        → vazio (importar via CSV no botão da página)
--   • Funil de Vendas (/vendas)  → vazio
--   • Kanban de Produção (/jobs) → vazio
--   • Aba Lista de Trabalhos     → vazia
--   • Contratos                  → vazio
--   • Oportunidades internas     → vazio
--
-- Pra subir os clientes novos:
--   /clients → ícone de upload no header → escolhe o CSV
-- ============================================================
