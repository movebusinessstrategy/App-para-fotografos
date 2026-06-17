import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ExternalLink, Loader2, Trophy, X, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { Deal, PipelineStage } from "../../../types";
import { useAuth } from "../../../contexts/AuthContext";
import { authFetch } from "../../../utils/authFetch";

interface Props {
  phone: string;
  deals: Deal[];
  stages: PipelineStage[];
  onUpdate: () => void;
}

// Faixa do CRM no topo da conversa: mostra contexto do deal vinculado
// (etapa, valor, ações). Aparece SÓ quando o contato já é um deal no funil.
// Sem deal, o header da conversa renderiza só o FunnelStatusButton existente.
//
// Membros não veem valor — alinhado com a decisão de 2026-05-29.
export function CrmDealStrip({ phone, deals, stages, onUpdate }: Props) {
  const { canAccess } = useAuth();
  const canSeeFinance = canAccess('finance'); // dono ou funcionário com permissão "Financeiro"

  // Match com várias normalizações (com/sem 55, só dígitos) — mesmo padrão
  // que o FunnelStatusButton existente usa pra evitar inconsistência.
  const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
  const target = onlyDigits(phone);
  const targetShort = target.startsWith("55") ? target.slice(2) : target;
  const deal = deals.find(d => {
    const dp = onlyDigits(d.contact_phone || "");
    if (!dp) return false;
    const dpShort = dp.startsWith("55") ? dp.slice(2) : dp;
    return dp === target || dpShort === targetShort || dp === targetShort || dpShort === target;
  });

  if (!deal) return null;

  const stage = stages.find(s => s.id === deal.stage);
  const stageColor = stage?.color || "#10b981";

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 flex-shrink-0 border-b"
      style={{
        background: "var(--wa-bg-secondary, rgba(255,255,255,0.03))",
        borderColor: "var(--wa-border)",
      }}
    >
      {/* Selector de etapa */}
      <StageSelector
        deal={deal}
        stages={stages}
        stageColor={stageColor}
        onChanged={onUpdate}
      />

      {/* Valor — só dono/admin vê */}
      {canSeeFinance && typeof deal.value === "number" && deal.value > 0 && (
        <span
          className="text-[12px] font-semibold whitespace-nowrap"
          style={{ color: "var(--wa-text-secondary)" }}
        >
          R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      )}

      {/* Tarefas pendentes */}
      {deal.client_id != null && (
        <PendingTasksBadge clientId={deal.client_id} />
      )}

      <div className="flex-1" />

      {/* Ações terminais */}
      <DealActions deal={deal} onChanged={onUpdate} />

      {/* Link pra abrir no funil */}
      <Link
        to={`/vendas?tab=kanban`}
        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors"
        style={{ color: "var(--wa-text-secondary)" }}
        title="Abrir no funil de vendas"
      >
        <ExternalLink size={11} />
        Funil
      </Link>
    </div>
  );
}

// ─── Stage selector (dropdown) ────────────────────────────────────────────────

function StageSelector({
  deal, stages, stageColor, onChanged,
}: {
  deal: Deal;
  stages: PipelineStage[];
  stageColor: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora — padrão usado em outros dropdowns do projeto.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentStage = stages.find(s => s.id === deal.stage);

  const handlePick = async (stageId: string) => {
    if (stageId === deal.stage || updating) {
      setOpen(false);
      return;
    }
    setUpdating(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stageId }),
      });
      onChanged();
    } finally {
      setUpdating(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={updating}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold disabled:opacity-60"
        style={{
          background: `${stageColor}20`,
          color: stageColor,
          border: `1px solid ${stageColor}40`,
        }}
      >
        {updating ? <Loader2 size={11} className="animate-spin" /> : (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: stageColor }}
          />
        )}
        <span className="max-w-[160px] truncate">{currentStage?.name || "Sem etapa"}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 min-w-[220px] py-1 rounded-lg shadow-lg"
          style={{
            background: "var(--wa-bg-tertiary)",
            border: "1px solid var(--wa-border)",
          }}
        >
          {stages.map(s => {
            const isCurrent = s.id === deal.stage;
            return (
              <button
                key={s.id}
                onClick={() => handlePick(s.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                style={{
                  color: isCurrent ? s.color : "var(--wa-text-primary)",
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: s.color || "#94a3b8" }}
                />
                <span className="flex-1 truncate">{s.name}</span>
                {isCurrent && <span className="text-[10px] opacity-60">atual</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Pending tasks badge ──────────────────────────────────────────────────────

function PendingTasksBadge({ clientId }: { clientId: number | string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/tasks?client_id=${clientId}&status=pending`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (cancelled) return;
        setCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (count == null || count === 0) return null;

  return (
    <Link
      to={`/tarefas?client_id=${clientId}`}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium"
      style={{
        background: "rgba(245, 158, 11, 0.15)",
        color: "#f59e0b",
        border: "1px solid rgba(245, 158, 11, 0.3)",
      }}
      title={`${count} tarefa(s) pendente(s)`}
    >
      <ListChecks size={11} />
      {count}
    </Link>
  );
}

// ─── Deal actions: Won / Lost ─────────────────────────────────────────────────

function DealActions({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const [busy, setBusy] = useState<"won" | "lost" | null>(null);

  // Já tá ganho/perdido? Esconde os botões (evita ações duplicadas).
  const status = (deal as any).status;
  if (status === "won" || status === "lost") return null;

  const markWon = async () => {
    if (busy) return;
    if (!confirm(`Marcar "${deal.title}" como Ganho?`)) return;
    setBusy("won");
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "won", closed_at: new Date().toISOString() }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const markLost = async () => {
    if (busy) return;
    const reason = prompt(`Marcar "${deal.title}" como Perdido. Motivo (opcional):`);
    if (reason === null) return; // cancelou
    setBusy("lost");
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "lost",
          closed_at: new Date().toISOString(),
          lost_reason: reason || null,
        }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={markWon}
        disabled={!!busy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-60"
        style={{
          background: "rgba(16, 185, 129, 0.15)",
          color: "#10b981",
        }}
        title="Marcar como Ganho"
      >
        {busy === "won" ? <Loader2 size={11} className="animate-spin" /> : <Trophy size={11} />}
        Ganho
      </button>
      <button
        onClick={markLost}
        disabled={!!busy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-60"
        style={{
          background: "rgba(239, 68, 68, 0.12)",
          color: "#ef4444",
        }}
        title="Marcar como Perdido"
      >
        {busy === "lost" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        Perdido
      </button>
    </div>
  );
}
