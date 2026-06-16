-- 041_perf_indexes.sql — Índices de performance (o maior ganho por R$ 0).
-- Rode no SQL Editor do Supabase. Idempotente e À PROVA DE FALHA: cada índice é
-- criado isoladamente; se a tabela/coluna não existir nessa conta, ele é PULADO
-- (não aborta o resto). Reduz buscas que varrem a tabela inteira (Seq Scan).
--
-- Depois de rodar, dá pra conferir um caso com:
--   EXPLAIN ANALYZE SELECT * FROM deals WHERE user_id = '...' ORDER BY stage;
-- (deve aparecer "Index Scan", não "Seq Scan").

DO $$
DECLARE
  idx RECORD;
BEGIN
  FOR idx IN
    SELECT * FROM (VALUES
      -- Vendas / pipeline
      ('idx_deals_user_id',            'deals',            '(user_id)'),
      ('idx_deals_user_stage',         'deals',            '(user_id, stage)'),
      ('idx_deals_converted_job',      'deals',            '(converted_job_id)'),
      ('idx_deal_items_deal_id',       'deal_items',       '(deal_id)'),
      -- Produção / agenda
      ('idx_jobs_user_job_date',       'jobs',             '(user_id, job_date DESC)'),
      ('idx_jobs_user_prod_stage',     'jobs',             '(user_id, production_stage)'),
      ('idx_jobs_client_id',           'jobs',             '(client_id)'),
      -- Clientes / oportunidades
      ('idx_clients_user_id',          'clients',          '(user_id)'),
      ('idx_opportunities_user_id',    'opportunities',    '(user_id)'),
      ('idx_opportunities_client',     'opportunities',    '(client_id)'),
      -- WhatsApp (tabelas que mais crescem)
      ('idx_wa_conv_user_lastmsg',     'wa_conversations', '(user_id, last_message_at DESC)'),
      ('idx_wa_conv_user_phone',       'wa_conversations', '(user_id, phone)'),
      ('idx_wa_conv_user_wanumber',    'wa_conversations', '(user_id, wa_number)'),
      ('idx_wa_msgs_user_phone',       'wa_messages',      '(user_id, phone)'),
      ('idx_wa_msgs_user_created',     'wa_messages',      '(user_id, created_at)'),
      ('idx_wa_msgs_message_id',       'wa_messages',      '(message_id)'),
      -- Tarefas (inclui padrões / subtarefas)
      ('idx_tasks_user_id',            'tasks',            '(user_id)'),
      ('idx_tasks_job_id',             'tasks',            '(job_id)'),
      ('idx_tasks_parent',             'tasks',            '(parent_task_id)'),
      ('idx_tasks_template',           'tasks',            '(template_id)'),
      -- Financeiro
      ('idx_fin_receitas_user_status', 'fin_receitas',     '(user_id, status)'),
      ('idx_fin_despesas_user_status', 'fin_despesas',     '(user_id, status)'),
      -- Contratos
      ('idx_contracts_user_id',        'contracts',        '(user_id)'),
      ('idx_contract_templates_user',  'contract_templates','(user_id)'),
      -- Galeria
      ('idx_gallery_photos_gallery',   'gallery_photos',   '(gallery_id)'),
      ('idx_gallery_sel_gallery',      'gallery_selections','(gallery_id)'),
      ('idx_galleries_user_id',        'galleries',        '(user_id)'),
      -- Álbum
      ('idx_album_assets_album',       'album_assets',     '(album_id)'),
      ('idx_album_spreads_album',      'album_spreads',    '(album_id)'),
      ('idx_album_projects_user',      'album_projects',   '(user_id)')
    ) AS t(name, tbl, cols)
  LOOP
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I %s', idx.name, idx.tbl, idx.cols);
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        RAISE NOTICE 'pulado % (tabela/coluna inexistente)', idx.name;
      WHEN others THEN
        RAISE NOTICE 'pulado % (%).', idx.name, SQLERRM;
    END;
  END LOOP;
END $$;

-- Atualiza as estatísticas pro planner usar os índices novos imediatamente.
ANALYZE;
