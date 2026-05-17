import React from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Clock, X } from "lucide-react";
import { useApi } from "../utils/useApi";

interface BillingMe {
  subscription_status: string;
  trial_days_left: number;
  trial_ends_at: string | null;
}

// Mostra um banner no topo quando trial está próximo do fim ou expirou.
// Esconde automaticamente nas próprias páginas de billing (/planos, /assinatura).
export default function TrialBanner() {
  const { data: me } = useApi<BillingMe>("/api/billing/me");
  const location = useLocation();
  const [dismissed, setDismissed] = React.useState(false);

  if (!me) return null;
  if (location.pathname.startsWith("/planos") || location.pathname.startsWith("/assinatura")) return null;

  // Trial expirado → banner vermelho não-dispensável
  if (me.subscription_status === "trial" && me.trial_days_left === 0) {
    return (
      <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-sm flex-shrink-0">
        <AlertTriangle size={16} />
        <span>Seu trial expirou. Você está no modo somente-leitura.</span>
        <Link to="/planos" className="bg-white text-red-600 px-3 py-1 rounded-md font-semibold text-xs hover:bg-red-50">
          Assinar agora
        </Link>
      </div>
    );
  }

  // Past due → banner âmbar
  if (me.subscription_status === "past_due") {
    return (
      <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-sm flex-shrink-0">
        <AlertTriangle size={16} />
        <span>Pagamento atrasado. Regularize pra evitar bloqueio.</span>
        <Link to="/assinatura" className="bg-white text-amber-700 px-3 py-1 rounded-md font-semibold text-xs hover:bg-amber-50">
          Ver detalhes
        </Link>
      </div>
    );
  }

  // Trial nos últimos 3 dias — banner azul leve, dispensável
  if (me.subscription_status === "trial" && me.trial_days_left > 0 && me.trial_days_left <= 3 && !dismissed) {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-b border-blue-200 dark:border-blue-800 px-4 py-2 flex items-center justify-center gap-3 text-sm flex-shrink-0">
        <Clock size={14} />
        <span>
          Seu trial termina em <strong>{me.trial_days_left} {me.trial_days_left === 1 ? "dia" : "dias"}</strong>.
        </span>
        <Link to="/planos" className="font-semibold underline hover:no-underline">
          Assinar agora
        </Link>
        <button onClick={() => setDismissed(true)} className="ml-2 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}
