-- ============================================================================
-- Ajusta limite do plano Pro: 2 vendedores (era 5).
-- Idempotente — pode rodar várias vezes sem efeito.
-- ============================================================================

update platform_plans
   set limits = jsonb_set(limits, '{max_team_members}', '2'::jsonb)
 where slug = 'pro';
