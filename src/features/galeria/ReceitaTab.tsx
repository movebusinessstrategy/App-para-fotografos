import React, { useMemo, useState } from "react";
import { Download, Receipt } from "lucide-react";

import { cn } from "../../utils/cn";
import { useApi } from "../../utils/useApi";
import { RevenueOrder, RevenueResponse } from "./types";
import { formatBRL, formatDateBR } from "./utils";
import { ToastKind } from "./Toast";

interface ReceitaTabProps {
  onNotify: (kind: ToastKind, message: string) => void;
}

type StatusFilter = "todos" | "pending" | "paid";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "pending", label: "Pendentes" },
  { id: "paid", label: "Pagos" },
];

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "Pendente",
    cls: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  paid: {
    label: "Pago",
    cls: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
};

function statusBadge(status: string): { label: string; cls: string } {
  return (
    STATUS_BADGES[status] ?? {
      label: status || "—",
      cls: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
    }
  );
}

// ─── Exportação CSV (client-side, sem lib) ────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(orders: RevenueOrder[]): string {
  const header = ["Código", "Cliente", "Galeria", "Fotos extras", "Valor", "Status", "Data"];
  const lines = orders.map((o) =>
    [
      o.order_code,
      o.client_name || "",
      o.gallery_title || "",
      o.extra_count,
      (o.amount || 0).toFixed(2).replace(".", ","),
      statusBadge(o.status).label,
      formatDateBR(o.created_at),
    ]
      .map(csvCell)
      .join(";"),
  );
  // BOM UTF-8 pro Excel abrir com acentos certos.
  return "\uFEFF" + [header.join(";"), ...lines].join("\n");
}

function downloadCsv(content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receita-galerias-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Aba de Receita: métricas + pedidos das galerias ──────────────────────────

export default function ReceitaTab({ onNotify }: ReceitaTabProps) {
  const { data, isLoading } = useApi<RevenueResponse>("/api/galleries/revenue");
  const [filtro, setFiltro] = useState<StatusFilter>("todos");

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const filtered = useMemo(
    () => (filtro === "todos" ? orders : orders.filter((o) => o.status === filtro)),
    [orders, filtro],
  );

  const handleExport = () => {
    if (filtered.length === 0) {
      onNotify("info", "Nenhum pedido para exportar.");
      return;
    }
    downloadCsv(buildCsv(filtered));
    onNotify("success", `${filtered.length} pedido(s) exportado(s).`);
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="A receber" value={formatBRL(data?.to_receive)} />
        <MetricCard label="Recebido no mês" value={formatBRL(data?.received_month)} />
        <MetricCard label="Ticket médio" value={formatBRL(data?.avg_ticket)} />
        <MetricCard
          label="Pendentes"
          value={String(data?.pending_count ?? 0)}
          hint={`pedido${(data?.pending_count ?? 0) === 1 ? "" : "s"} aguardando pagamento`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                filtro === f.id
                  ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          <Download size={14} />
          Exportar CSV
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyOrders filtro={filtro} />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Código</th>
                <th className="px-4 py-3 font-semibold">Cliente · galeria</th>
                <th className="px-4 py-3 font-semibold text-right hidden sm:table-cell">Extras</th>
                <th className="px-4 py-3 font-semibold text-right">Valor</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((o) => (
                <OrderRow key={o.order_code} order={o} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ─── Pedacinhos da aba ────────────────────────────────────────────────────────

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  );
}

// key tipado pro typecheck aceitar <OrderRow key={} ...> (padrão do projeto).
function OrderRow({ order }: { order: RevenueOrder; key?: React.Key | null }) {
  const badge = statusBadge(order.status);
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-400">
        {order.order_code}
      </td>
      <td className="px-4 py-3">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">
          {order.client_name || "Sem cliente"}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400 truncate max-w-[220px]">
          {order.gallery_title || "—"}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-200 hidden sm:table-cell">
        {order.extra_count}
      </td>
      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-white">
        {formatBRL(order.amount)}
      </td>
      <td className="px-4 py-3">
        <span className={cn("inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold", badge.cls)}>
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
        {formatDateBR(order.paid_at || order.created_at)}
      </td>
    </tr>
  );
}

function EmptyOrders({ filtro }: { filtro: StatusFilter }) {
  const message =
    filtro === "todos"
      ? "Quando uma cliente escolher fotos extras, os pedidos de pagamento aparecem aqui."
      : "Nenhum pedido com esse status por enquanto.";
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center px-4">
      <Receipt size={24} className="text-gray-300 dark:text-gray-600" />
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Nenhum pedido ainda</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">{message}</p>
    </div>
  );
}
