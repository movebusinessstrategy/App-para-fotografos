import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Loader2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { authFetch } from "../../utils/authFetch";

export interface MetaPhoneDiagnostic {
  platform_type?: string | null;
  status?: string | null;
  code_verification_status?: string | null;
  quality_rating?: string | null;
  is_on_biz_app?: boolean | null;
}

export interface CoexistenceSyncDetails {
  status?: string | null;
  requested_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  last_error?: string | null;
  details?: Record<string, unknown> | null;
}

export interface CoexistenceSnapshot {
  connected?: boolean;
  mode?: string | null;
  preferred_channel?: string | null;
  sync?: CoexistenceSyncDetails | null;
}

interface Props {
  loading: boolean;
  error: string | null;
  phone: MetaPhoneDiagnostic | null;
  snapshot: CoexistenceSnapshot | null;
  onRefresh: () => Promise<void>;
}

type CheckValue = true | false | null;

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

function checkValue(value: string | null | undefined, expected: string): CheckValue {
  const current = normalized(value);
  if (!current) return null;
  return current === expected;
}

function booleanCheck(value: boolean | null | undefined): CheckValue {
  return typeof value === "boolean" ? value : null;
}

function safeError(value: unknown): string {
  const message = typeof value === "string" ? value : "Não foi possível concluir a solicitação.";
  return message.replace(/EAA[A-Za-z0-9_-]{16,}/g, "[credencial oculta]").slice(0, 320);
}

function isSyncRunning(status: string | null | undefined): boolean {
  return ["requested", "pending", "processing", "running"].includes(String(status || "").toLowerCase());
}

function syncLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    requested: "Solicitação aceita pela Meta",
    pending: "Aguardando início da importação",
    processing: "Importando histórico e contatos",
    running: "Importando histórico e contatos",
    completed: "Sincronização concluída",
    synced: "Sincronização concluída",
    success: "Sincronização concluída",
    failed: "A sincronização encontrou um erro",
    error: "A sincronização encontrou um erro",
  };
  return labels[String(status || "").toLowerCase()] || "Nenhuma sincronização solicitada";
}

function channelLabel(channel: string | null | undefined): string {
  const labels: Record<string, string> = {
    auto: "Automático",
    meta: "API oficial",
    baileys: "Conexão por QR",
  };
  return labels[String(channel || "").toLowerCase()] || "Não informado";
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function StatusLine({ label, value, detail }: { label: string; value: CheckValue; detail: string }) {
  const icon = value === true
    ? <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
    : value === false
      ? <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
      : <span className="h-4 w-4 rounded-full border border-gray-300 dark:border-gray-600" />;

  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{detail}</p>
      </div>
    </div>
  );
}

async function readJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
}

export function CoexistenceStatusCard({ loading, error, phone, snapshot, onRefresh }: Props) {
  const [confirmSync, setConfirmSync] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const platform = normalized(phone?.platform_type);
  const phoneStatus = normalized(phone?.status);
  const mode = String(snapshot?.mode || "").toLowerCase();
  const coexistenceDetected = mode === "coexistence" || phone?.is_on_biz_app === true;
  const coexistenceReady = !coexistenceDetected || phone?.is_on_biz_app === true;
  const officialOperational = platform === "CLOUD_API"
    && phoneStatus === "CONNECTED"
    && coexistenceReady;
  const syncRunning = isSyncRunning(snapshot?.sync?.status);
  const syncAllowed = snapshot?.connected === true
    && coexistenceDetected
    && phone?.is_on_biz_app === true
    && officialOperational;
  const syncAt = formatTimestamp(
    snapshot?.sync?.completed_at || snapshot?.sync?.updated_at || snapshot?.sync?.requested_at,
  );

  useEffect(() => {
    if (!syncRunning) return;
    const interval = window.setInterval(() => void onRefresh(), 4000);
    return () => window.clearInterval(interval);
  }, [onRefresh, syncRunning]);

  const requestSync = async () => {
    setConfirmSync(false);
    setRequestError(null);
    setFeedback(null);
    setRequesting(true);
    try {
      const response = await authFetch("/api/meta/whatsapp/coexistence/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_types: ["smb_app_state_sync", "history"] }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        throw new Error(safeError(data.error || data.message));
      }
      setFeedback("Solicitação aceita. O histórico e os contatos chegarão em segundo plano.");
      await onRefresh();
    } catch (syncError: any) {
      setRequestError(safeError(syncError?.message));
    } finally {
      setRequesting(false);
    }
  };

  if (loading && !phone && !snapshot) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Consultando o estado ao vivo na Meta…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 bg-gray-50/70 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700">
        <div>
          <div className="flex items-center gap-2">
            <Cloud size={17} className="text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Validação ao vivo da empresa atual</h4>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            A consulta é isolada por empresa e nunca envia credenciais ao navegador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Atualizar
        </button>
      </div>

      <div className="px-4 divide-y divide-gray-100 dark:divide-gray-800">
        <StatusLine
          label="Plataforma da Meta"
          value={checkValue(phone?.platform_type, "CLOUD_API")}
          detail={platform || "A Meta ainda não informou o tipo da plataforma"}
        />
        <StatusLine
          label="Estado do número"
          value={checkValue(phone?.status, "CONNECTED")}
          detail={phoneStatus || "Estado ainda não informado pela Meta"}
        />
        <StatusLine
          label="WhatsApp Business no celular"
          value={booleanCheck(phone?.is_on_biz_app)}
          detail={phone?.is_on_biz_app === true
            ? "Coexistência reconhecida: o app oficial pode continuar no celular"
            : phone?.is_on_biz_app === false
              ? "A Meta informou que este número não está em Coexistência"
              : "A Meta ainda não confirmou is_on_biz_app"}
        />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p>Verificação do código: <strong className="text-gray-700 dark:text-gray-300">{normalized(phone?.code_verification_status) || "não informada"}</strong></p>
        <p>Qualidade informada pela Meta: <strong className="text-gray-700 dark:text-gray-300">{normalized(phone?.quality_rating) || "não informada"}</strong></p>
        <p>Roteamento preferido: <strong className="text-gray-700 dark:text-gray-300">{channelLabel(snapshot?.preferred_channel)}</strong></p>
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-4 rounded-lg border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {safeError(error)}
        </div>
      )}

      {officialOperational && coexistenceDetected && (
        <div className="mx-4 mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <p>
            Após validar a API oficial, não mantenha <strong>este mesmo número</strong> conectado por QR no CRM.
            O WhatsApp Business no celular continua funcionando pela Coexistência; o QR paralelo pode duplicar mensagens e eventos.
          </p>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Database size={16} className="mt-0.5 text-gray-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Histórico e contatos</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {syncLabel(snapshot?.sync?.status)}{syncAt ? ` · ${syncAt}` : ""}
            </p>
          </div>
          {syncRunning && <Loader2 size={16} className="animate-spin text-emerald-600 dark:text-emerald-400" />}
        </div>

        {snapshot?.sync?.last_error && (
          <p role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {safeError(snapshot.sync.last_error)}
          </p>
        )}
        {requestError && (
          <p role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {requestError}
          </p>
        )}
        {feedback && (
          <p aria-live="polite" className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {feedback}
          </p>
        )}

        <button
          type="button"
          onClick={() => setConfirmSync(true)}
          disabled={!syncAllowed || syncRunning || requesting}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {requesting || syncRunning ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />}
          {requesting ? "Solicitando…" : syncRunning ? "Sincronização em andamento" : "Sincronizar histórico e contatos"}
        </button>
        {!syncAllowed && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            O botão é liberado somente quando a Meta confirma a conexão oficial em modo Coexistência.
          </p>
        )}
      </div>

      <ConfirmModal
        open={confirmSync}
        title="Sincronizar histórico e contatos?"
        message="A Meta fará a importação em segundo plano para esta empresa. A ação não reconecta, não troca o número e não envia tokens pelo navegador."
        confirmText="Solicitar sincronização"
        cancelText="Cancelar"
        onConfirm={() => void requestSync()}
        onCancel={() => setConfirmSync(false)}
      />
    </div>
  );
}
