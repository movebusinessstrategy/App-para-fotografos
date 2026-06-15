-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Endereço do cliente ganha NÚMERO da casa (essencial pra nota fiscal) +
-- complemento (apto/bloco). Espelha o que o estúdio (company_info) já tem.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_number     TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_complement TEXT;
