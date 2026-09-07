import React, { useEffect, useState } from "react";
import { CalendarClock, Check, Pencil, RefreshCw, X } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";
import { JobWithProduction } from "./ProductionBoard";

type CalendarSyncStatus = "synced" | "not_connected" | "skipped" | "failed";

interface ScheduleDraft {
  job_date: string;
  job_time: string;
  job_end_time: string;
}

function draftFromJob(job: JobWithProduction): ScheduleDraft {
  return {
    job_date: String(job.job_date || "").slice(0, 10),
    job_time: String(job.job_time || "").slice(0, 5),
    job_end_time: String(job.job_end_time || "").slice(0, 5),
  };
}

function formatDate(date: string) {
  const [year, month, day] = String(date || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "Data não definida";
}

function validateSchedule(draft: ScheduleDraft): string | null {
  if (!draft.job_date) return "Escolha a data do ensaio.";
  if (draft.job_time && draft.job_end_time && draft.job_end_time <= draft.job_time) {
    return "O horário final precisa ser depois do horário inicial.";
  }
  return null;
}

export function JobScheduleSection({
  job,
  onSaved,
}: {
  job: JobWithProduction;
  onSaved: (patch: Partial<JobWithProduction>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromJob(job));
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  useEffect(() => {
    setDraft(draftFromJob(job));
    setEditing(false);
    setFeedback(null);
  }, [job.id]);

  const updateDraft = (field: keyof ScheduleDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const cancel = () => {
    setDraft(draftFromJob(job));
    setEditing(false);
    setFeedback(null);
  };

  const save = async () => {
    const validation = validateSchedule(draft);
    if (validation) {
      setFeedback({ tone: "warn", text: validation });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const response = await authFetch(`/api/jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível atualizar a agenda.");
      const status = result.calendar_sync_status as CalendarSyncStatus;
      const messages: Record<CalendarSyncStatus, string> = {
        synced: "Data atualizada no app e no Google Agenda.",
        not_connected: "Data atualizada. Conecte o Google Agenda para sincronizar também por lá.",
        skipped: "Data e horário atualizados no app.",
        failed: "Data atualizada no app, mas o Google Agenda não respondeu.",
      };
      onSaved(draft);
      setEditing(false);
      setFeedback({ tone: status === "failed" ? "warn" : "ok", text: messages[status] || messages.skipped });
    } catch (error: any) {
      setFeedback({ tone: "warn", text: error?.message || "Não foi possível atualizar a agenda." });
    } finally {
      setSaving(false);
    }
  };

  const timeLabel = draft.job_time
    ? ` · ${draft.job_time}${draft.job_end_time ? ` às ${draft.job_end_time}` : ""}`
    : "";

  return (
    <div className="relative mt-1">
      <button
        onClick={() => setEditing(true)}
        className="group flex max-w-full items-center gap-1.5 whitespace-nowrap text-left text-sm text-gray-500 hover:text-gold-700 dark:text-gray-400 dark:hover:text-gold-300"
        aria-expanded={editing}
        title="Alterar data e horário do ensaio"
      >
        <span>{job.job_type} · {formatDate(draft.job_date)}{timeLabel}</span>
        <Pencil size={11} className="flex-shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      </button>

      {feedback && !editing && (
        <p className={cn("mt-1 max-w-xs text-[10px] leading-snug", feedback.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{feedback.text}</p>
      )}

      {editing && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={cancel} />
          <div className="absolute left-0 top-full z-[60] mt-2 w-72 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-gray-100"><CalendarClock size={14} className="text-gold-500" /> Data do ensaio</p>
              {job.google_event_id && <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-300">Google Agenda</span>}
            </div>
            <input type="date" value={draft.job_date} onChange={(event) => updateDraft("job_date", event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gold-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Início<input type="time" value={draft.job_time} onChange={(event) => updateDraft("job_time", event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-normal normal-case text-gray-800 outline-none focus:border-gold-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Término<input type="time" value={draft.job_end_time} onChange={(event) => updateDraft("job_end_time", event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-normal normal-case text-gray-800 outline-none focus:border-gold-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" /></label>
            </div>
            {feedback && <p className={cn("text-[10px]", feedback.tone === "ok" ? "text-emerald-600" : "text-amber-600")}>{feedback.text}</p>}
            <p className="text-[10px] leading-relaxed text-gray-400">Ao salvar, a alteração também é enviada para o Google Agenda conectado.</p>
            <div className="flex gap-2">
              <button onClick={cancel} disabled={saving} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300"><X size={12} /> Cancelar</button>
              <button onClick={save} disabled={saving} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gold-600 py-2 text-xs font-semibold text-white hover:bg-gold-700 disabled:opacity-60">{saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Salvar</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
