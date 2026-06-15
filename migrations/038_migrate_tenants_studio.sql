-- Rode no SQL Editor do Supabase. Idempotente. DEPOIS da 037.
--
-- Decisão do dono: ao separar galeria/álbum em planos de cima, NINGUÉM perde
-- acesso — todos os clientes ATUAIS vão pro plano Studio (que tem galeria +
-- álbum + 30 GB). Novos assinantes escolhem o plano normalmente.
--
-- Só muda o plano (acesso a features). NÃO mexe na cobrança/assinatura Asaas —
-- cada cliente segue pagando o que já paga até o estúdio ajustar, se quiser.

UPDATE platform_accounts
   SET plan_id = (SELECT id FROM platform_plans WHERE slug = 'studio' LIMIT 1),
       updated_at = now()
 WHERE plan_id IS DISTINCT FROM (SELECT id FROM platform_plans WHERE slug = 'studio' LIMIT 1);
