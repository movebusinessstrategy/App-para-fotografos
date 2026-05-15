import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  BarChart2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit2,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { ProductionProcess, ProductionStageV2, Task, TeamMember } from "../types";
import { JobWithProduction } from "../components/producao/ProductionBoard";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { DateTimePicker } from "../components/ui/DateTimePicker";

// ── Urgency logic ──────────────────────────────────────────────────────────────

type Urgency = "ok" | "warning" | "overdue" | "completed";

function getUrgency(task: Task): Urgency {
  if (task.completed_at) return "completed";
  const now = Date.now();
  const created = new Date(task.created_at).getTime();
  const due = new Date(task.due_date).getTime();
  if (now >= due) return "overdue";
  const progress = (now - created) / (due - created);
  return progress >= 0.5 ? "warning" : "ok";
}

function formatDueRelative(task: Task): string {
  if (task.completed_at) {
    return `Concluída ${format(new Date(task.completed_at), "dd/MM 'às' HH:mm", { locale: ptBR })}`;
  }
  const now = Date.now();
  const due = new Date(task.due_date).getTime();
  const diffMs = due - now;
  const absDiffMin = Math.abs(diffMs) / 60000;
  const overdue = diffMs < 0;

  let label = "";
  if (absDiffMin < 60) label = `${Math.floor(absDiffMin)}min`;
  else if (absDiffMin < 1440) label = `${Math.floor(absDiffMin / 60)}h`;
  else {
    const days = Math.floor(absDiffMin / 1440);
    label = `${days} ${days === 1 ? "dia" : "dias"}`;
  }

  return overdue ? `Atrasada há ${label}` : `${label} restante${absDiffMin >= 1440 ? "s" : ""}`;
}

function isJobDelayed(job: JobWithProduction, stage?: ProductionStageV2): boolean {
  if (!job.production_stage_entered_at || !stage?.expected_hours || stage.expected_hours <= 0)
    return false;
  const hoursInStage =
    (Date.now() - new Date(job.production_stage_entered_at).getTime()) / 3_600_000;
  return hoursInStage >= stage.expected_hours;
}

function getMemberInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ── Task Row ───────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task;
  urgency: Urgency;
  member?: TeamMember;
  linkedJob?: JobWithProduction;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
}

function TaskRow({
  task,
  urgency,
  member,
  linkedJob,
  onToggleComplete,
  onEdit,
  onDelete,
  onView,
}: TaskRowProps) {
  const borderColor = {
    ok: "border-l-gold-400",
    warning: "border-l-amber-400",
    overdue: "border-l-red-500",
    completed: "border-l-emerald-400",
  }[urgency];

  const bgColor = {
    ok: "",
    warning: "bg-amber-50/60 dark:bg-amber-900/10",
    overdue: "bg-red-50/60 dark:bg-red-900/10",
    completed: "bg-emerald-50/40 dark:bg-emerald-900/10",
  }[urgency];

  const dotClass = {
    ok: "bg-gold-400",
    warning: "bg-amber-400",
    overdue: "bg-red-500 animate-pulse",
    completed: "bg-emerald-400",
  }[urgency];

  const dueColor = {
    ok: "text-gray-400 dark:text-gray-500",
    warning: "text-amber-600 dark:text-amber-400 font-semibold",
    overdue: "text-red-500 font-bold",
    completed: "text-emerald-600 dark:text-emerald-400",
  }[urgency];

  return (
    <div
      onClick={onView}
      className={cn(
        "flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900",
        "rounded-xl border border-gray-100 dark:border-gray-800 border-l-4 shadow-sm",
        "transition-all duration-200 cursor-pointer hover:shadow-md hover:border-gray-200 dark:hover:border-gray-700",
        borderColor,
        bgColor,
        urgency === "completed" && "opacity-60"
      )}
    >
      {/* Pulsing urgency dot */}
      <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", dotClass)} />

      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleComplete(); }}
        className={cn(
          "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
          urgency === "completed"
            ? "bg-emerald-500 border-emerald-500 text-white"
            : "border-gray-300 dark:border-gray-600 hover:border-gold-400"
        )}
      >
        {urgency === "completed" && <Check size={11} strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-semibold text-gray-800 dark:text-white",
            urgency === "completed" && "line-through text-gray-400 dark:text-gray-500"
          )}
        >
          {task.title}
        </p>
        {(task.description || linkedJob) && (
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {task.description && (
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[220px]">
                {task.description}
              </span>
            )}
            {linkedJob && (
              <span className="text-xs text-gold-500 dark:text-gold-400 flex items-center gap-0.5 flex-shrink-0">
                <ChevronRight size={10} />
                {linkedJob.client_name || linkedJob.job_name || `Job #${linkedJob.id}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Due label */}
      <div className={cn("text-xs whitespace-nowrap flex items-center gap-1 flex-shrink-0", dueColor)}>
        <Clock size={11} />
        {formatDueRelative(task)}
      </div>

      {/* Member avatar */}
      {member && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-sm"
          style={{ backgroundColor: member.color }}
          title={member.name}
        >
          {getMemberInitials(member.name)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 text-gray-400 hover:text-gold-500 hover:bg-gold-50 dark:hover:bg-gold-900/20 rounded-lg transition-colors"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Task Detail Drawer ────────────────────────────────────────────────────────

interface TaskDetailDrawerProps {
  task: Task;
  member?: TeamMember;
  linkedJob?: JobWithProduction;
  linkedStage?: ProductionStageV2;
  linkedProcess?: ProductionProcess;
  urgency: Urgency;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}

function TaskDetailDrawer({
  task,
  member,
  linkedJob,
  linkedStage,
  linkedProcess,
  urgency,
  onClose,
  onEdit,
  onDelete,
  onToggleComplete,
}: TaskDetailDrawerProps) {
  const statusLabel = { ok: "Em dia", warning: "Atenção", overdue: "Atrasada", completed: "Concluída" }[urgency];
  const statusColor = {
    ok: "bg-gold-100 dark:bg-gold-900/40 text-gold-700 dark:text-gold-300",
    warning: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    overdue: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    completed: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  }[urgency];
  const dotClass = {
    ok: "bg-gold-400",
    warning: "bg-amber-400",
    overdue: "bg-red-500 animate-pulse",
    completed: "bg-emerald-400",
  }[urgency];

  // Progress bar — percentage of time elapsed between created_at and due_date
  const progressPct = (() => {
    if (task.completed_at) return 100;
    const created = new Date(task.created_at).getTime();
    const due = new Date(task.due_date).getTime();
    const now = Date.now();
    if (due <= created) return 0;
    return Math.min(100, Math.max(0, ((now - created) / (due - created)) * 100));
  })();

  const progressColor =
    urgency === "completed" ? "bg-emerald-400" :
    urgency === "overdue"   ? "bg-red-500" :
    urgency === "warning"   ? "bg-amber-400" : "bg-gold-400";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl flex flex-col border-l border-gray-200 dark:border-gray-800 animate-in slide-in-from-right duration-200">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full", statusColor)}>
              <span className={cn("w-1.5 h-1.5 rounded-full", dotClass)} />
              {statusLabel}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Title */}
          <div>
            <h2 className={cn(
              "text-lg font-bold text-gray-900 dark:text-white leading-snug",
              urgency === "completed" && "line-through text-gray-400 dark:text-gray-500"
            )}>
              {task.title}
            </h2>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
              <span>Progresso do prazo</span>
              <span className="font-semibold">{Math.round(progressPct)}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", progressColor)}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
              <span>{format(new Date(task.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
              <span className="font-semibold">{format(new Date(task.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Descrição</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Meta grid */}
          <div className="space-y-3">
            {/* Due date */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                <Clock size={14} className="text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Prazo</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">
                  {format(new Date(task.due_date), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
                <p className={cn("text-xs font-semibold mt-0.5", {
                  "text-gold-500": urgency === "ok",
                  "text-amber-500": urgency === "warning",
                  "text-red-500": urgency === "overdue",
                  "text-emerald-500": urgency === "completed",
                })}>
                  {formatDueRelative(task)}
                </p>
              </div>
            </div>

            {/* Responsible */}
            {member && (
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                  style={{ backgroundColor: member.color }}
                >
                  {getMemberInitials(member.name)}
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Responsável</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{member.name}</p>
                </div>
              </div>
            )}

            {/* Linked job */}
            {linkedJob && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center flex-shrink-0">
                  <ChevronRight size={14} className="text-gold-500" />
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Trabalho vinculado</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">
                    {linkedJob.client_name || linkedJob.job_name || `Job #${linkedJob.id}`}
                  </p>
                  {linkedJob.job_type && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">{linkedJob.job_type}</p>
                  )}
                </div>
              </div>
            )}

            {/* Linked stage */}
            {linkedStage && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: linkedProcess ? `${linkedProcess.color}25` : "#e0e7ff" }}
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: linkedProcess?.color || "#6366f1" }} />
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Etapa vinculada</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{linkedStage.name}</p>
                  {linkedProcess && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">{linkedProcess.name}</p>
                  )}
                </div>
              </div>
            )}

            {/* Created at */}
            <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-800 mt-1">
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                <BarChart2 size={13} className="text-gray-400" />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Criada em</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {format(new Date(task.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <button
            onClick={onToggleComplete}
            className={cn(
              "w-full py-2.5 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2",
              urgency === "completed"
                ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                : "bg-emerald-500 hover:bg-emerald-600 text-white"
            )}
          >
            <Check size={15} strokeWidth={2.5} />
            {urgency === "completed" ? "Reabrir tarefa" : "Marcar como concluída"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
            >
              <Edit2 size={13} />
              Editar
            </button>
            <button
              onClick={onDelete}
              className="flex-1 py-2 text-sm font-semibold rounded-xl border border-red-100 dark:border-red-900/30 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-1.5"
            >
              <Trash2 size={13} />
              Excluir
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Task Modal ─────────────────────────────────────────────────────────────────

interface TaskModalProps {
  task: Partial<Task> | null;
  teamMembers: TeamMember[];
  jobs: JobWithProduction[];
  stages: ProductionStageV2[];
  processes: ProductionProcess[];
  onSave: (data: Partial<Task>) => void;
  onClose: () => void;
  saving: boolean;
}

function TaskModal({ task, teamMembers, jobs, stages, processes, onSave, onClose, saving }: TaskModalProps) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || "");
  const [jobId, setJobId] = useState<number | "">(task?.job_id || "");
  const [stageId, setStageId] = useState(task?.stage_id || "");
  const [dueDate, setDueDate] = useState(
    task?.due_date ? task.due_date.slice(0, 16) : ""
  );

  const isEdit = !!task?.id;
  const activeJobs = useMemo(() => jobs.filter((j) => j.status !== "cancelled"), [jobs]);

  // Stages grouped by process for the select options
  const stageOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "Nenhuma etapa" }];
    processes.forEach((p) => {
      const pStages = stages.filter((s) => s.process_id === p.id).sort((a, b) => a.position - b.position);
      pStages.forEach((s) => opts.push({ value: s.id, label: `${p.name} → ${s.name}` }));
    });
    return opts;
  }, [stages, processes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white">
            {isEdit ? "Editar tarefa" : "Nova tarefa"}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Título *
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Editar fotos do ensaio..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Descrição
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes ou observações..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors resize-none"
            />
          </div>

          {/* Assignee + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Responsável
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
              >
                <option value="">Sem responsável</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Prazo *
              </label>
              <DateTimePicker
                value={dueDate ? new Date(dueDate).toISOString() : ""}
                onChange={(iso) => setDueDate(iso.slice(0, 16))}
              />
            </div>
          </div>

          {/* Linked job + stage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Trabalho vinculado
              </label>
              <SearchableSelect
                value={jobId === "" ? "" : String(jobId)}
                onChange={(v) => setJobId(v ? Number(v) : "")}
                placeholder="Nenhum"
                options={[
                  { value: "", label: "Nenhum" },
                  ...activeJobs.map((j) => ({
                    value: String(j.id),
                    label: `${j.client_name || j.job_name || `Job #${j.id}`}${j.job_type ? ` — ${j.job_type}` : ""}`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Etapa vinculada
              </label>
              <SearchableSelect
                value={stageId}
                onChange={setStageId}
                placeholder="Nenhuma"
                options={stageOptions}
              />
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              onSave({
                ...task,
                title,
                description: description || null,
                assignee_id: assigneeId || null,
                job_id: jobId || null,
                stage_id: stageId || null,
                due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
              })
            }
            disabled={!title.trim() || !dueDate || saving}
            className="flex-1 py-2 text-sm bg-gold-600 hover:bg-gold-700 text-white rounded-xl font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar tarefa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function GerenciaPage() {
  const [jobs, setJobs] = useState<JobWithProduction[]>([]);
  const [stages, setStages] = useState<ProductionStageV2[]>([]);
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [jobsRes, stagesRes, processesRes] = await Promise.all([
        authFetch("/api/jobs"),
        authFetch("/api/production/stages-v2").catch(() => null),
        authFetch("/api/production/processes").catch(() => null),
      ]);
      if (jobsRes.ok) setJobs(await jobsRes.json());
      if (stagesRes?.ok) setStages(await stagesRes.json());
      if (processesRes?.ok) setProcesses(await processesRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Tick every minute to update urgency colors live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Performance data ───────────────────────────────────────────────────────

  const activeJobs = useMemo(() => jobs.filter((j) => j.status !== "cancelled"), [jobs]);

  const stageStats = useMemo(() => {
    return stages
      .map((stage) => {
        const stageJobs = activeJobs.filter((j) => j.production_stage === stage.id);
        const delayed = stageJobs.filter((j) => isJobDelayed(j, stage));
        return {
          stage,
          total: stageJobs.length,
          delayed: delayed.length,
          onTime: stageJobs.length - delayed.length,
        };
      })
      .sort((a, b) => {
        const pa = processes.findIndex((p) => p.id === a.stage.process_id);
        const pb = processes.findIndex((p) => p.id === b.stage.process_id);
        if (pa !== pb) return pa - pb;
        return a.stage.position - b.stage.position;
      });
  }, [activeJobs, stages, processes]);

  const processSummary = useMemo(() => {
    return processes
      .map((process) => {
        const procStages = stageStats.filter((s) => s.stage.process_id === process.id);
        const total = procStages.reduce((s, c) => s + c.total, 0);
        const delayed = procStages.reduce((s, c) => s + c.delayed, 0);
        return { process, stages: procStages, total, delayed };
      })
      .filter((p) => p.stages.length > 0);
  }, [processes, stageStats]);

  const noStageJobs = useMemo(() => activeJobs.filter((j) => !j.production_stage), [activeJobs]);

  const totalDelayed = useMemo(
    () => stageStats.reduce((sum, item) => sum + item.delayed, 0),
    [stageStats]
  );

  const jobsInProduction = activeJobs.length - noStageJobs.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8 max-w-6xl">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <BarChart2 size={22} className="text-gold-500" />
              Gerência de Produção
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
              Acompanhe desempenho, gargalos e metas de cada etapa.
            </p>
          </div>

          {/* Summary pills */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {totalDelayed > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full animate-pulse">
                <AlertTriangle size={12} />
                {totalDelayed} atrasado{totalDelayed !== 1 ? "s" : ""}
              </span>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-gold-50 dark:bg-gold-900/30 text-gold-600 dark:text-gold-400 text-xs font-semibold rounded-full">
              <Clock size={12} />
              {jobsInProduction} em produção
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold rounded-full">
              <Check size={12} />
              {activeJobs.length} trabalho{activeJobs.length !== 1 ? "s" : ""} ativo{activeJobs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Section 1: Performance ─────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
            Desempenho por etapa
          </h3>

          {processSummary.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-10 text-center">
              <BarChart2 size={36} className="text-gray-200 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">
                Nenhuma etapa de produção configurada ainda.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {processSummary.map(({ process, stages: procStages, total, delayed }) => (
                <div
                  key={process.id}
                  className={cn(
                    "rounded-2xl overflow-hidden shadow-sm",
                    process.is_special
                      ? "border-2 border-gold-400 dark:border-gold-600 bg-white dark:bg-gray-900"
                      : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                  )}
                  style={process.is_special ? { boxShadow: '0 0 0 1px rgba(241,198,101,0.15), 0 4px 16px rgba(212,169,74,0.10)' } : {}}
                >
                  {/* Process header */}
                  <div
                    className={cn(
                      "px-5 py-3 flex items-center gap-3 border-b",
                      process.is_special
                        ? "border-gold-200 dark:border-gold-700/50 bg-gradient-to-r from-gold-50 to-amber-50 dark:from-gold-900/20 dark:to-amber-900/10"
                        : "border-gray-100 dark:border-gray-800"
                    )}
                    style={!process.is_special ? { backgroundColor: `${process.color}18` } : {}}
                  >
                    {process.is_special
                      ? <Star size={14} className="text-gold-500 flex-shrink-0" fill="currentColor" />
                      : <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: process.color }} />
                    }
                    <span className={cn("font-bold text-sm", process.is_special ? "text-gold-700 dark:text-gold-300" : "text-gray-800 dark:text-white")}>
                      {process.name}
                    </span>
                    {process.is_special && (
                      <span className="text-[10px] font-semibold text-gold-500 dark:text-gold-400 uppercase tracking-wider">Especial</span>
                    )}
                    <div className="ml-auto flex items-center gap-3 text-xs">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {total} trabalho{total !== 1 ? "s" : ""}
                      </span>
                      {delayed > 0 && (
                        <span className="flex items-center gap-1 text-red-500 font-bold">
                          <AlertTriangle size={11} />
                          {delayed} atrasado{delayed !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stage columns */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-gray-100 dark:divide-gray-800">
                    {procStages.map(({ stage, total: sTotal, delayed: sDelayed, onTime }) => {
                      const isHot = sDelayed > 0;
                      const pct = sTotal > 0 ? (onTime / sTotal) * 100 : 0;
                      return (
                        <div
                          key={stage.id}
                          className={cn(
                            "p-4 flex flex-col gap-1.5",
                            isHot && "bg-red-50/60 dark:bg-red-900/10"
                          )}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: stage.color }}
                            />
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">
                              {stage.name}
                            </span>
                          </div>

                          <div className="text-2xl font-bold text-gray-800 dark:text-white leading-none">
                            {sTotal}
                          </div>

                          <div className="flex flex-col gap-0.5 text-[11px]">
                            {onTime > 0 && (
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                <Check size={9} strokeWidth={3} />
                                {onTime} em dia
                              </span>
                            )}
                            {sDelayed > 0 && (
                              <span className="flex items-center gap-1 text-red-500 font-bold">
                                <AlertTriangle size={9} />
                                {sDelayed} atrasado{sDelayed !== 1 ? "s" : ""}
                              </span>
                            )}
                            {sTotal === 0 && (
                              <span className="text-gray-300 dark:text-gray-600">vazio</span>
                            )}
                          </div>

                          {/* Progress bar: green = on time, red = delayed */}
                          {sTotal > 0 && (
                            <div className="mt-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: isHot ? "#22c55e" : stage.color,
                                }}
                              />
                              {isHot && (
                                <div
                                  className="h-full rounded-full bg-red-400"
                                  style={{ width: `${100 - pct}%` }}
                                />
                              )}
                            </div>
                          )}

                          {stage.expected_hours > 0 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              Meta: {stage.expected_hours}h
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Jobs without stage */}
              {noStageJobs.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Sem etapa de produção
                  </span>
                  <span className="text-xl font-bold text-gray-700 dark:text-gray-300">
                    {noStageJobs.length}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
