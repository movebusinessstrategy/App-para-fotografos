import React, { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { Message } from "../types";

interface Props {
  messages: Message[];
  onSuggested: (reply: string) => void;
}

// Botão "✨ Lia" que lê a conversa atual e gera uma sugestão de resposta
// via /api/agent/suggest. O texto sugerido vai pro input do chat — usuário
// revisa e envia (modo rascunho, mesma decisão da extensão Chrome).
//
// Sem mensagens, fica desabilitado. Com mensagens, single click chama a IA.
export function LiaSuggestButton({ messages, onSuggested }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = loading || messages.length === 0;

  async function handleClick() {
    if (disabled) return;
    setLoading(true);
    setError(null);
    try {
      // Pega as últimas 60 mensagens (mesmo limite da extensão) pra responder
      // com o contexto da conversa. Pra áudio/imagem usa a TRANSCRIÇÃO/descrição
      // (a Lia "ouve/vê" o que o cliente mandou) — senão body vazio era ignorado.
      const recent = messages.slice(-60).map(m => ({
        role: m.from_me ? "assistant" : "user",
        content: m.body || m.transcription || "",
      })).filter(m => m.content.trim());

      if (recent.length === 0) {
        setError("Conversa vazia.");
        return;
      }

      const res = await authFetch("/api/agent/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: recent }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Erro ao gerar sugestão.");
        return;
      }
      if (data?.action?.type === "handoff") {
        setError("Essa conversa precisa de você. Assuma o atendimento antes de responder.");
        return;
      }

      const reply = String(data?.reply || "").trim();
      if (!reply) {
        setError("Sem sugestão.");
        return;
      }
      onSuggested(reply);
    } catch (e: any) {
      setError(e?.message || "Erro de rede.");
    } finally {
      setLoading(false);
      // O erro some sozinho depois de 4s pra não poluir a UI
      if (error) setTimeout(() => setError(null), 4000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
      style={{
        color: loading ? "var(--wa-accent-green)" : "#a855f7",
      }}
      title={
        error
          ? error
          : messages.length === 0
            ? "Lia precisa de mensagens pra sugerir"
            : "✨ Sugerir resposta com Lia"
      }
    >
      {loading ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
    </button>
  );
}
