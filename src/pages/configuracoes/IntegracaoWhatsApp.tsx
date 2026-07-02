import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, MessageCircle, CheckCircle2, Phone, RefreshCw, RefreshCcw, Stethoscope, Smartphone, Cloud } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { WhatsAppTemplatesManager } from "../../components/settings/WhatsAppTemplatesManager";
import { PhoneNumberPicker } from "./PhoneNumberPicker";
import { DiagnosticPanel } from "./DiagnosticPanel";

type Tab = "conexao" | "templates";
type ConnectMode = "cloud_api" | "coexistence";

interface WaAccount {
  phone_number: string | null;
  display_name: string | null;
  connected_at?: string;
}

// ── Etiquetas do funil no WhatsApp: sincronizar tudo de uma vez ─────────────
// A troca automática acontece a cada mudança de etapa; este botão aplica a
// etiqueta da etapa ATUAL em TODOS os leads com conversa (e limpa as antigas).
function EtiquetasFunilCard() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const sincronizar = async () => {
    setBusy(true);
    setDone(null);
    try {
      const r = await authFetch('/api/whatsapp/sync-stage-labels', { method: 'POST' });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(d.error || 'Falha ao iniciar a sincronização.');
      setDone(`Sincronizando ${d.total} lead(s) em segundo plano — as etiquetas vão aparecendo no WhatsApp nos próximos minutos.`);
    } catch (e: any) {
      setDone(`⚠ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Etiquetas do funil no WhatsApp</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Aplica em todos os leads a etiqueta da etapa atual (WhatsApp Business conectado via QR). A troca automática continua a cada mudança de etapa.
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={busy}
          className="px-3.5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-60"
        >
          {busy ? 'Iniciando…' : 'Sincronizar etiquetas agora'}
        </button>
      </div>
      {done && <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">{done}</p>}
    </div>
  );
}

// ── 2º WhatsApp: Pós-venda / Alinhamento (Baileys, sessão separada) ────────
// Conecta um segundo número na MESMA conta. As conversas dele entram no mesmo
// inbox (wa_number próprio) e a Lia autônoma NÃO atende por ele — é o canal
// humano do time de alinhamento depois da venda.
function PosVendaWhatsAppCard() {
  const [pvStatus, setPvStatus] = useState<{ connected: boolean; state: string; phone: string | null } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await authFetch('/api/whatsapp/posvenda/status');
      if (r.ok) setPvStatus(await r.json());
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (pvStatus?.connected) setQr(null); }, [pvStatus?.connected]);

  const conectar = async () => {
    setBusy(true);
    setQr(null);
    try {
      const r = await authFetch('/api/whatsapp/posvenda/qrcode');
      const d = await r.json().catch(() => ({} as any));
      if (d.base64) setQr(d.base64);
      else if (d.state === 'open') loadStatus();
      else alert(d.error || 'Não foi possível gerar o QR. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const desconectar = async () => {
    setBusy(true);
    try {
      await authFetch('/api/whatsapp/posvenda/disconnect', { method: 'POST' });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const resetar = async () => {
    setConfirmReset(false);
    setBusy(true);
    try {
      await authFetch('/api/whatsapp/posvenda/reset', { method: 'POST' });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const connected = !!pvStatus?.connected;
  return (
    <div className="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Smartphone size={20} className="text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">WhatsApp Pós-venda / Alinhamento</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {connected
                ? `Conectado${pvStatus?.phone ? ` — +${pvStatus.phone}` : ''} · conversas entram no mesmo inbox, com o número do pós-venda`
                : '2º número da conta, usado pela equipe de alinhamento depois da venda (a Lia não atende por ele)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <CheckCircle2 size={13} /> Conectado
              </span>
              <button
                onClick={desconectar}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-60"
              >
                Desconectar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={conectar}
                disabled={busy}
                className="px-3.5 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-60"
              >
                {busy ? 'Gerando QR…' : qr ? 'Gerar novo QR' : 'Conectar 2º número'}
              </button>
              <button
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                title="Apaga as credenciais salvas deste número"
                className="px-2.5 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-60"
              >
                Limpar sessão
              </button>
            </>
          )}
        </div>
      </div>
      {!connected && qr && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <img
            src={qr}
            alt="QR Code do WhatsApp Pós-venda"
            className="w-52 h-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-2"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            No celular do pós-venda: WhatsApp → Aparelhos conectados → Conectar aparelho
          </p>
        </div>
      )}
      <ConfirmModal
        open={confirmReset}
        title="Limpar sessão do pós-venda?"
        message="Apaga as credenciais salvas deste 2º número. Você vai precisar escanear o QR de novo."
        confirmText="Limpar"
        variant="warning"
        onConfirm={resetar}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

export default function IntegracaoWhatsApp() {
  const [tab, setTab] = useState<Tab>("conexao");
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<WaAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<ConnectMode | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [phonePickerOpen, setPhonePickerOpen] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  // Plan B (fallback manual): só aparece depois de 1 falha do fluxo automático.
  // Chatwoot e Twilio Tech Provider oferecem o mesmo escape hatch — System
  // User Token de 60 dias + WABA ID + Phone Number ID colados na mão.
  const [autoFlowFailed, setAutoFlowFailed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [manualWabaId, setManualWabaId] = useState("");
  const [manualPhoneId, setManualPhoneId] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await authFetch("/api/meta/whatsapp/status");
      const data = await res.json();
      setConnected(data.connected);
      setAccount(data.account || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    // SDK do Facebook (uma vez por página)
    if (!document.getElementById("facebook-jssdk")) {
      (window as any).fbAsyncInit = function () {
        (window as any).FB?.init({
          appId: import.meta.env.VITE_META_APP_ID,
          autoLogAppEvents: true,
          xfbml: true,
          version: "v21.0",
        });
      };
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, []);

  const connectMode = (mode: ConnectMode) => {
    const configId = import.meta.env.VITE_META_WA_CONFIG_ID;
    if (!configId) return alert("VITE_META_WA_CONFIG_ID não configurado no .env");
    const FB = (window as any).FB;
    if (!FB) return alert("SDK do Facebook não carregado. Tente recarregar a página.");

    // Embedded Signup v4 (popup mode) — extras condicionais por modo:
    // - sessionInfoVersion: 3 como number (doc oficial Meta v4 / Y-Cloud).
    // - featureType: SÓ no modo coexistence. Mandar string vazia no cloud_api
    //   faz a Meta gerar code com flow inválido — omite a chave nesse caso.
    const extras: any = { setup: {}, sessionInfoVersion: 3 };
    if (mode === "coexistence") {
      extras.featureType = "whatsapp_business_app_onboarding";
    }

    const launcherUrl = window.location.origin;
    console.log("[WA] launcher_url (origin sem path):", launcherUrl);

    // ACHADO EMPÍRICO (URL capturada do popup real em 2026-05-30):
    // O FB SDK em popup mode + response_type=code USA xd_arbiter COM HASH
    // FRAGMENT ÚNICO POR CHAMADA como redirect_uri. Exemplo:
    //   https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46
    //     #cb=f18729cd3f0d80b32        (callback ID, gerado fresh)
    //     &domain=crmtrilha.com.br
    //     &origin=https://crmtrilha.com.br/f841846589564be98  (path único)
    //     &frame=f56e5d3f812eadfd6     (frame ID, gerado fresh)
    // Meta assina o code com essa URL EXATA. Como cb/origin/frame mudam a
    // cada chamada, o backend não consegue prever — só capturando aqui
    // antes do FB.login e enviando junto. Sem isso → "Error validating
    // verification code" (subcode 36008). Tentativas anteriores falharam
    // (window.location.origin / xd_arbiter sem hash / omitir) porque
    // nenhuma batia byte-a-byte com o que a Meta assinou.
    let fbSdkRedirectUri = "";
    const _originalOpen = window.open;
    window.open = function (url: any, ...args: any[]) {
      if (typeof url === "string" && url.includes("/dialog/oauth")) {
        try {
          const parsed = new URL(url);
          const ru = parsed.searchParams.get("redirect_uri");
          if (ru) {
            fbSdkRedirectUri = ru;
            console.log("[WA] capturado fb_sdk_redirect_uri:", ru);
          }
        } catch {
          /* ignora URL inválida — só restaura comportamento default */
        }
      }
      return _originalOpen.call(window, url, ...args);
    };

    setConnecting(mode);
    FB.login(
      (response: any) => {
        // Restaura window.open ANTES de qualquer await — evita vazar o
        // monkey-patch pra outras partes do app.
        window.open = _originalOpen;

        if (response.authResponse?.code) {
          authFetch("/api/meta/whatsapp/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: response.authResponse.code,
              mode,
              launcher_url: launcherUrl,
              fb_sdk_redirect_uri: fbSdkRedirectUri,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.success) {
                setAutoFlowFailed(false);
                checkStatus();
              } else {
                setAutoFlowFailed(true);
                alert("Erro ao conectar: " + (data.error || "desconhecido"));
              }
            })
            .catch(() => setAutoFlowFailed(true))
            .finally(() => setConnecting(null));
        } else {
          setConnecting(null);
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        // auth_type: 'rerequest' foi REMOVIDO. config_id +
        // override_default_response_type já forçam o popup v4 do Embedded
        // Signup — não é necessário forçar reauth, e rerequest é conhecido
        // por interferir com o wizard (re-prompt de permissões pode
        // disparar code de flow OAuth tradicional, que exige redirect_uri
        // no exchange e retorna "Error validating verification code").
        extras,
      }
    );
  };

  const disconnect = async () => {
    await authFetch("/api/meta/whatsapp/disconnect", { method: "DELETE" });
    setConnected(false);
    setAccount(null);
    setConfirmDisconnect(false);
  };

  // Plan B: conectar manualmente colando System User Token de 60 dias.
  // Backend aceita {access_token, waba_id, phone_number_id, mode} sem code.
  // Esse fluxo é o que Chatwoot/Twilio Tech Provider oferecem como fallback
  // quando Embedded Signup falha — token gerado em business.facebook.com >
  // Configurações > Usuários > Usuários do sistema, escopo
  // whatsapp_business_management + whatsapp_business_messaging.
  const submitManual = async () => {
    if (!manualToken.trim() || !manualWabaId.trim() || !manualPhoneId.trim()) {
      alert("Preencha token, WABA ID e Phone Number ID.");
      return;
    }
    setManualSubmitting(true);
    try {
      const res = await authFetch("/api/meta/whatsapp/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: manualToken.trim(),
          waba_id: manualWabaId.trim(),
          phone_number_id: manualPhoneId.trim(),
          mode: "cloud_api",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setManualOpen(false);
        setManualToken("");
        setManualWabaId("");
        setManualPhoneId("");
        setAutoFlowFailed(false);
        checkStatus();
      } else {
        alert("Erro: " + (data.error || "desconhecido"));
      }
    } catch (e: any) {
      alert("Falha: " + (e?.message || "erro de rede"));
    } finally {
      setManualSubmitting(false);
    }
  };

  const subscribeWebhook = async () => {
    setSubscribing(true);
    try {
      const res = await authFetch("/api/meta/whatsapp/subscribe-webhook", { method: "POST" });
      const data = await res.json();
      if (data.success) alert("Webhook ativado com sucesso!");
      else alert("Resposta do Meta: " + JSON.stringify(data));
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <Link to="/configuracoes/integracoes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
        <ChevronLeft size={16} /> Voltar para integrações
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <MessageCircle size={26} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">WhatsApp Business</h2>
              {connected && (
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={11} /> Conectado
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Conecte sua conta oficial do WhatsApp Business pra enviar mensagens, templates aprovados pelo Meta e automações de follow-up.
            </p>
            {connected && account && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Phone size={12} />
                <span className="font-medium text-gray-700 dark:text-gray-300">{account.display_name || "Conta conectada"}</span>
                {account.phone_number && <span>· {account.phone_number}</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {([
          { id: "conexao" as Tab, label: "Conexão" },
          { id: "templates" as Tab, label: "Templates aprovados pelo Meta" },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da sub-tab */}
      {tab === "conexao" && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Status da conexão</h3>
          {loading ? (
            <div className="flex justify-center py-4"><RefreshCw className="animate-spin text-gray-400" /></div>
          ) : !connected ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                A conexão é feita via Meta (Facebook) - você vai precisar autorizar o app com sua conta comercial. Escolha como quer conectar:
              </p>

              {/* Botão primário: Coexistence */}
              <div>
                <button
                  onClick={() => connectMode("coexistence")}
                  disabled={connecting !== null}
                  className="w-full sm:w-auto flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg disabled:opacity-60"
                >
                  {connecting === "coexistence" ? <RefreshCw size={16} className="animate-spin" /> : <Smartphone size={16} />}
                  {connecting === "coexistence" ? "Conectando…" : "Conectar (mantém WhatsApp no celular)"}
                </button>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Recomendado — Coexistence Mode oficial Meta
                </p>
              </div>

              {/* Botão secundário: Cloud API tradicional */}
              <div>
                <button
                  onClick={() => connectMode("cloud_api")}
                  disabled={connecting !== null}
                  className="w-full sm:w-auto flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold rounded-lg disabled:opacity-60"
                >
                  {connecting === "cloud_api" ? <RefreshCw size={16} className="animate-spin" /> : <Cloud size={16} />}
                  {connecting === "cloud_api" ? "Conectando…" : "Conectar (substituir WhatsApp Business app)"}
                </button>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Cloud API tradicional — número sai do celular
                </p>
              </div>

              {/* Plan B: só aparece depois de falhar o fluxo automático */}
              {autoFlowFailed && (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setManualOpen(true)}
                    className="text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    Conectar manualmente (System User Token)
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Use se o fluxo automático falhar. Gere o token em business.facebook.com &gt; Usuários do sistema.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPhonePickerOpen(true)}
                  title="Escolher outro número entre os que você autorizou no Facebook"
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-lg text-sm font-semibold"
                >
                  <RefreshCcw size={13} />
                  Trocar número
                </button>
                <button
                  onClick={() => setDiagnosticOpen(true)}
                  title="Roda uma bateria de checagens na conexão e mostra o que tá quebrado"
                  className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded-lg text-sm font-semibold"
                >
                  <Stethoscope size={13} />
                  Diagnosticar
                </button>
                <button
                  onClick={subscribeWebhook}
                  disabled={subscribing}
                  title="Reativa o recebimento de mensagens no Inbox"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  {subscribing && <RefreshCw size={13} className="animate-spin" />}
                  Reparar webhook
                </button>
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg text-sm font-semibold"
                >
                  Desconectar
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Tudo funcionando? Vá para a aba <strong>Templates</strong> pra criar e enviar mensagens aprovadas pelo Meta.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "templates" && (
        <div>
          {!connected ? (
            <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 rounded-2xl p-6 text-center">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Conecte o WhatsApp Business primeiro pra gerenciar templates.
              </p>
              <button
                onClick={() => setTab("conexao")}
                className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300 underline hover:no-underline"
              >
                Ir para Conexão
              </button>
            </div>
          ) : (
            <WhatsAppTemplatesManager
              onNotify={(kind, message) => {
                if (kind === "error") alert("Erro: " + message);
                else alert(message);
              }}
            />
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmDisconnect}
        title="Desconectar WhatsApp Business?"
        message="As automações de mensagens serão desativadas e você não receberá mais mensagens no Inbox."
        confirmText="Desconectar"
        variant="warning"
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <PhoneNumberPicker
        open={phonePickerOpen}
        onClose={() => setPhonePickerOpen(false)}
        onChanged={checkStatus}
      />

      <DiagnosticPanel
        open={diagnosticOpen}
        onClose={() => setDiagnosticOpen(false)}
      />

      {/* Modal de conexão manual (Plan B) */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Conectar manualmente
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Cole um System User Token de 60 dias (escopo whatsapp_business_management + whatsapp_business_messaging) e os IDs da WABA e do número.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  System User Token
                </label>
                <input
                  type="password"
                  value={manualToken}
                  onChange={e => setManualToken(e.target.value)}
                  placeholder="EAAG..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  WABA ID
                </label>
                <input
                  type="text"
                  value={manualWabaId}
                  onChange={e => setManualWabaId(e.target.value)}
                  placeholder="1234567890"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Phone Number ID
                </label>
                <input
                  type="text"
                  value={manualPhoneId}
                  onChange={e => setManualPhoneId(e.target.value)}
                  placeholder="0987654321"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setManualOpen(false)}
                disabled={manualSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={submitManual}
                disabled={manualSubmitting}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-60"
              >
                {manualSubmitting ? "Conectando…" : "Conectar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2º número: pós-venda/alinhamento */}
      <PosVendaWhatsAppCard />
    </div>
  );
}
