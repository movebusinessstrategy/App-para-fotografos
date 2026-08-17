import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, RefreshCw, Smartphone, Instagram, CheckCircle,
  WifiOff, Loader2, AlertCircle, KeyRound, QrCode,
  RotateCcw, Building2, ArrowRight, Settings, Zap, ShieldCheck
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../utils/authFetch";

type Channel = "whatsapp" | "instagram";
type ConnStatus = "disconnected" | "connecting" | "connected" | "error";
type ConnectMethod = "qr" | "code" | "api";

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

  const [connectMethod, setConnectMethod] = useState<ConnectMethod>("qr");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  const extractQr = (data: any): string | null => {
    if (typeof data?.base64 === "string" && data.base64.length > 20) return data.base64;
    if (typeof data?.qrcode?.base64 === "string") return data.qrcode.base64;
    if (typeof data?.code === "string" && data.code.length > 20 && !data.code.startsWith("2@"))
      return `data:image/png;base64,${data.code}`;
    if (typeof data?.instance?.qrcode?.base64 === "string") return data.instance.qrcode.base64;
    return null;
  };

  const checkWaStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await authFetch("/api/whatsapp/status");
      const data = await res.json();
      const state: string = data?.instance?.state ?? data?.state ?? data?.connectionStatus ?? "";
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

  // fresh=false (Gerar/Atualizar QR): nunca apaga credenciais — respeita uma
  // sessão válida que esteja só reconectando. fresh=true ("Limpar sessão e
  // gerar novo QR"): limpa as creds no servidor antes, destravando o caso de
  // creds registradas que não reconectam (o WhatsApp nunca emite QR nesse caso).
  const handleConnectWhatsApp = async (fresh = false) => {
    setWaLoading(true);
    setWaQrCode(null);
    setWaError(null);

    const alreadyConnected = await checkWaStatus();
    if (alreadyConnected) { setWaLoading(false); return; }

    let qr: string | null = null;
    try {
      const createRes = await authFetch("/api/whatsapp/instance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fresh }),
      });
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
      if (!res.ok) { setPairingError(data.error || "Erro ao gerar código"); setPairingLoading(false); return; }
      if (data.already_connected) {
        setWaStatus("connected");
        onStatusChange?.("whatsapp", true);
        setPairingLoading(false);
        return;
      }
      setPairingCode(data.code);
      setWaStatus("connecting");
      pollingRef.current = setInterval(checkWaStatus, 3000);
    } catch (err: any) {
      setPairingError(err.message || "Erro ao conectar");
    }
    setPairingLoading(false);
  };

  const handleDisconnectWhatsApp = async () => {
    stopPolling();
    setWaLoading(true);
    try { await authFetch("/api/whatsapp/instance", { method: "DELETE" }); } catch {}
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
    try { await authFetch("/api/whatsapp/instance", { method: "DELETE" }); } catch {}
    setWaStatus("disconnected");
    onStatusChange?.("whatsapp", false);
    await new Promise(r => setTimeout(r, 800));
    await handleConnectWhatsApp();
  };

  const checkIgStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/instagram/status");
      if (!res.ok) { setIgStatus("disconnected"); return; }
      const data = await res.json();
      const connected = (data?.instance?.state ?? data?.state ?? "") === "open";
      setIgStatus(connected ? "connected" : "disconnected");
      onStatusChange?.("instagram", connected);
    } catch { setIgStatus("disconnected"); }
  }, [onStatusChange]);

  const handleMethodChange = (m: ConnectMethod) => {
    setConnectMethod(m);
    setWaError(null);
    setPairingError(null);
    setPairingCode(null);
    setWaQrCode(null);
    stopPolling();
    if (waStatus !== "connected") setWaStatus("disconnected");
  };

  useEffect(() => {
    if (!open) { stopPolling(); return; }
    checkWaStatus();
    checkIgStatus();
    return () => stopPolling();
  }, [open, checkWaStatus, checkIgStatus]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
    >
      <div className="relative w-full max-w-3xl rounded-3xl bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
        style={{ maxHeight: "92vh", display: "flex", flexDirection: "column" }}
      >
        {/* ── Header ── */}
        <div className="relative overflow-hidden flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #14532d 0%, #166534 50%, #15803d 100%)" }}
        >
          {/* Círculos decorativos */}
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white opacity-[0.06]" />
          <div className="absolute -bottom-8 left-8 h-32 w-32 rounded-full bg-white opacity-[0.04]" />
          <div className="absolute top-4 right-32 h-16 w-16 rounded-full bg-white opacity-[0.05]" />

          <div className="relative px-8 py-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Conectar Canais</h2>
                <p className="text-green-200 text-sm mt-0.5">Vincule seu WhatsApp ou Instagram ao Trilha</p>
              </div>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                <X size={17} />
              </button>
            </div>

            {/* Tabs de canal */}
            <div className="mt-5 flex gap-1.5 rounded-2xl bg-black/20 p-1.5">
              {(["whatsapp", "instagram"] as Channel[]).map((ch) => {
                const s = ch === "whatsapp" ? waStatus : igStatus;
                const active = activeTab === ch;
                return (
                  <button
                    key={ch}
                    onClick={() => setActiveTab(ch)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                      active ? "bg-white text-gray-800 shadow-md" : "text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {ch === "whatsapp" ? <Smartphone size={15} /> : <Instagram size={15} />}
                    {ch === "whatsapp" ? "WhatsApp" : "Instagram"}
                    <span className={`h-2 w-2 rounded-full ${
                      s === "connected" ? "bg-emerald-400" :
                      s === "connecting" ? "bg-yellow-400 animate-pulse" :
                      active ? "bg-gray-300" : "bg-white/30"
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Conteúdo ── */}
        <div className="flex-1 overflow-y-auto p-8">
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
              onConnect={() => handleConnectWhatsApp(false)}
              onFreshConnect={() => handleConnectWhatsApp(true)}
              onDisconnect={handleDisconnectWhatsApp}
              onResync={handleResyncWhatsApp}
              onRefresh={() => handleConnectWhatsApp(false)}
              onGoToSettings={() => { onClose(); navigate("/configuracoes/integracoes/whatsapp"); }}
              onMethodChange={handleMethodChange}
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
  onFreshConnect: () => void;
  onDisconnect: () => void;
  onResync: () => void;
  onRefresh: () => void;
  onGoToSettings: () => void;
  onMethodChange: (m: ConnectMethod) => void;
  onPairingPhoneChange: (v: string) => void;
  onRequestPairingCode: () => void;
}

// ─── WhatsApp Panel ───────────────────────────────────────────────────────────

function WhatsAppPanel({
  status, qrCode, loading, error,
  connectMethod, pairingPhone, pairingCode, pairingLoading, pairingError,
  onConnect, onFreshConnect, onDisconnect, onResync, onRefresh, onGoToSettings,
  onMethodChange, onPairingPhoneChange, onRequestPairingCode,
}: WhatsAppPanelProps) {

  // ── Conectado ────────────────────────────────────────────────────────────
  if (status === "connected") {
    return (
      <div className="flex flex-col gap-5 max-w-lg mx-auto">
        <div className="flex items-center gap-4 rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 p-5">
          <div className="relative flex-shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-600 shadow-lg shadow-green-300/40 dark:shadow-green-900/40">
              <CheckCircle size={28} className="text-white" />
            </div>
            <span className="absolute -right-1 -top-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-green-500" />
            </span>
          </div>
          <div>
            <p className="text-base font-bold text-green-800 dark:text-green-300">WhatsApp conectado</p>
            <p className="text-sm text-green-600 dark:text-green-500 mt-0.5">Mensagens chegando em tempo real</p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-900/10 p-5">
          <div className="flex gap-3">
            <RotateCcw size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Conversas não aparecem?</p>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-1 leading-relaxed">
                O WhatsApp só envia o histórico completo na primeira conexão. Clique em <strong>Ressincronizar</strong> para reconectar e importar todas as conversas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onResync}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-blue-600 dark:text-blue-400 transition hover:bg-blue-50 dark:hover:bg-blue-900/20 shadow-sm">
            <RotateCcw size={15} /> Ressincronizar histórico
          </button>
          <button onClick={onDisconnect}
            className="flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-900/20 shadow-sm">
            <WifiOff size={15} /> Desconectar
          </button>
        </div>
      </div>
    );
  }

  // ── QR Code sendo exibido ────────────────────────────────────────────────
  if (status === "connecting" && qrCode) {
    return (
      <div className="flex flex-col lg:flex-row gap-8 items-center justify-center">
        {/* QR Code grande */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl opacity-30 blur-2xl"
              style={{ background: "linear-gradient(135deg, #14532d, #16a34a)" }} />
            <div className="relative rounded-2xl border-[5px] border-green-700 bg-white p-5 shadow-2xl">
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="block"
                style={{ width: 320, height: 320, imageRendering: "pixelated" }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-5 py-2">
            <Loader2 size={13} className="animate-spin text-amber-500" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Aguardando leitura…</span>
          </div>

          <button onClick={onRefresh}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <RefreshCw size={12} /> Atualizar QR Code
          </button>
        </div>

        {/* Passos */}
        <div className="flex flex-col gap-4 max-w-xs">
          <p className="text-base font-bold text-gray-900 dark:text-gray-100">Como escanear</p>
          {[
            { icon: <Smartphone size={18} />, title: "Abra o WhatsApp", desc: "No seu celular" },
            { icon: <QrCode size={18} />, title: "Dispositivos vinculados", desc: "Toque em ⋮ no canto superior direito" },
            { icon: <CheckCircle size={18} />, title: "Vincular um dispositivo", desc: "Aponte a câmera para o QR Code" },
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                {s.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
              </div>
              {i < 2 && <div className="absolute mt-10 ml-5 w-px h-4 bg-gray-200 dark:bg-gray-700" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Código de pareamento sendo exibido ───────────────────────────────────
  if (status === "connecting" && pairingCode) {
    const formatted = pairingCode.length === 8
      ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`
      : pairingCode;
    return (
      <div className="flex flex-col items-center gap-6 py-4 max-w-sm mx-auto text-center">
        <div>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Insira o código no WhatsApp</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            WhatsApp → <strong>Dispositivos vinculados</strong> → Vincular com número de telefone
          </p>
        </div>

        <div className="relative w-full">
          <div className="absolute -inset-4 rounded-3xl opacity-25 blur-xl"
            style={{ background: "linear-gradient(135deg, #14532d, #16a34a)" }} />
          <div className="relative rounded-2xl border-2 border-green-600 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 dark:border-green-700 px-10 py-8 shadow-xl">
            <p className="text-5xl font-mono font-black tracking-[0.25em] text-green-800 dark:text-green-300">{formatted}</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-3">Código de pareamento</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-5 py-2">
          <Loader2 size={13} className="animate-spin text-amber-500" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Aguardando vinculação…</span>
        </div>

        <p className="text-xs text-gray-400">O código expira em ~60 segundos.</p>
        <button onClick={onRequestPairingCode} disabled={pairingLoading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
          <RefreshCw size={12} /> Gerar novo código
        </button>
      </div>
    );
  }

  // ── Tela inicial - 2 opções: WhatsApp (QR/código) e API ─────────────────
  const isWhatsApp = connectMethod === "qr" || connectMethod === "code";

  return (
    <div className="flex flex-col gap-5">
      {/* Seletor: WhatsApp ou API */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Escolha como conectar</p>
        <div className="grid grid-cols-2 gap-3">
          {/* Card WhatsApp */}
          <button
            onClick={() => onMethodChange("qr")}
            className={`relative flex flex-col items-center gap-3 rounded-2xl border-2 p-5 text-center transition-all ${
              isWhatsApp
                ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20 ring-2 ring-green-500/30 ring-offset-1"
                : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-600"
            }`}
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
              isWhatsApp ? "bg-green-600 text-white shadow-lg shadow-green-300/40" : "bg-gray-100 dark:bg-gray-700 text-gray-400"
            }`}>
              <Smartphone size={24} />
            </div>
            <div>
              <p className={`text-sm font-bold ${isWhatsApp ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}>WhatsApp</p>
              <p className="text-[11px] text-gray-400 leading-tight mt-0.5">QR Code ou número de telefone</p>
            </div>
          </button>

          {/* Card API Oficial */}
          <button
            onClick={() => onMethodChange("api")}
            className={`relative flex flex-col items-center gap-3 rounded-2xl border-2 p-5 text-center transition-all ${
              connectMethod === "api"
                ? "border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-900/20 ring-2 ring-purple-500/30 ring-offset-1"
                : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-600"
            }`}
          >
            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-purple-100 dark:bg-purple-900/60 px-2.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
              Recomendado
            </span>
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
              connectMethod === "api" ? "bg-purple-600 text-white shadow-lg shadow-purple-300/40" : "bg-gray-100 dark:bg-gray-700 text-gray-400"
            }`}>
              <Building2 size={24} />
            </div>
            <div>
              <p className={`text-sm font-bold ${connectMethod === "api" ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}>API Oficial</p>
              <p className="text-[11px] text-gray-400 leading-tight mt-0.5">Meta Business - sem risco de ban</p>
            </div>
          </button>
        </div>
      </div>

      <div className="h-px bg-gray-100 dark:bg-gray-700/60" />

      {/* Painel WhatsApp - QR + toggle para número */}
      {isWhatsApp && (
        <WhatsAppConnectPanel
          usePhone={connectMethod === "code"}
          error={error}
          loading={loading}
          pairingPhone={pairingPhone}
          pairingLoading={pairingLoading}
          pairingError={pairingError}
          onConnect={onConnect}
          onFreshConnect={onFreshConnect}
          onPairingPhoneChange={onPairingPhoneChange}
          onRequestPairingCode={onRequestPairingCode}
          onTogglePhone={() => onMethodChange(connectMethod === "code" ? "qr" : "code")}
        />
      )}

      {connectMethod === "api" && (
        <ApiMethodPanel onGoToSettings={onGoToSettings} />
      )}
    </div>
  );
}

// ── WhatsApp Connect Panel (QR + toggle para número) ─────────────────────────

function WhatsAppConnectPanel({
  usePhone, error, loading, pairingPhone, pairingLoading, pairingError,
  onConnect, onFreshConnect, onPairingPhoneChange, onRequestPairingCode, onTogglePhone,
}: {
  usePhone: boolean; error: string | null; loading: boolean;
  pairingPhone: string; pairingLoading: boolean; pairingError: string | null;
  onConnect: () => void; onFreshConnect: () => void; onPairingPhoneChange: (v: string) => void;
  onRequestPairingCode: () => void; onTogglePhone: () => void;
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Passos */}
      <div className="flex-1 space-y-3">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
          {usePhone ? "Como conectar pelo número" : "Como conectar via QR Code"}
        </p>
        {(usePhone
          ? [
              "Digite seu número com DDD no campo ao lado",
              "Clique em Gerar código",
              "WhatsApp → Dispositivos vinculados → Vincular com número",
              "Insira o código de 8 dígitos que aparecer",
            ]
          : [
              "Clique em Gerar QR Code",
              "Abra o WhatsApp no celular",
              "Toque em ⋮ → Dispositivos vinculados",
              "Escaneie o QR Code que aparecer na tela",
            ]
        ).map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-700 text-[11px] font-bold text-white">{i + 1}</span>
            <p className="text-sm text-gray-600 dark:text-gray-400">{step}</p>
          </div>
        ))}

        {(error || pairingError) && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 mt-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-red-500" />
              <p className="text-xs text-red-700 dark:text-red-400">{error || pairingError}</p>
            </div>
            {!usePhone && (
              <button
                onClick={onFreshConnect}
                disabled={loading}
                className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold text-white transition disabled:opacity-60"
              >
                <RotateCcw size={12} /> Limpar sessão e gerar novo QR
              </button>
            )}
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 lg:w-52">
        {usePhone ? (
          <>
            <input
              type="tel"
              value={pairingPhone}
              onChange={(e) => onPairingPhoneChange(e.target.value)}
              placeholder="Ex: 11999999999"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 dark:focus:ring-green-900/30"
            />
            <button
              onClick={onRequestPairingCode}
              disabled={pairingLoading || pairingPhone.replace(/\D/g, "").length < 10}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-lg transition hover:shadow-xl disabled:opacity-60 disabled:shadow-none"
              style={{ background: "linear-gradient(135deg, #14532d 0%, #16a34a 100%)" }}
            >
              {pairingLoading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {pairingLoading ? "Gerando…" : "Gerar código"}
            </button>
            <p className="text-[11px] text-center text-gray-400">Só DDD + número, sem +55</p>
          </>
        ) : (
          <>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-green-50 dark:bg-green-900/20 border-2 border-dashed border-green-300 dark:border-green-700">
              <QrCode size={40} className="text-green-700 dark:text-green-400 opacity-70" />
            </div>
            <button
              onClick={onConnect}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-lg transition hover:shadow-xl disabled:opacity-60 disabled:shadow-none"
              style={{ background: loading ? undefined : "linear-gradient(135deg, #14532d 0%, #16a34a 100%)" }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
              {loading ? "Aguarde…" : "Gerar QR Code"}
            </button>
            {/* Destrava o caso de sessão antiga "presa" (creds registradas que
                não reconectam): limpa no servidor e gera um QR novo. */}
            <button
              onClick={onFreshConnect}
              disabled={loading}
              className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-green-700 dark:hover:text-green-400 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={11} /> Não carregou? Limpar sessão e gerar novo QR
            </button>
          </>
        )}

        {/* Toggle discreto */}
        <button
          onClick={onTogglePhone}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-green-700 dark:hover:text-green-400 transition-colors mt-1"
        >
          {usePhone ? <><QrCode size={12} /> Usar QR Code</> : <><KeyRound size={12} /> Conectar pelo número de telefone</>}
        </button>
      </div>
    </div>
  );
}

// ── API Method ───────────────────────────────────────────────────────────────

function ApiMethodPanel({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Info */}
      <div className="flex-1 space-y-4">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">WhatsApp Business API Oficial (Meta)</p>
        <div className="space-y-2.5">
          {[
            { icon: <ShieldCheck size={15} />, text: "Conexão oficial - zero risco de banimento", color: "text-green-600 dark:text-green-400" },
            { icon: <Zap size={15} />,         text: "Capacidade de alto volume de mensagens",    color: "text-blue-600 dark:text-blue-400" },
            { icon: <Building2 size={15} />,   text: "Suporte a múltiplos números por empresa",   color: "text-purple-600 dark:text-purple-400" },
            { icon: <Settings size={15} />,    text: "Requer conta no Meta Business Manager",     color: "text-gray-500 dark:text-gray-400" },
          ].map((f, i) => (
            <div key={i} className={`flex items-center gap-2.5 text-sm ${f.color}`}>
              <span className="flex-shrink-0">{f.icon}</span>
              {f.text}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Como funciona</p>
          <p className="text-xs text-amber-600 dark:text-amber-500 leading-relaxed">
            Configure sua conta Meta Business e conecte o número de telefone oficial nas <strong>Configurações</strong>. Depois de configurado, as mensagens chegam via webhook oficial do Meta.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3 lg:w-48">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-900/20 border-2 border-dashed border-purple-300 dark:border-purple-700">
          <Building2 size={36} className="text-purple-500 dark:text-purple-400 opacity-70" />
        </div>
        <button
          onClick={onGoToSettings}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-700 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-200 dark:shadow-purple-900/30 transition hover:shadow-xl"
        >
          <Settings size={16} /> Configurar API
          <ArrowRight size={14} />
        </button>
        <p className="text-[11px] text-center text-gray-400">Abre as Configurações</p>
      </div>
    </div>
  );
}

// ─── Instagram Panel ──────────────────────────────────────────────────────────

function InstagramPanel({ status, onRefresh }: { status: ConnStatus; onRefresh: () => void }) {
  if (status === "connected") {
    return (
      <div className="flex flex-col items-center gap-5 py-6 max-w-sm mx-auto text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-pink-200 dark:shadow-pink-900/30">
          <CheckCircle size={30} className="text-white" />
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Instagram conectado!</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">DMs chegando no Trilha.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="flex-1 space-y-4">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Conectar Instagram DM</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">Receba e responda DMs do Instagram diretamente no Trilha.</p>
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">Requisitos</p>
          <ul className="space-y-1.5 text-xs text-amber-600 dark:text-amber-500">
            {[
              "Conta Instagram Business ou Creator",
              "Página do Facebook vinculada",
              "Credenciais configuradas no provedor",
            ].map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" /> {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 lg:w-48">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-2 border-dashed border-pink-300 dark:border-pink-700">
          <Instagram size={36} className="text-pink-500 opacity-70" />
        </div>
        <button
          onClick={onRefresh}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-pink-200 dark:shadow-pink-900/30 transition hover:opacity-90"
        >
          <RefreshCw size={15} /> Verificar conexão
        </button>
      </div>
    </div>
  );
}
