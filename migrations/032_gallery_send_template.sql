-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Galeria de proofing — texto padrão do envio pra cliente.
-- O estúdio personaliza a mensagem que sai por e-mail/WhatsApp quando
-- envia a galeria. Placeholders: {cliente} {titulo} {link} {estudio}
-- {prazo} {acesso_email} {senha}. NULL = usa o padrão do sistema.

ALTER TABLE gallery_settings ADD COLUMN IF NOT EXISTS send_message_template TEXT;
