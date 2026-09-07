import React, { useEffect, useState } from "react";
import { BellRing, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import type { JobWithProduction } from "./ProductionBoard";

interface ReminderPreview {
  client_name: string;
  phone_masked: string;
  message: string;
}

function normalizePreview(payload: any): ReminderPreview | null {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const preview = {
    client_name: String(data?.client_name || data?.clientName || "").trim(),
    phone_masked: String(data?.phone_masked || data?.phoneMasked || "").trim(),
    message: String(data?.message || data?.text || "").trim(),
  };
  return preview.client_name && preview.phone_masked && preview.message ? preview : null;
}

function deliveryLabel(channel: string) {
  if (channel === "meta_template") return "Lembrete enviado pelo template aprovado do WhatsApp.";
  return "Lembrete enviado com sucesso pelo WhatsApp.";
}

export function JobReminderSection({ job }: { job: JobWithProduction }) {
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreview(null);
    setFeedback(null);
    setMigrationNeeded(false);
    authFetch(`/api/jobs/${job.id}/reminder/preview`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (response.status === 422 && data.error === "MIGRATION_NEEDED") {
          setMigrationNeeded(true);
          return;
        }
        if (!response.ok) {
          setFeedback({ tone: "warn", text: data.error || "Não foi possível preparar o lembrete." });
          return;
        }
        const nextPreview = normalizePreview(data);
        if (!nextPreview) {
          setFeedback({ tone: "warn", text: "O lembrete não carregou por completo. Atualize a página e tente novamente." });
          return;
        }
        setPreview(nextPreview);
      })
      .catch(() => {
        if (active) setFeedback({ tone: "warn", text: "Não foi possível preparar o lembrete." });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [job.id, job.job_date, job.job_time, job.job_type]);

  const send = async () => {
    setSending(true);
    setFeedback(null);
    try {
      const response = await authFetch(`/api/jobs/${job.id}/reminder/send`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o lembrete.");
      setConfirming(false);
      setFeedback({ tone: "ok", text: deliveryLabel(result.channel) });
    } catch (error: any) {
      setFeedback({ tone: "warn", text: error?.message || "Não foi possível enviar o lembrete." });
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        <BellRing size={13} /> Lembrete do ensaio
      </h3>
      <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-gray-400"><RefreshCw size={12} className="animate-spin" /> Preparando mensagem…</p>
        ) : migrationNeeded ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            A configuração do lembrete ainda precisa da atualização de banco.
          </p>
        ) : preview ? (
          <>
            <div className="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Mensagem que será enviada</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{preview.message}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] leading-relaxed text-gray-400">Edite e teste o texto em Configurar → Produção.</p>
              <button onClick={() => setConfirming(true)} className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-gold-600 px-3 py-2 text-xs font-semibold text-white hover:bg-gold-700">
                <ShieldCheck size={13} /> Revisar envio
              </button>
            </div>
          </>
        ) : null}
        {feedback && (
          <p className={feedback.tone === "ok" ? "rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}>{feedback.text}</p>
        )}
      </div>

      {confirming && preview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/55" onClick={() => !sending && setConfirming(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-gray-900 dark:text-white">Confirmar lembrete</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Confira antes de enviar. Nada é disparado ao abrir esta tela.</p>
              </div>
              <button onClick={() => setConfirming(false)} disabled={sending} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar confirmação"><X size={17} /></button>
            </div>
            <div className="mb-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Destinatário</p>
              <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{preview.client_name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{preview.phone_masked}</p>
            </div>
            <div className="mb-5 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Mensagem</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{preview.message}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={sending} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">Cancelar</button>
              <button onClick={send} disabled={sending} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Confirmar envio
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
