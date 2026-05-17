import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Clock, CreditCard, QrCode } from "lucide-react";
import { useApi } from "../../utils/useApi";
import { authFetch } from "../../utils/authFetch";
import UsageBar from "../../components/UsageBar";

interface BillingMe {
  subscription_status: string;
  trial_days_left: number;
  trial_ends_at: string | null;
  asaas_subscription_id: string | null;
  plan: { slug: string; name: string; price_cents: number } | null;
}

interface Payment {
  id: string;
  asaas_payment_id: string;
  amount_cents: number;
  status: string;
  billing_type: string;
  due_date: string;
  paid_at: string | null;
  invoice_url: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  trial:     { label: "Em trial",            cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  active:    { label: "Ativa",               cls: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" },
  past_due:  { label: "Pagamento atrasado",  cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" },
  cancelled: { label: "Cancelada",           cls: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300" },
  expired:   { label: "Expirada",            cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" },
};

export default function PlanoTab() {
  const { data: me, mutate } = useApi<BillingMe>("/api/billing/me");
  const { data: paymentsData } = useApi<Payment[]>("/api/billing/payments");
  const payments = Array.isArray(paymentsData) ? paymentsData : [];

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = me?.subscription_status || "trial";
  const statusInfo = STATUS_LABEL[status] || { label: status, cls: "bg-gray-100" };

  const cancel = async () => {
    setError(null);
    setCancelling(true);
    try {
      const res = await authFetch("/api/billing/cancel", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Erro ao cancelar");
      }
      mutate();
      setConfirmOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Status atual */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Plano atual</h2>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusInfo.cls}`}>
                {statusInfo.label}
              </span>
              {me?.plan && (
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Plano {me.plan.name}
                </span>
              )}
            </div>
            {me?.plan && (
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                R$ {(me.plan.price_cents / 100).toFixed(2)}
                <span className="text-sm font-normal text-gray-500">/mês</span>
              </p>
            )}
          </div>
          <div className="text-right">
            {status === "trial" && me?.trial_ends_at && (
              <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                <Clock size={14} />
                {me.trial_days_left} {me.trial_days_left === 1 ? "dia restante" : "dias restantes"} no trial
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-gray-100 dark:border-gray-700">
          {(status === "trial" || status === "cancelled" || status === "expired") && (
            <Link
              to="/planos"
              className="px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-sm font-semibold"
            >
              {status === "trial" ? "Assinar agora" : "Reativar assinatura"}
            </Link>
          )}
          {status === "active" && me?.asaas_subscription_id && (
            <button
              onClick={() => setConfirmOpen(true)}
              className="px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
            >
              Cancelar assinatura
            </button>
          )}
          {status === "past_due" && (
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle size={16} />
              O último pagamento não foi confirmado.
            </div>
          )}
        </div>
      </div>

      {/* Uso do plano */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Uso do plano</h2>
        <div className="space-y-3">
          <UsageBar resource="clients" />
          <UsageBar resource="jobs" />
          <UsageBar resource="team_members" />
        </div>
      </div>

      {/* Histórico de pagamentos */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">Histórico de pagamentos</h2>
        </div>
        {payments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">Nenhuma cobrança ainda.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {payments.map(p => (
              <div key={p.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500">
                  {p.billing_type === "PIX" ? <QrCode size={14} /> : <CreditCard size={14} />}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">R$ {(p.amount_cents / 100).toFixed(2)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {p.paid_at ? `Pago em ${new Date(p.paid_at).toLocaleDateString("pt-BR")}` : `Vence em ${p.due_date}`}
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  ["RECEIVED", "CONFIRMED"].includes(p.status)
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : p.status === "OVERDUE"
                    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}>
                  {p.status}
                </span>
                {p.invoice_url && (
                  <a href={p.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-gold-600 hover:underline">
                    Comprovante
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-2">Cancelar assinatura?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              Você continuará tendo acesso até o final do período atual.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Voltar</button>
              <button onClick={cancel} disabled={cancelling} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium">
                {cancelling ? "Cancelando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
