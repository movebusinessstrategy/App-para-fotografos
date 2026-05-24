-- ============================================================================
-- 020_default_contract_template_flag
--
-- Flag que marca se já provisionamos o modelo de contrato padrão genérico
-- pro usuário. Setada na primeira chamada do GET /api/contract-templates.
-- Se o usuário apaga o modelo padrão depois, ele NÃO é recriado.
--
-- Rode no SQL Editor do Supabase. Idempotente.
-- ============================================================================

alter table studio_settings
  add column if not exists default_template_provisioned boolean not null default false;

-- Para contas que JÁ TÊM modelos cadastrados, marca como provisionada pra
-- não ter o auto-provision pendurado pra elas (que poderia adicionar 1
-- modelo extra em conta que já curou os próprios).
update studio_settings ss
set default_template_provisioned = true
where exists (
  select 1 from contract_templates ct where ct.user_id = ss.user_id
);
