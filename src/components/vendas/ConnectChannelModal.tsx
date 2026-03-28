import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, RefreshCw, Smartphone, Instagram, CheckCircle,
  WifiOff, Loader2, AlertCircle
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";

type Channel = "whatsapp" | "instagram";
type ConnStatus = "disconnected" | "connecting" | "connected" | "error";

interface ConnectChannelModalProps {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (channel: Channel, connected: boolean) => void;
}

export function ConnectChannelModal({ open, onClose, onStatusChange }: ConnectChannelModalProps) {
  const [activeTab, setActiveTab] = useState<Channel>("whatsapp");
  const [waStatus, setWaStatus] = useState<ConnStatus>("disconnected");
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [igStatus, setIgStatus] = useState<ConnStatus>("disconnected");

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  /* ---- extrai o base64 do QR independente do provedor ---- */
  const extractQr = (data: any): string | null => {
    // v1: { base64: "data:image/png;base64,..." }
    if (typeof data?.base64 === "string" && data.base64.length > 20) return data.base64;
    // v2: { qrcode: { base64: "..." } }
    if (typeof data?.qrcode?.base64 === "string") return data.qrcode.base64;
    // v2 flat: { code: "...", base64: "..." }
    if (typeof data?.code === "string" && data.code.length > 20 && !data.code.startsWith("2@"))
      return `data:image/png;base64,${data.code}`;
    // v2 inner: { instance: { qrcode: { base64: "..." } } }
    if (typeof data?.instance?.qrcode?.base64 === "string") return data.instance.qrcode.base64;
    return null;
  };

  /* ---- verifica se a instância já está conectada ---- */
  const checkWaStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await authFetch("/api/whatsapp/status");
      const data = await res.json();
      const state: string =
        data?.instance?.state ?? data?.state ?? data?.connectionStatus ?? "";
      if (state === "open") {
        setWaStatus("connected");
        setWaQrCode(null);
        setWaError(null);
        stopPolling();
        onStatusChange?.("whatsapp", true);
        return true;
      }
    } catch { /* ignora */ }
    return false;
  }, [onStatusChange]);

  /* ---- tenta criar + busca QR Code ---- */
  const handleConnectWhatsApp = async () => {
    setWaLoading(true);
    setWaQrCode(null);
    setWaError(null);

    // Passo 1: verifica se já está conectado antes de criar instância
    const alreadyConnected = await checkWaStatus();
    if (alreadyConnected) { setWaLoading(false); return; }

    // Passo 2: inicia conexão Baileys no servidor
    let qr: string | null = null;
    try {
      const createRes = await authFetch("/api/whatsapp/instance", { method: "POST" });
      console.log("[WA] create instance status:", createRes.status);
      const createData = await createRes.json().catch(() => ({}));
      qr = extractQr(createData);
      if (qr) console.log("[WA] QR na resposta de criação!");
    } catch { /* continua para polling */ }

    if (qr) {
      setWaQrCode(qr);
      setWaStatus("connecting");
      setWaLoading(false);
      pollingRef.current = setInterval(checkWaStatus, 3000);
      return;
    }

    // Passo 3: chama /api/whatsapp/qrcode — o servidor aguarda internamente até 20s pelo QR
    // Fazemos até 3 tentativas (cobrindo ~60s no total)
    let lastData: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[WA] Chamando /qrcode (tentativa ${attempt}/3, servidor aguardará até 20s)...`);
        const res = await authFetch("/api/whatsapp/qrcode");
        const data = await res.json();
        lastData = data;
        console.log(`[WA] /qrcode resposta (tentativa ${attempt}):`, JSON.stringify(data).substring(0, 300));

        const state: string = data?.instance?.state ?? data?.state ?? data?.connectionStatus ?? "";
        if (state === "open") {
          setWaStatus("connected");
          onStatusChange?.("whatsapp", true);
          setWaLoading(false);
          return;
        }

        qr = extractQr(data);
        if (qr) break;
      } catch (err: any) {
        console.warn(`[WA] /qrcode tentativa ${attempt} erro:`, err.message);
      }
    }

    if (qr) {
      setWaQrCode(qr);
      setWaStatus("connecting");
      stopPolling();
      pollingRef.current = setInterval(checkWaStatus, 3000);
    } else {
      const already = await checkWaStatus();
      if (!already) {
        const detail = lastData ? ` (resposta: ${JSON.stringify(lastData).substring(0, 120)})` : "";
        setWaError(`QR Code não disponível. Verifique as credenciais e a conexão com o provedor WhatsApp.${detail}`);
      }
    }

    setWaLoading(false);
  };

  const handleDisconnectWhatsApp = async () => {
    stopPolling();
    setWaLoading(true);
    try {
      const res = await authFetch("/api/whatsapp/instance", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[WA] Disconnect failed:", data);
      }
    } catch (err) {
      console.error("[WA] Disconnect error:", err);
    }
    setWaStatus("disconnected");
    setWaQrCode(null);
    setWaError(null);
    setWaLoading(false);
    onStatusChange?.("whatsapp", false);
  };

  const checkIgStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/instagram/status");
      if (!res.ok) { setIgStatus("disconnected"); return; } // 503 = não configurado, ignora
      const data = await res.json();
      const state: string = data?.instance?.state ?? data?.state ?? "";
      const connected = state === "open";
      setIgStatus(connected ? "connected" : "disconnected");
      onStatusChange?.("instagram", connected);
    } catch { setIgStatus("disconnected"); }
  }, [onStatusChange]);

  useEffect(() => {
    if (!open) { stopPolling(); return; }
    checkWaStatus();
    checkIgStatus();
    return () => stopPolling();
  }, [open, checkWaStatus, checkIgStatus]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Conectar Canais</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(["whatsapp", "instagram"] as Channel[]).map((ch) => {
            const status = ch === "whatsapp" ? waStatus : igStatus;
            return (
              <button
                key={ch}
                onClick={() => setActiveTab(ch)}
                className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition ${
                  activeTab === ch
                    ? ch === "whatsapp"
                      ? "border-b-2 border-green-500 text-green-600"
                      : "border-b-2 border-pink-500 text-pink-600"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                {ch === "whatsapp" ? <Smartphone size={16} /> : <Instagram size={16} />}
                {ch === "whatsapp" ? "WhatsApp" : "Instagram"}
                <StatusDot status={status} />
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === "whatsapp" ? (
            <WhatsAppPanel
              status={waStatus}
              qrCode={waQrCode}
              loading={waLoading}
              error={waError}
              onConnect={handleConnectWhatsApp}
              onDisconnect={handleDisconnectWhatsApp}
              onRefresh={handleConnectWhatsApp}
            />
          ) : (
            <InstagramPanel status={igStatus} onRefresh={checkIgStatus} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ConnStatus }) {
  if (status === "connected") return <span className="h-2 w-2 rounded-full bg-green-500" />;
  if (status === "connecting") return <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />;
  return <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />;
}

interface WhatsAppPanelProps {
  status: ConnStatus;
  qrCode: string | null;
  loading: boolean;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}

function WhatsAppPanel({ status, qrCode, loading, error, onConnect, onDisconnect, onRefresh }: WhatsAppPanelProps) {
  if (status === "connected") {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <CheckCircle size={36} className="text-green-500" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">WhatsApp conectado!</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Mensagens chegando em tempo real.</p>
        </div>
        <button onClick={onDisconnect} className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-900/20">
          <WifiOff size={15} /> Desconectar
        </button>
      </div>
    );
  }

  if (status === "connecting" && qrCode) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Escaneie o QR Code com o WhatsApp</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Abra o WhatsApp → <strong>Dispositivos vinculados</strong> → Vincular um dispositivo
        </p>
        <div className="rounded-xl border-2 border-green-200 bg-white p-3 shadow-md dark:border-green-800 dark:bg-gray-800">
          <img
            src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code WhatsApp"
            className="h-52 w-52 object-contain"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <Loader2 size={13} className="animate-spin" />
          Aguardando leitura…
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-xs text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-200">
          <RefreshCw size={12} /> Atualizar QR Code
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
        <Smartphone size={32} className="text-green-500" />
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Conectar WhatsApp</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Vincule seu número para receber e enviar mensagens direto no FocalPoint.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-left dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Instruções rápidas */}
      <div className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-left text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
        <p className="mb-2 font-semibold text-gray-700 dark:text-gray-300">Como conectar:</p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>Clique em <strong>"Conectar via QR Code"</strong> abaixo</li>
          <li>Abra o WhatsApp no celular</li>
          <li>Toque em <strong>⋮ → Dispositivos vinculados</strong></li>
          <li>Escaneie o QR Code que aparecer aqui</li>
        </ol>
      </div>

      <button
        onClick={onConnect}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-green-600 disabled:opacity-60"
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />}
        {loading ? "Aguarde, conectando… (pode levar até 10s)" : "Conectar via QR Code"}
      </button>
    </div>
  );
}

function InstagramPanel({ status, onRefresh }: { status: ConnStatus; onRefresh: () => void }) {
  if (status === "connected") {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-900/30">
          <CheckCircle size={36} className="text-pink-500" />
        </div>
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Instagram conectado!</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">DMs chegando no FocalPoint.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30">
        <Instagram size={32} className="text-pink-500" />
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Conectar Instagram DM</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Receba e responda DMs diretamente no FocalPoint.
        </p>
      </div>
      <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4 text-left dark:border-amber-800 dark:bg-amber-900/20">
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Requisitos:</p>
        <ul className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-500">
          <li>• Conta Instagram Business ou Creator</li>
          <li>• Página do Facebook vinculada</li>
          <li>• Credenciais configuradas no provedor WhatsApp (Z-API/Evolution)</li>
        </ul>
      </div>
      <button
        onClick={onRefresh}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
      >
        <RefreshCw size={14} /> Verificar conexão
      </button>
    </div>
  );
}
