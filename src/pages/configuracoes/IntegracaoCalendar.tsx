import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Calendar, CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../../components/ui/ConfirmModal";

export default function IntegracaoCalendar() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [config, setConfig] = useState<{ hasClientId?: boolean; hasClientSecret?: boolean; clientIdPreview?: string; clientIdLength?: number } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await authFetch("/api/auth/google/status");
      const data = await res.json();
      setConnected(!!data.connected);
    } catch { /* */ }
  };

  const fetchConfig = async () => {
    try {
      const res = await authFetch("/api/auth/google/config-check");
      setConfig(await res.json());
    } catch { /* */ }
  };

  useEffect(() => {
    Promise.all([checkStatus(), fetchConfig()]).finally(() => setLoading(false));
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "google_auth_success") checkStatus();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = async () => {
    try {
      const res = await authFetch("/api/auth/google/url");
      const { url } = await res.json();
      window.open(url, "google_auth_popup", "width=600,height=700");
    } catch (e) {
      console.error(e);
    }
  };

  const disconnect = async () => {
    await authFetch("/api/auth/google/disconnect", { method: "POST" });
    checkStatus();
    setConfirmDisconnect(false);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await authFetch("/api/auth/google/sync-all", { method: "POST" });
      const data = await res.json();
      if (data.success) alert(`${data.pushed} trabalhos enviados e ${data.pulled} eventos importados.`);
      else alert("Erro ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <Link to="/configuracoes/integracoes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
        <ChevronLeft size={16} /> Voltar para integrações
      </Link>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-gold-50 dark:bg-gold-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Calendar size={26} className="text-gold-600 dark:text-gold-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Google Calendar</h2>
              {connected && (
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={11} /> Conectado
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Conecte sua conta do Google pra sincronizar automaticamente todos os ensaios marcados aqui no seu calendário pessoal.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : !connected ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={connect}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gold-600 hover:bg-gold-700 text-white font-semibold rounded-lg"
            >
              Conectar Google Calendar
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-300 hover:bg-gold-100 dark:hover:bg-gold-900/30 rounded-lg font-semibold text-sm disabled:opacity-60"
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Sincronizando…" : "Sincronizar agora"}
            </button>
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg font-semibold text-sm"
            >
              Desconectar
            </button>
          </div>
        )}

        {config && (!config.hasClientId || !config.hasClientSecret) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300 text-xs">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              Credenciais (Client ID/Secret) não estão configuradas no servidor.
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        title="Desconectar Google Calendar?"
        message="As próximas marcações não serão mais sincronizadas com seu calendário."
        confirmText="Desconectar"
        variant="warning"
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
