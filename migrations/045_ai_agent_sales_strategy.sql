-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Estratégia de vendas da Lia: bloco editável com as técnicas de venda e
-- contorno de objeção (rapport, SPIN, valor antes de preço, prova social,
-- escassez honesta, micro-compromissos...). Fica visível/editável na tela
-- "Agente IA". Se ficar vazio, usa o padrão embutido (DEFAULT_SALES_STRATEGY).

ALTER TABLE ai_agent_config ADD COLUMN IF NOT EXISTS sales_strategy text;
