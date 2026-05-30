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

    setConnecting(mode);
    FB.login(
      (response: any) => {
        if (response.authResponse?.code) {
          // No popup mode v4 o vínculo é via config_id — backend NÃO precisa
          // (nem deve) mandar redirect_uri no exchange. Só passa code + mode.
          authFetch("/api/meta/whatsapp/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: response.authResponse.code,
              mode,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.success) checkStatus();
              else alert("Erro ao conectar: " + (data.error || "desconhecido"));
            })
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
    </div>
  );
}
