-- migrations/059_wa_conversations_archived.sql
-- Conversas ARQUIVADAS no WhatsApp não devem aparecer no chat do CRM.
-- O estado vem do WhatsApp na sincronização de conversas (Baileys chats-set,
-- a cada conexão). Sem a coluna, o código degrada sem filtro (resiliente).
-- Execute no Supabase SQL Editor. Idempotente.

ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
