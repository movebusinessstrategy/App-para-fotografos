-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Fase B do agente: a Lia passa a "entender" áudio e imagem. Guardamos o texto
-- entendido (transcrição do PTT via Whisper, ou descrição da foto via Claude
-- Vision) junto da mensagem, pra mostrar no inbox e alimentar a IA.

ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS transcription text;
