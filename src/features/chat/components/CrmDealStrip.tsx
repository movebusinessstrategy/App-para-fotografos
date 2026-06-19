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
      <DealActions deal={deal} stages={stages} onChanged={onUpdate} />

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

// Modal estilizado (segue o sistema) — substitui o confirm()/prompt() nativo.
function MarkDealModal({ kind, dealTitle, onConfirm, onCancel }: {
  kind: "won" | "lost"; dealTitle: string;
  onConfirm: (reason?: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const won = kind === "won";
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${won ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"}`}>
            {won ? <Trophy size={24} /> : <X size={24} />}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">
            {won ? "Marcar como Ganho?" : "Marcar como Perdido?"}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
            <span className="font-medium">"{dealTitle}"</span> {won ? "vai pra etapa de venda ganha." : "vai pra etapa de perdido."}
          </p>
          {!won && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Motivo da perda (opcional)"
              className="mt-3 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 resize-none"
            />
          )}
        </div>
        <div className="flex gap-3 p-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onCancel} className="flex-1 py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(won ? undefined : (reason.trim() || undefined))}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-colors ${won ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
          >
            {won ? "Marcar Ganho" : "Marcar Perdido"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DealActions({ deal, stages, onChanged }: { deal: Deal; stages: PipelineStage[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<"won" | "lost" | null>(null);
  const [modal, setModal] = useState<"won" | "lost" | null>(null);

  // Ganho/perdido no app é pela ETAPA (is_won / is_final). Se já está numa etapa
  // final, esconde os botões.
  const dealStage = stages.find((s) => s.id === (deal as any).stage);
  if (dealStage?.is_final) return null;

  const apply = async (kind: "won" | "lost", reason?: string) => {
    setModal(null);
    // O funil pode ter mais de uma etapa is_won (ex.: "Entregue" + "Fechado
    // Ganho"). Escolhe a de VENDA ganha pelo nome; senão, a de maior posição
    // (a de fechamento costuma vir por último). Perdido: a is_final sem is_won.
    let targetStage: PipelineStage | undefined;
    if (kind === "won") {
      const wons = stages.filter((s) => s.is_won);
      targetStage = wons.find((s) => /ganh|vendid|fechad/i.test(s.name))
        || [...wons].sort((a, b) => b.position - a.position)[0];
    } else {
      const losts = stages.filter((s) => s.is_final && !s.is_won);
      targetStage = losts.find((s) => /perd/i.test(s.name)) || losts[0];
    }
    if (!targetStage) return; // pipeline sem etapa ganha/perdida configurada
    setBusy(kind);
    try {
      // Move pra etapa certa — o backend grava converted_at sozinho no is_won.
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: targetStage.id, ...(kind === "lost" ? { lost_reason: reason || null } : {}) }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setModal("won")}
        disabled={!!busy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-60"
        style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}
        title="Marcar como Ganho"
      >
        {busy === "won" ? <Loader2 size={11} className="animate-spin" /> : <Trophy size={11} />}
        Ganho
      </button>
      <button
        onClick={() => setModal("lost")}
        disabled={!!busy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-60"
        style={{ background: "rgba(239, 68, 68, 0.12)", color: "#ef4444" }}
        title="Marcar como Perdido"
      >
        {busy === "lost" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        Perdido
      </button>
      {modal && (
        <MarkDealModal
          kind={modal}
          dealTitle={deal.title || "este lead"}
          onConfirm={(reason) => apply(modal, reason)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
