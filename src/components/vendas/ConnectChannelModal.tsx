import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, RefreshCw, Smartphone, Instagram, CheckCircle,
  WifiOff, Loader2, AlertCircle, ExternalLink, KeyRound, QrCode, RotateCcw
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";

type Channel = "whatsapp" | "instagram";
type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
type ConnectMethod = "qr" | "code";

interface ConnectChannelModalProps {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (channel: Channel, connected: boolean) => void;
}

export function ConnectChannelModal({ open, onClose, onStatusChange }: ConnectChannelModalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Channel>("whatsapp");
  const [waStatus, setWaStatus] = useState<ConnStatus>("disconnected");
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [igStatus, setIgStatus] = useState<ConnStatus>("disconnected");

  // Pairing code state
  const [connectMethod, setConnectMethod] = useState<ConnectMethod>("qr");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  /* ---- extrai o base64 do QR independente do provedor ---- */
  const extractQr = (data: any): string | null => {
    if (typeof data?.base64 === "string" && data.base64.length > 20) return data.base64;
    if (typeof data?.qrcode?.base64 === "string") return data.qrcode.base64;
    if (typeof data?.code === "string" && data.code.length > 20 && !data.code.startsWith("2@"))
      return `data:image/png;base64,${data.code}`;
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
      if (state === "open" || data?.connected === true) {
        setWaStatus("connected");
        setWaQrCode(null);
        setPairingCode(null);
        setWaError(null);
        stopPolling();
        onStatusChange?.("whatsapp", true);
        return true;
      }
    } catch { /* ignora */ }
    return false;
  }, [onStatusChange]);

  /* ---- conectar via QR Code ---- */
  const handleConnectWhatsApp = async () => {
    setWaLoading(true);
    setWaQrCode(null);
    setWaError(null);

    const alreadyConnected = await checkWaStatus();
    if (alreadyConnected) { setWaLoading(false); return; }

    let qr: string | null = null;
    try {
      const createRes = await authFetch("/api/whatsapp/instance", { method: "POST" });
      const createData = await createRes.json().catch(() => ({}));
      qr = extractQr(createData);
    } catch { /* continua para polling */ }

    if (qr) {
      setWaQrCode(qr);
      setWaStatus("connecting");
      setWaLoading(false);
      pollingRef.current = setInterval(checkWaStatus, 3000);
      return;
    }

    let lastData: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await authFetch("/api/whatsapp/qrcode");
        const data = await res.json();
        lastData = data;

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
        setWaError(`QR Code não disponível. Verifique a conexão com o servidor.${detail}`);
      }
    }

    setWaLoading(false);
  };

  /* ---- conectar via código de pareamento ---- */
  const handlePairingCode = async () => {
    const clean = pairingPhone.replace(/\D/g, "");
    if (clean.length < 10) {
      setPairingError("Informe o número com DDD (ex: 11999999999)");
      return;
    }

    setPairingLoading(true);
    setPairingCode(null);
    setPairingError(null);

    try {
      const res = await authFetch("/api/whatsapp/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: clean }),
      });
      const data = await res.json();

      if (!res.ok) {
        setPairingError(data.error || "Erro ao gerar código");
        setPairingLoading(false);
        return;
      }

      if (data.already_connected) {
        setWaStatus("connected");
        onStatusChange?.("whatsapp", true);
        setPairingLoading(false);
        return;
      }

      setPairingCode(data.code);
      setWaStatus("connecting");
      // Inicia polling para detectar quando o usuário inseriu o código
      pollingRef.current = setInterval(checkWaStatus, 3000);
    } catch (err: any) {
      setPairingError(err.message || "Erro ao conectar");
    }
    setPairingLoading(false);
  };

  const handleDisconnectWhatsApp = async () => {
    stopPolling();
    setWaLoading(true);
    try {
      await authFetch("/api/whatsapp/instance", { method: "DELETE" });
    } catch (err) {
      console.error("[WA] Disconnect error:", err);
    }
    setWaStatus("disconnected");
    setWaQrCode(null);
    setPairingCode(null);
    setWaError(null);
    setPairingError(null);
    setWaLoading(false);
    onStatusChange?.("whatsapp", false);
  };

  const handleResyncWhatsApp = async () => {
    stopPolling();
    setWaLoading(true);
    setWaQrCode(null);
    setWaError(null);
    // Desconecta (apaga sessão para forçar sync completo)
    try {
      await authFetch("/api/whatsapp/instance", { method: "DELETE" });
    } catch {}
    setWaStatus("disconnected");
    onStatusChange?.("whatsapp", false);
    // Pequena pausa antes de iniciar nova sessão
    await new Promise(r => setTimeout(r, 800));
    // Inicia nova sessão com QR fresco (isso vai triggar sync completo)
    await handleConnectWhatsApp();
  };

  const checkIgStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/instagram/status");
      if (!res.ok) { setIgStatus("disconnected"); return; }
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
              connectMethod={connectMethod}
              pairingPhone={pairingPhone}
              pairingCode={pairingCode}
              pairingLoading={pairingLoading}
              pairingError={pairingError}
              onConnect={handleConnectWhatsApp}
              onDisconnect={handleDisconnectWhatsApp}
              onResync={handleResyncWhatsApp}
              onRefresh={handleConnectWhatsApp}
              onGoToSettings={() => { onClose(); navigate("/settings"); }}
              onMethodChange={(m) => { setConnectMethod(m); setWaError(null); setPairingError(null); setPairingCode(null); setWaQrCode(null); stopPolling(); setWaStatus("disconnected"); }}
              onPairingPhoneChange={setPairingPhone}
              onRequestPairingCode={handlePairingCode}
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
  connectMethod: ConnectMethod;
  pairingPhone: string;
  pairingCode: string | null;
  pairingLoading: boolean;
  pairingError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onResync: () => void;
  onRefresh: () => void;
  onGoToSettings: () => void;
  onMethodChange: (m: ConnectMethod) => void;
  onPairingPhoneChange: (v: string) => void;
  onRequestPairingCode: () => void;
}

function WhatsAppPanel({
  status, qrCode, loading, error,
  connectMethod, pairingPhone, pairingCode, pairingLoading, pairingError,
  onConnect, onDisconnect, onResync, onRefresh, onGoToSettings,
  onMethodChange, onPairingPhoneChange, onRequestPairingCode,
}: WhatsAppPanelProps) {

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
        <div className="w-full rounded-xl border border-blue-100 bg-blue-50 p-3 text-left dark:border-blue-900/40 dark:bg-blue-900/10">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Conversas não aparecem?</p>
          <p className="text-xs text-blue-600 dark:text-blue-500">
            O WhatsApp só envia o histórico completo na primeira conexão. Clique em "Ressincronizar" para reconectar e importar todas as suas conversas.
          </p>
        </div>
        <div className="flex gap-2 w-full">
          <button
            onClick={onResync}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-900/20"
          >
            <RotateCcw size={14} /> Ressincronizar histórico
          </button>
          <button onClick={onDisconnect} className="flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-900/20">
            <WifiOff size={14} /> Desconectar
          </button>
        </div>
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

  if (status === "connecting" && pairingCode) {
    const formatted = pairingCode.length === 8
      ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`
      : pairingCode;
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Insira o código no WhatsApp</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Abra o WhatsApp → <strong>Dispositivos vinculados</strong> → Vincular com número de telefone
        </p>
        <div className="rounded-xl border-2 border-green-300 bg-green-50 px-8 py-5 shadow-md dark:border-green-700 dark:bg-green-900/20">
          <p className="text-3xl font-mono font-bold tracking-widest text-green-700 dark:text-green-300">{formatted}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <Loader2 size={13} className="animate-spin" />
          Aguardando vinculação…
        </div>
        <p className="text-xs text-gray-400">O código expira em ~60 segundos. Se expirar, clique em "Gerar novo código".</p>
        <button
          onClick={onRequestPairingCode}
          disabled={pairingLoading}
          className="flex items-center gap-1.5 text-xs text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-200"
        >
          <RefreshCw size={12} /> Gerar novo código
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
          Vincule seu número para receber e enviar mensagens direto no FotoMOVE.
        </p>
      </div>

      {/* Toggle de método */}
      <div className="flex w-full rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={() => onMethodChange("qr")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
            connectMethod === "qr"
              ? "bg-white text-green-600 shadow dark:bg-gray-700 dark:text-green-400"
              : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          <QrCode size={13} /> QR Code
        </button>
        <button
          onClick={() => onMethodChange("code")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
            connectMethod === "code"
              ? "bg-white text-green-600 shadow dark:bg-gray-700 dark:text-green-400"
              : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          <KeyRound size={13} /> Código por telefone
        </button>
      </div>

      {(error || pairingError) && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-left w-full dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-700 dark:text-red-400">{error || pairingError}</p>
        </div>
      )}

      {connectMethod === "qr" ? (
        <>
          <div className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-left text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
            <p className="mb-2 font-semibold text-gray-700 dark:text-gray-300">Como conectar:</p>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Clique em <strong>"Gerar QR Code"</strong> abaixo</li>
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
            {loading ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
            {loading ? "Gerando QR Code… (aguarde até 25s)" : "Gerar QR Code"}
          </button>
        </>
      ) : (
        <>
          <div className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-left text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
            <p className="mb-2 font-semibold text-gray-700 dark:text-gray-300">Como conectar via código:</p>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Digite o número do celular com DDD abaixo</li>
              <li>Clique em <strong>"Gerar código"</strong></li>
              <li>No WhatsApp: <strong>Dispositivos vinculados → Vincular com número</strong></li>
              <li>Insira o código de 8 dígitos que aparecer aqui</li>
            </ol>
          </div>
          <div className="w-full">
            <input
              type="tel"
              value={pairingPhone}
              onChange={(e) => onPairingPhoneChange(e.target.value)}
              placeholder="Ex: 11999999999"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-green-500"
            />
          </div>
          <button
            onClick={onRequestPairingCode}
            disabled={pairingLoading || pairingPhone.replace(/\D/g, "").length < 10}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-green-600 disabled:opacity-60"
          >
            {pairingLoading ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            {pairingLoading ? "Gerando código…" : "Gerar código de pareamento"}
          </button>
        </>
      )}

      <div className="flex items-center gap-2 mt-1 w-full">
        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
        <span className="text-xs text-gray-400">ou</span>
        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
      </div>

      <button
        onClick={onGoToSettings}
        className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <ExternalLink size={11} />
        Conectar via API Oficial Meta (WhatsApp Business)
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
        <p className="text-sm text-gray-500 dark:text-gray-400">DMs chegando no FotoMOVE.</p>
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
          Receba e responda DMs diretamente no FotoMOVE.
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
