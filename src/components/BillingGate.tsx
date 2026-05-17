import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X, Zap } from "lucide-react";

interface BillingBlockedDetail {
  httpStatus: number;
  error?: string;
  limit_reached?: string;
  current?: number;
  max?: number;
  plan_slug?: string;
  subscription_status?: string;
  reason?: string;
}

const RESOURCE_LABEL: Record<string, string> = {
  clients: "clientes",
  jobs: "jobs",
  team_members: "membros da equipe",
};

export default function BillingGate() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BillingBlockedDetail | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onBlock = (e: Event) => {
      const ce = e as CustomEvent<BillingBlockedDetail>;
      setDetail(ce.detail);
      setOpen(true);
    };
    window.addEventListener("billing:blocked", onBlock);
    return () => window.removeEventListener("billing:blocked", onBlock);
  }, []);

  if (!open || !detail) return null;

  const isPaymentRequired = detail.httpStatus === 402;
  const isLimitReached = !!detail.limit_reached;
  const resourceLabel = detail.limit_reached ? RESOURCE_LABEL[detail.limit_reached] || detail.limit_reached : null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
              {isPaymentRequired ? (
                <AlertTriangle className="text-gold-600 dark:text-gold-400" size={24} />
              ) : (
                <Zap className="text-gold-600 dark:text-gold-400" size={24} />
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X size={18} />
            </button>
          </div>

          {isPaymentRequired ? (
            <>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Assinatura necessária
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                {detail.reason === "trial_expired"
                  ? "Seu período de teste de 7 dias terminou. Para continuar criando e editando, assine um plano."
                  : detail.reason === "past_due"
                  ? "O último pagamento não foi confirmado. Atualize o método de pagamento."
                  : "Sua assinatura está inativa. Reative pra voltar a usar."}
              </p>
            </>
          ) : isLimitReached ? (
            <>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Limite do plano atingido
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                Você atingiu o limite de <strong>{detail.max} {resourceLabel}</strong> do seu plano
                {detail.plan_slug ? ` (${detail.plan_slug.charAt(0).toUpperCase() + detail.plan_slug.slice(1)})` : ""}.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                Faça upgrade pra um plano superior pra desbloquear mais espaço.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Acesso bloqueado</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                {detail.error || "Não foi possível concluir a ação."}
              </p>
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Fechar
            </button>
            <button
              onClick={() => { setOpen(false); navigate("/planos"); }}
              className="flex-1 py-2.5 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-sm font-semibold"
            >
              Ver planos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
