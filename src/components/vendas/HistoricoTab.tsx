import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, XCircle, Clock, Search, X, ExternalLink, Briefcase } from "lucide-react";
import { Deal, PipelineStage, Client } from "../../types";
import { cn } from "../../utils/cn";
import { normalizeText } from "../../utils/normalizeText";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../ui/ConfirmModal";

type Filter = "todos" | "ativos" | "convertidos" | "perdidos";

interface HistoricoTabProps {
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  initialFilter?: Filter;
  onOpenDeal?: (deal: Deal) => void;
  onUpdate?: () => void | Promise<void>;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getDealStatus(deal: Deal, stages: PipelineStage[]): "convertido" | "perdido" | "ativo" {
  if (deal.converted) return "convertido";
  const stage = stages.find((s) => s.id === deal.stage);
  if (stage?.is_final && !stage.is_won) return "perdido";
  if (stage?.is_final && stage.is_won) return "convertido";
  return "ativo";
}

export function HistoricoTab({ deals, stages, clients, initialFilter = "todos", onOpenDeal, onUpdate }: HistoricoTabProps) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState("");
  const [cancelDeal, setCancelDeal] = useState<Deal | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const stageMap = useMemo(() => {
    const m = new Map<string, PipelineStage>();
    stages.forEach((s) => m.set(s.id, s));
    return m;
  }, [stages]);

  const clientMap = useMemo(() => {
    const m = new Map<number, Client>();
    clients.forEach((c) => m.set(c.id, c));
    return m;
  }, [clients]);

  const counts = useMemo(() => {
    const c = { todos: deals.length, ativos: 0, convertidos: 0, perdidos: 0 };
    for (const d of deals) {
      const s = getDealStatus(d, stages);
      if (s === "ativo") c.ativos++;
      else if (s === "convertido") c.convertidos++;
      else c.perdidos++;
    }
    return c;
  }, [deals, stages]);

  const filtered = useMemo(() => {
    let list = deals;
    if (filter !== "todos") {
      list = list.filter((d) => {
        const s = getDealStatus(d, stages);
        return (filter === "ativos" && s === "ativo")
            || (filter === "convertidos" && s === "convertido")
            || (filter === "perdidos" && s === "perdido");
      });
    }
    const q = normalizeText(search);
    if (q) {
      list = list.filter((d) => {
        const clientName = d.client_id ? clientMap.get(d.client_id)?.name : null;
        return normalizeText(d.title || "").includes(q)
            || normalizeText(d.contact_name || "").includes(q)
            || normalizeText(clientName || "").includes(q)
            || normalizeText(d.contact_phone || "").includes(q)
            || normalizeText(d.contact_email || "").includes(q)
            || normalizeText(d.lead_source || "").includes(q)
            || normalizeText(d.lost_reason || "").includes(q)
            || normalizeText(d.lost_notes || "").includes(q);
      });
    }
    // ordena por data de conversão/atualização desc
    return [...list].sort((a, b) => {
      const ad = a.converted_at || a.updated_at || a.created_at;
      const bd = b.converted_at || b.updated_at || b.created_at;
      return (bd || "").localeCompare(ad || "");
    });
  }, [deals, stages, clientMap, filter, search]);

  const FILTER_TABS: Array<{ id: Filter; label: string; count: number; icon?: React.ReactNode }> = [
    { id: "todos", label: "Todos", count: counts.todos },
    { id: "ativos", label: "Em andamento", count: counts.ativos, icon: <Clock size={12} /> },
    { id: "convertidos", label: "Convertidos", count: counts.convertidos, icon: <CheckCircle2 size={12} /> },
    { id: "perdidos", label: "Perdidos", count: counts.perdidos, icon: <XCircle size={12} /> },
  ];

  const cancelConvertedSale = async () => {
    if (!cancelDeal || cancelling) return;
    setCancelling(true);
    try {
      const res = await authFetch(`/api/deals/${cancelDeal.id}/cancel-sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelado pelo histórico de vendas" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Não consegui cancelar a venda: ${data.error || `erro ${res.status}`}`);
        return;
      }
      setCancelDeal(null);
      await onUpdate?.();
    } catch (err: any) {
      console.error("[HistoricoTab] cancel sale error:", err);
      alert(`Erro inesperado: ${err?.message || err}`);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      {/* Filtros + busca */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {FILTER_TABS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                filter === f.id
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              {f.icon}
              {f.label}
              <span className={cn(
                "ml-1 px-1.5 py-0 rounded-full text-[10px] font-bold",
                filter === f.id
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              )}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider sticky top-0 z-10">
            <tr>
              <th className="px-5 py-3 font-semibold">Lead</th>
              <th className="px-5 py-3 font-semibold">Etapa atual</th>
              <th className="px-5 py-3 font-semibold">Valor</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Motivo da perda</th>
              <th className="px-5 py-3 font-semibold">Criado em</th>
              <th className="px-5 py-3 font-semibold">Convertido em</th>
              <th className="px-5 py-3 font-semibold text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((d) => {
              const status = getDealStatus(d, stages);
              const stage = stageMap.get(d.stage);
              const clientName = d.client_id ? clientMap.get(d.client_id)?.name : null;
              return (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate max-w-[260px]">
                      {clientName || d.contact_name || d.title || "Sem nome"}
                    </p>
                    {d.title && (clientName || d.contact_name) && d.title !== (clientName || d.contact_name) && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[260px]">{d.title}</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {stage ? (
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: stage.color || "#94a3b8" }}
                      >
                        {stage.name}
                      </span>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                    {formatCurrency(d.value || 0)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-5 py-3 min-w-[180px]">
                    {status === "perdido" ? (
                      <div>
                        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                          {d.lost_reason?.trim() || "Sem motivo informado"}
                        </p>
                        {d.lost_notes?.trim() && (
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                            {d.lost_notes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {d.created_at ? format(new Date(d.created_at), "dd/MM/yyyy", { locale: ptBR }) : "-"}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {d.converted_at ? format(new Date(d.converted_at), "dd/MM/yyyy", { locale: ptBR }) : "-"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {d.converted_job_id && (
                        <a
                          href={`/produção?job=${d.converted_job_id}`}
                          title="Abrir trabalho convertido"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gold-700 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 rounded-lg transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Briefcase size={11} />
                          Job #{d.converted_job_id}
                        </a>
                      )}
                      {status === "convertido" && (
                        <button
                          onClick={() => setCancelDeal(d)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Cancelar venda duplicada ou criada por engano"
                        >
                          <XCircle size={11} />
                          Cancelar venda
                        </button>
                      )}
                      {onOpenDeal && (
                        <button
                          onClick={() => onOpenDeal(d)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <ExternalLink size={11} />
                          Ver
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                  {search
                    ? "Nenhum negócio encontrado para esta busca."
                    : filter === "convertidos"
                    ? "Nenhum negócio convertido ainda."
                    : filter === "perdidos"
                    ? "Nenhum negócio marcado como perdido."
                    : "Nenhum negócio aqui."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!cancelDeal}
        title="Cancelar venda?"
        message={`A venda de "${cancelDeal?.contact_name || cancelDeal?.title || "cliente"}" será marcada como perdida e o trabalho vinculado será excluído. O cliente continua salvo.`}
        confirmText={cancelling ? "Cancelando..." : "Cancelar venda"}
        cancelText="Voltar"
        variant="danger"
        onConfirm={cancelConvertedSale}
        onCancel={() => {
          if (!cancelling) setCancelDeal(null);
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "convertido" | "perdido" | "ativo" }) {
  const map = {
    ativo: { label: "Em andamento", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", icon: <Clock size={10} /> },
    convertido: { label: "Convertido", cls: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300", icon: <CheckCircle2 size={10} /> },
    perdido: { label: "Perdido", cls: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300", icon: <XCircle size={10} /> },
  } as const;
  const it = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold", it.cls)}>
      {it.icon}
      {it.label}
    </span>
  );
}
