import React, { useEffect, useState } from "react";
import { X, Megaphone, Pencil, Send, Loader2, CheckCircle2, AlertCircle, Save } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { Deal, PipelineStage } from "../../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  stages: PipelineStage[];
  deals: Deal[];
  onSent: () => void;
}

// Modal de disparo em massa por etapa do funil:
// - Lista etapas com contagem de deals e mensagem padrão salva
// - Botão "Editar" pra alterar a mensagem padrão (PATCH /api/pipeline/stages/:id/follow-up)
// - Botão "Disparar" envia pra todos os deals daquela etapa com telefone
//   (POST /api/pipeline/stages/:id/blast — roteia Baileys ou Cloud API atrás)
//
// Variável suportada: {nome} substituído pelo contact_name de cada deal.
// Aviso explícito de custo quando o canal ativo é Cloud API (cobra por msg).
export function BulkFollowupModal({ open, onClose, stages, deals, onSent }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--wa-bg-tertiary)" }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--wa-border)" }}
        >
          <div className="flex items-center gap-2.5">
            <Megaphone size={20} style={{ color: "var(--wa-accent-green)" }} />
            <div>
              <h3 className="text-base font-bold" style={{ color: "var(--wa-text-primary)" }}>
                Disparos em massa por etapa
              </h3>
              <p className="text-xs" style={{ color: "var(--wa-text-muted)" }}>
                Envia a mensagem padrão pra todos os deals daquela etapa do funil
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: "var(--wa-text-secondary)" }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto wa-scrollbar p-4 space-y-2">
          {stages.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: "var(--wa-text-muted)" }}>
                Nenhuma etapa configurada no funil ainda.
              </p>
            </div>
          )}
          {stages.map(stage => {
            const dealsHere = deals.filter(d =>
              d.stage === stage.id && (d as any).contact_phone?.trim()
            );
            return (
              <StageRow
                key={stage.id}
                stage={stage}
                dealCount={dealsHere.length}
                onSent={onSent}
              />
            );
          })}
        </div>

        <div
          className="px-5 py-3 flex-shrink-0 text-[11px] flex items-center gap-2"
          style={{
            borderTop: "1px solid var(--wa-border)",
            background: "rgba(245, 158, 11, 0.08)",
            color: "#f59e0b",
          }}
        >
          <AlertCircle size={13} />
          <span>
            Mensagens fora da janela de 24h só funcionam via template aprovado.
            Disparos pela Cloud API cobram por mensagem.
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Linha de uma etapa ──────────────────────────────────────────────────────

function StageRow({
  stage, dealCount, onSent,
}: {
  stage: PipelineStage;
  dealCount: number;
  onSent: () => void;
  // React.Key precisa estar tipado pra typecheck strict aceitar <StageRow key={} ...>
  // (padrão já usado em ConversationItem/MessageBubble no commit anterior)
  key?: React.Key | null;
}) {
  const [message, setMessage] = useState<string>((stage as any).follow_up_message || "");
  const [editing, setEditing] = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);
  const [blasting, setBlasting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const color = stage.color || "#10b981";

  // Re-sincroniza se o stage mudar externamente (ex: refetch global)
  useEffect(() => {
    setMessage((stage as any).follow_up_message || "");
  }, [(stage as any).follow_up_message]);

  const saveMessage = async () => {
    setSavingMsg(true);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}/follow-up`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "MIGRATION_NEEDED") {
          setFeedback({
            kind: "err",
            text: "Banco não tem coluna follow_up_message ainda. Roda a migration de pipeline.",
          });
        } else {
          setFeedback({ kind: "err", text: data?.error || "Erro ao salvar." });
        }
      } else {
        setEditing(false);
        setFeedback({ kind: "ok", text: "Mensagem salva." });
        setTimeout(() => setFeedback(null), 2500);
      }
    } finally {
      setSavingMsg(false);
    }
  };

  const blast = async () => {
    if (!message.trim()) {
      setFeedback({ kind: "err", text: "Preencha a mensagem primeiro." });
      return;
    }
    if (dealCount === 0) {
      setFeedback({ kind: "err", text: "Nenhum deal com telefone nesta etapa." });
      return;
    }
    if (!confirm(`Disparar a mensagem pra ${dealCount} contato(s) da etapa "${stage.name}"?`)) return;

    setBlasting(true);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}/blast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ kind: "err", text: data?.error || "Erro ao disparar." });
      } else {
        setFeedback({
          kind: "ok",
          text: `Enviadas: ${data.sent || 0} · Falhas: ${data.failed || 0} de ${data.total || dealCount}.`,
        });
        onSent();
      }
    } finally {
      setBlasting(false);
    }
  };

  return (
    <div
      className="p-3 rounded-xl"
      style={{
        background: "var(--wa-bg-secondary, rgba(255,255,255,0.04))",
        border: "1px solid var(--wa-border)",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          <span className="font-semibold text-sm truncate" style={{ color: "var(--wa-text-primary)" }}>
            {stage.name}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: dealCount > 0 ? `${color}20` : "var(--wa-bg-hover)",
              color: dealCount > 0 ? color : "var(--wa-text-muted)",
            }}
          >
            {dealCount} contato{dealCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: "var(--wa-text-secondary)" }}
            >
              <Pencil size={11} />
              Editar
            </button>
          )}
          <button
            onClick={blast}
            disabled={blasting || dealCount === 0 || !message.trim()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold disabled:opacity-50"
            style={{
              background: "var(--wa-accent-green)",
              color: "white",
            }}
          >
            {blasting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            Disparar
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="Oi {nome}, tudo bem? Passando pra ver se você tem alguma dúvida 😊"
            className="w-full text-xs p-2.5 rounded-lg outline-none resize-none wa-scrollbar"
            style={{
              background: "var(--wa-bg-input)",
              color: "var(--wa-text-primary)",
              border: "1px solid var(--wa-border)",
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px]" style={{ color: "var(--wa-text-muted)" }}>
              Use <code>{"{nome}"}</code> pra personalizar com o nome de cada contato.
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setMessage((stage as any).follow_up_message || "");
                }}
                className="px-2.5 py-1 rounded text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--wa-text-secondary)" }}
              >
                Cancelar
              </button>
              <button
                onClick={saveMessage}
                disabled={savingMsg}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold disabled:opacity-60"
                style={{
                  background: "var(--wa-accent-green)",
                  color: "white",
                }}
              >
                {savingMsg ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p
          className="text-xs whitespace-pre-wrap break-words"
          style={{ color: message ? "var(--wa-text-primary)" : "var(--wa-text-muted)" }}
        >
          {message || "Nenhuma mensagem padrão salva. Clique em Editar pra criar."}
        </p>
      )}

      {feedback && (
        <div
          className="mt-2 flex items-center gap-1.5 text-[11px]"
          style={{ color: feedback.kind === "ok" ? "#10b981" : "#ef4444" }}
        >
          {feedback.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {feedback.text}
        </div>
      )}
    </div>
  );
}
