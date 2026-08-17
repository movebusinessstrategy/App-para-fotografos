import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Calendar, CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { useAuth } from "../../contexts/AuthContext";

export default function IntegracaoCalendar() {
  // Desconectar é ação do DONO — funcionário operava com o userId do dono e
  // conseguia apagar a conexão da conta inteira (o backend agora também barra).
  const { isMember, isImpersonating } = useAuth();
  const canManage = !isMember && !isImpersonating;
  const [connected, setConnected] = useState(false);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [config, setConfig] = useState<{ hasClientId?: boolean; hasClientSecret?: boolean; clientIdPreview?: string; clientIdLength?: number } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await authFetch("/api/auth/google/status");
      const data = await res.json();
      const healthy = data.healthy !== false;
      setConnected(Boolean(data.connected && healthy));
      setReconnectRequired(Boolean(data.connected && data.reconnect_required));
      setAccountEmail(typeof data.account_email === "string" ? data.account_email : null);
      setPendingInvites(Number.isFinite(data.pending_invites) ? data.pending_invites : null);
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
      if (event.data?.type === "GOOGLE_AUTH_SUCCESS") checkStatus();
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
    setConfirmSync(false);
    setSyncing(true);
    try {
      const res = await authFetch("/api/auth/google/sync-all", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const base = `${data.pushed ?? 0} ensaios enviados pro Google Calendar e ${data.imported ?? 0} eventos importados de lá.`;
        alert(data.remaining > 0
          ? `${base}\n\nAinda faltam ${data.remaining} ensaios — clique em "Sincronizar agora" de novo pra enviar o restante.`
          : base);
        await checkStatus();
      } else alert("Erro ao sincronizar.");
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
              {reconnectRequired && (
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <AlertCircle size={11} /> Reconexão necessária
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Conecte a conta Google do estúdio para sincronizar automaticamente os ensaios no calendário principal dessa conta.
            </p>
            {connected && accountEmail && (
              <p className="mt-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                Conta conectada: {accountEmail}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
          <p className="font-semibold text-gray-800 dark:text-gray-100">O que acontece ao conectar</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>O CRM consulta os eventos do calendário principal para sincronizar datas e horários.</li>
            <li>Cria, atualiza ou exclui eventos correspondentes aos ensaios marcados no aplicativo.</li>
            <li>Adiciona o e-mail do cliente como participante e solicita ao Google o envio do convite.</li>
            <li>Mantém acesso offline até o dono da conta desconectar a integração.</li>
          </ul>
          <p className="mt-2">Detalhes na <Link to="/privacidade" className="font-semibold text-gold-700 hover:underline dark:text-gold-300">Política de Privacidade</Link>.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : !connected ? (
          canManage ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={connect}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gold-600 hover:bg-gold-700 text-white font-semibold rounded-lg"
              >
                {reconnectRequired ? "Reconectar Google Calendar" : "Conectar Google Calendar"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              {isImpersonating
                ? "Saia do modo de visualização administrativa para conectar a Conta Google do estúdio."
                : "Só o dono da conta pode conectar o Google Calendar."}
            </p>
          )
        ) : (
          canManage ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setConfirmSync(true)}
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
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              A conexão pode ser consultada aqui, mas somente o dono real da conta pode sincronizar ou desconectar.
            </p>
          )
        )}

        {config && (!config.hasClientId || !config.hasClientSecret) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300 text-xs">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              Credenciais (Client ID/Secret) não estão configuradas no servidor.
            </div>
          </div>
        )}

        {connected && pendingInvites !== null && pendingInvites > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200 text-xs">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              Existem {pendingInvites} ensaios futuros antigos fora do Google Agenda. A sincronização manual pode enviar convites por e-mail a esses clientes.
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
      <ConfirmModal
        open={confirmSync}
        title={pendingInvites && pendingInvites > 0 ? `Sincronizar ${pendingInvites} ensaios antigos?` : "Sincronizar Google Agenda?"}
        message={pendingInvites && pendingInvites > 0
          ? "Ao confirmar, o sistema pode enviar convites por e-mail aos clientes desses ensaios, em lotes de até 25. Continue somente se quiser atualizar a agenda antiga."
          : "Esta ação busca eventos do Google e sincroniza qualquer ensaio futuro que ainda esteja pendente."}
        confirmText="Sincronizar"
        variant="warning"
        onConfirm={sync}
        onCancel={() => setConfirmSync(false)}
      />
    </div>
  );
}
