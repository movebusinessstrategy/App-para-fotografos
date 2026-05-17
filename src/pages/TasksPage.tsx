import React, { useEffect, useMemo, useState } from "react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  BarChart2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Columns3,
  Edit2,
  Filter,
  ListChecks,
  Plus,
  Search,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { ProductionProcess, ProductionStageV2, Task, TeamMember } from "../types";
import { JobWithProduction } from "../components/producao/ProductionBoard";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { DateTimePicker } from "../components/ui/DateTimePicker";

type Urgency = "ok" | "warning" | "overdue" | "completed";
type TaskBucket = "overdue" | "today" | "upcoming" | "completed";
type ViewMode = "list" | "board";

function getUrgency(task: Task): Urgency {
  if (task.completed_at) return "completed";
  const now = Date.now();
  const created = new Date(task.created_at).getTime();
  const due = new Date(task.due_date).getTime();
  if (now >= due) return "overdue";
  const progress = (now - created) / (due - created);
  return progress >= 0.5 ? "warning" : "ok";
}

function getTaskBucket(task: Task): TaskBucket {
  if (task.completed_at) return "completed";
  const due = new Date(task.due_date);
  if (Date.now() >= due.getTime()) return "overdue";
  if (isToday(due)) return "today";
  return "upcoming";
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

function formatDueDate(task: Task): string {
  const due = new Date(task.due_date);
  if (isToday(due)) return `Hoje, ${format(due, "HH:mm", { locale: ptBR })}`;
  if (isTomorrow(due)) return `Amanhã, ${format(due, "HH:mm", { locale: ptBR })}`;
  return format(due, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
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

function MemberAvatar({ member }: { member?: TeamMember }) {
  if (!member) {
    return (
      <div
        title="Sem responsável"
        className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 flex items-center justify-center"
      >
        <UserCircle2 size={16} />
      </div>
    );
  }

  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
      style={{ backgroundColor: member.color }}
      title={member.name}
    >
      {getMemberInitials(member.name)}
    </div>
  );
}

function StatusPill({ task }: { task: Task }) {
  const bucket = getTaskBucket(task);
  const map = {
    overdue: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    today: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    upcoming: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    completed: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  };
  const label = {
    overdue: "Atrasada",
    today: "Hoje",
    upcoming: "Próxima",
    completed: "Concluída",
  }[bucket];

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase", map[bucket])}>
      {label}
    </span>
  );
}

function PriorityPill({ task }: { task: Task }) {
  const urgency = getUrgency(task);
  const due = new Date(task.due_date).getTime();
  const hoursLeft = (due - Date.now()) / 3_600_000;
  const level =
    urgency === "completed" ? "done" :
    urgency === "overdue" || hoursLeft <= 24 ? "high" :
    hoursLeft <= 72 ? "medium" : "low";

  const map = {
    high: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300",
    medium: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300",
    low: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
    done: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300",
  };
  const label = { high: "Alta", medium: "Média", low: "Baixa", done: "Finalizada" }[level];

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold", map[level])}>
      {label}
    </span>
  );
}

function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const done = !!task.completed_at;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
        done
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "border-gray-300 dark:border-gray-600 hover:border-gold-400"
      )}
      title={done ? "Reabrir tarefa" : "Concluir tarefa"}
    >
      {done && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

interface TaskRowProps {
  key?: React.Key;
  task: Task;
  member?: TeamMember;
  linkedJob?: JobWithProduction;
  linkedStage?: ProductionStageV2;
  linkedProcess?: ProductionProcess;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
}

function TaskListRow({
  task,
  member,
  linkedJob,
  linkedStage,
  linkedProcess,
  onToggleComplete,
  onEdit,
  onDelete,
  onView,
}: TaskRowProps) {
  const urgency = getUrgency(task);
  const dueColor = {
    ok: "text-gray-500 dark:text-gray-400",
    warning: "text-amber-600 dark:text-amber-400 font-semibold",
    overdue: "text-red-600 dark:text-red-400 font-bold",
    completed: "text-emerald-600 dark:text-emerald-400",
  }[urgency];

  return (
    <div
      onClick={onView}
      className="grid grid-cols-[minmax(260px,1fr)_130px_120px_180px_120px_74px] items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50/80 dark:hover:bg-gray-800/60 transition-colors cursor-pointer group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <TaskCheckbox task={task} onToggle={onToggleComplete} />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold text-gray-900 dark:text-white truncate", task.completed_at && "line-through text-gray-400 dark:text-gray-500")}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{task.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <MemberAvatar member={member} />
        <span className="text-xs text-gray-600 dark:text-gray-300 truncate">
          {member?.name || "Sem responsável"}
        </span>
      </div>

      <StatusPill task={task} />

      <div className="min-w-0">
        {linkedJob ? (
          <>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">
              {linkedJob.client_name || linkedJob.job_name || `Job #${linkedJob.id}`}
            </p>
            {linkedJob.job_type && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{linkedJob.job_type}</p>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">Sem vínculo</span>
        )}
      </div>

      <div className="min-w-0">
        {linkedStage ? (
          <>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{linkedStage.name}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{linkedProcess?.name || "Produção"}</p>
          </>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">Sem etapa</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 text-gray-400 hover:text-gold-500 hover:bg-gold-50 dark:hover:bg-gold-900/20 rounded-lg transition-colors"
          title="Editar"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          title="Excluir"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className={cn("col-start-4 col-span-3 flex items-center gap-2 text-xs", dueColor)}>
        <Clock size={11} />
        <span>{formatDueDate(task)}</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span>{formatDueRelative(task)}</span>
      </div>
    </div>
  );
}

interface TaskBoardCardProps extends Omit<TaskRowProps, "linkedStage" | "linkedProcess"> {
  isDragging?: boolean;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
}

function TaskBoardCard({
  task,
  member,
  linkedJob,
  isDragging,
  onToggleComplete,
  onEdit,
  onDelete,
  onView,
  onDragStart,
  onDragEnd,
}: TaskBoardCardProps) {
  const urgency = getUrgency(task);
  const accent = {
    ok: "border-l-gold-400",
    warning: "border-l-amber-400",
    overdue: "border-l-red-500",
    completed: "border-l-emerald-400",
  }[urgency];

  return (
    <div
      draggable
      onClick={onView}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart?.(task.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={cn(
        "w-full text-left p-3 rounded-lg border border-l-4 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing",
        "hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm transition-all",
        accent,
        task.completed_at && "opacity-70",
        isDragging && "opacity-40 ring-2 ring-gold-400"
      )}
    >
      <div className="flex items-start gap-2">
        <TaskCheckbox task={task} onToggle={onToggleComplete} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold text-gray-900 dark:text-white leading-snug", task.completed_at && "line-through text-gray-400 dark:text-gray-500")}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-gray-400 dark:text-gray-500 line-clamp-2 mt-1">{task.description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <StatusPill task={task} />
        <PriorityPill task={task} />
      </div>

      {linkedJob && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-gold-600 dark:text-gold-400 min-w-0">
          <ChevronRight size={11} />
          <span className="truncate">{linkedJob.client_name || linkedJob.job_name || `Job #${linkedJob.id}`}</span>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MemberAvatar member={member} />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{member?.name || "Sem responsável"}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1 text-gray-400 hover:text-gold-500 rounded"
            title="Editar"
          >
            <Edit2 size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 text-gray-400 hover:text-red-500 rounded"
            title="Excluir"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface TaskDetailDrawerProps {
  task: Task;
  member?: TeamMember;
  linkedJob?: JobWithProduction;
  linkedStage?: ProductionStageV2;
  linkedProcess?: ProductionProcess;
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
  onClose,
  onEdit,
  onDelete,
  onToggleComplete,
}: TaskDetailDrawerProps) {
  const urgency = getUrgency(task);
  const statusColor = {
    ok: "bg-gold-100 dark:bg-gold-900/40 text-gold-700 dark:text-gold-300",
    warning: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    overdue: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    completed: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  }[urgency];
  const statusLabel = { ok: "Em dia", warning: "Atenção", overdue: "Atrasada", completed: "Concluída" }[urgency];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl flex flex-col border-l border-gray-200 dark:border-gray-800 animate-in slide-in-from-right duration-200">
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full", statusColor)}>
              {statusLabel}
            </span>
            <PriorityPill task={task} />
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex items-start gap-3">
            <TaskCheckbox task={task} onToggle={onToggleComplete} />
            <h2 className={cn("text-lg font-bold text-gray-900 dark:text-white leading-snug", task.completed_at && "line-through text-gray-400 dark:text-gray-500")}>
              {task.title}
            </h2>
          </div>

          {task.description && (
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Descrição</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <CalendarClock size={14} className="text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Prazo</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{formatDueDate(task)}</p>
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

            <div className="flex items-center gap-3">
              <MemberAvatar member={member} />
              <div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Responsável</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{member?.name || "Sem responsável"}</p>
              </div>
            </div>

            {linkedJob && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center">
                  <ChevronRight size={14} className="text-gold-500" />
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Trabalho vinculado</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">
                    {linkedJob.client_name || linkedJob.job_name || `Job #${linkedJob.id}`}
                  </p>
                  {linkedJob.job_type && <p className="text-xs text-gray-400 dark:text-gray-500">{linkedJob.job_type}</p>}
                </div>
              </div>
            )}

            {linkedStage && (
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: linkedProcess ? `${linkedProcess.color}25` : "#e0e7ff" }}
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: linkedProcess?.color || "#6366f1" }} />
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wider">Etapa vinculada</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{linkedStage.name}</p>
                  {linkedProcess && <p className="text-xs text-gray-400 dark:text-gray-500">{linkedProcess.name}</p>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
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

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <button
            onClick={onToggleComplete}
            className={cn(
              "w-full py-2.5 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2",
              task.completed_at
                ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                : "bg-emerald-500 hover:bg-emerald-600 text-white"
            )}
          >
            <Check size={15} strokeWidth={2.5} />
            {task.completed_at ? "Reabrir tarefa" : "Marcar como concluída"}
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
  const [dueDate, setDueDate] = useState(task?.due_date || "");

  const isEdit = !!task?.id;
  const activeJobs = useMemo(() => jobs.filter((j) => j.status !== "cancelled"), [jobs]);

  const stageOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "Nenhuma etapa" }];
    processes.forEach((process) => {
      const processStages = stages
        .filter((stage) => stage.process_id === process.id)
        .sort((a, b) => a.position - b.position);
      processStages.forEach((stage) => opts.push({ value: stage.id, label: `${process.name} > ${stage.name}` }));
    });
    return opts;
  }, [stages, processes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white">{isEdit ? "Editar tarefa" : "Nova tarefa"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Título *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Editar fotos do ensaio"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes, checklist mental ou observações"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Responsável</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
              >
                <option value="">Sem responsável</option>
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Prazo *</label>
              <DateTimePicker value={dueDate} onChange={setDueDate} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Trabalho vinculado</label>
              <SearchableSelect
                value={jobId === "" ? "" : String(jobId)}
                onChange={(value) => setJobId(value ? Number(value) : "")}
                placeholder="Nenhum"
                options={[
                  { value: "", label: "Nenhum" },
                  ...activeJobs.map((job) => ({
                    value: String(job.id),
                    label: `${job.client_name || job.job_name || `Job #${job.id}`}${job.job_type ? ` - ${job.job_type}` : ""}`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Etapa vinculada</label>
              <SearchableSelect value={stageId} onChange={setStageId} placeholder="Nenhuma" options={stageOptions} />
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
                due_date: dueDate || undefined,
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

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [jobs, setJobs] = useState<JobWithProduction[]>([]);
  const [stages, setStages] = useState<ProductionStageV2[]>([]);
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [taskModal, setTaskModal] = useState<Partial<Task> | null | false>(false);
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskBucket | null>(null);

  const handleMoveTaskToBucket = async (taskId: string, targetBucket: TaskBucket) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const currentBucket = getTaskBucket(task);
    if (currentBucket === targetBucket) return;

    if (targetBucket === "completed") {
      if (task.completed_at) return;
      return handleToggleComplete(task);
    }

    const wasCompleted = !!task.completed_at;
    if (currentBucket === "completed") {
      const keepsDueOk = (() => {
        const due = new Date(task.due_date);
        if (targetBucket === "today" && isToday(due)) return true;
        if (targetBucket === "overdue" && Date.now() >= due.getTime() && !isToday(due)) return true;
        if (targetBucket === "upcoming" && due.getTime() > Date.now() && !isToday(due)) return true;
        return false;
      })();
      if (keepsDueOk) {
        return handleToggleComplete(task);
      }
    }

    const now = new Date();
    let newDue: Date;
    if (targetBucket === "overdue") {
      newDue = new Date(now);
      newDue.setDate(newDue.getDate() - 1);
      newDue.setHours(23, 59, 0, 0);
    } else if (targetBucket === "today") {
      const eod = new Date(now);
      eod.setHours(18, 0, 0, 0);
      newDue = eod.getTime() > now.getTime() ? eod : new Date(now.getTime() + 2 * 60 * 60 * 1000);
    } else {
      newDue = new Date(now);
      newDue.setDate(newDue.getDate() + 1);
      newDue.setHours(9, 0, 0, 0);
    }

    const newDueIso = newDue.toISOString();
    const payload: Partial<Task> = { ...task, due_date: newDueIso, completed_at: null };

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, due_date: newDueIso, completed_at: null } : t))
    );

    if (wasCompleted) {
      await authFetch(`/api/tasks/${taskId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: false }),
      });
    }
    await authFetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const fetchAll = async () => {
    try {
      const [tasksRes, jobsRes, stagesRes, processesRes, membersRes] = await Promise.all([
        authFetch("/api/tasks"),
        authFetch("/api/jobs"),
        authFetch("/api/production/stages-v2").catch(() => null),
        authFetch("/api/production/processes").catch(() => null),
        authFetch("/api/team-members").catch(() => null),
      ]);
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (jobsRes.ok) setJobs(await jobsRes.json());
      if (stagesRes?.ok) setStages(await stagesRes.json());
      if (processesRes?.ok) setProcesses(await processesRes.json());
      if (membersRes?.ok) setTeamMembers(await membersRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const taskCounts = useMemo(() => {
    const open = tasks.filter((task) => !task.completed_at);
    const overdue = tasks.filter((task) => getTaskBucket(task) === "overdue").length;
    const today = tasks.filter((task) => getTaskBucket(task) === "today").length;
    const completed = tasks.filter((task) => !!task.completed_at).length;
    return { open: open.length, overdue, today, completed, total: tasks.length };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const order: Record<TaskBucket, number> = { overdue: 0, today: 1, upcoming: 2, completed: 3 };

    return tasks
      .filter((task) => {
        if (statusFilter === "open" && task.completed_at) return false;
        if (statusFilter === "completed" && !task.completed_at) return false;
        if (statusFilter === "overdue" && getTaskBucket(task) !== "overdue") return false;
        if (statusFilter === "today" && getTaskBucket(task) !== "today") return false;
        if (assigneeFilter !== "all" && (assigneeFilter === "unassigned" ? !!task.assignee_id : task.assignee_id !== assigneeFilter)) return false;
        if (q) {
          const job = jobs.find((j) => j.id === task.job_id);
          const haystack = [
            task.title,
            task.description,
            job?.client_name,
            job?.job_name,
            job?.job_type,
          ].filter(Boolean).join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const bucketDiff = order[getTaskBucket(a)] - order[getTaskBucket(b)];
        if (bucketDiff !== 0) return bucketDiff;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
  }, [tasks, jobs, searchQuery, statusFilter, assigneeFilter]);

  const groupedTasks = useMemo(() => {
    return filteredTasks.reduce<Record<TaskBucket, Task[]>>(
      (acc, task) => {
        acc[getTaskBucket(task)].push(task);
        return acc;
      },
      { overdue: [], today: [], upcoming: [], completed: [] }
    );
  }, [filteredTasks]);

  const memberById = (id?: string | null) => teamMembers.find((member) => member.id === id);
  const jobById = (id?: number | null) => jobs.find((job) => job.id === id);
  const stageById = (id?: string | null) => stages.find((stage) => stage.id === id);
  const processById = (id?: string | null) => processes.find((process) => process.id === id);

  const handleSaveTask = async (data: Partial<Task>) => {
    setSaving(true);
    try {
      if (data.id) {
        await authFetch(`/api/tasks/${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        setTasks((prev) => prev.map((task) => (task.id === data.id ? { ...task, ...data } as Task : task)));
      } else {
        const res = await authFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const created = await res.json();
        if (res.ok) setTasks((prev) => [...prev, created]);
      }
      setTaskModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async (task: Task) => {
    const completed = !task.completed_at;
    const completedAt = completed ? new Date().toISOString() : null;
    setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, completed_at: completedAt } : item)));
    setViewTask((prev) => prev && prev.id === task.id ? { ...prev, completed_at: completedAt } : prev);
    await authFetch(`/api/tasks/${task.id}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  };

  const handleDeleteTask = async (id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
    setViewTask((prev) => prev && prev.id === id ? null : prev);
    await authFetch(`/api/tasks/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
  };

  const columns: Array<{ id: TaskBucket; title: string; icon: React.ReactNode; empty: string }> = [
    { id: "overdue", title: "Atrasadas", icon: <AlertTriangle size={14} />, empty: "Nada atrasado." },
    { id: "today", title: "Hoje", icon: <Clock size={14} />, empty: "Nada para hoje." },
    { id: "upcoming", title: "Próximas", icon: <CalendarClock size={14} />, empty: "Sem próximas tarefas." },
    { id: "completed", title: "Concluídas", icon: <CheckCircle2 size={14} />, empty: "Nada concluído neste filtro." },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <ListChecks size={23} className="text-gold-500" />
              Tarefas
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
              Organize o que precisa ser feito, por prazo, responsável e trabalho vinculado.
            </p>
          </div>
          <button
            onClick={() => setTaskModal({})}
            className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus size={16} />
            Nova tarefa
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Em aberto</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{taskCounts.open}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-red-100 dark:border-red-900/30 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-red-400 uppercase">Atrasadas</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{taskCounts.overdue}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-amber-100 dark:border-amber-900/30 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-amber-500 uppercase">Hoje</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{taskCounts.today}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-emerald-100 dark:border-emerald-900/30 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-emerald-500 uppercase">Concluídas</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{taskCounts.completed}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 shadow-sm">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar tarefa, cliente ou trabalho"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-gold-400 dark:focus:border-gold-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-gray-400" />
            {[
              { id: "open", label: "Abertas" },
              { id: "today", label: "Hoje" },
              { id: "overdue", label: "Atrasadas" },
              { id: "completed", label: "Concluídas" },
              { id: "all", label: "Todas" },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setStatusFilter(filter.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  statusFilter === filter.id
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 outline-none focus:border-gold-400"
          >
            <option value="all">Todos responsáveis</option>
            <option value="unassigned">Sem responsável</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>

          <div className="ml-auto flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                viewMode === "list"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              <ListChecks size={15} />
              Lista
            </button>
            <button
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                viewMode === "board"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              <Columns3 size={15} />
              Quadro
            </button>
          </div>
        </div>

        {viewMode === "list" ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-[minmax(260px,1fr)_130px_120px_180px_120px_74px] gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/80 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <span>Tarefa</span>
              <span>Responsável</span>
              <span>Status</span>
              <span>Trabalho</span>
              <span>Etapa</span>
              <span className="text-right">Ações</span>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 size={40} className="text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhuma tarefa encontrada.</p>
                <button
                  onClick={() => setTaskModal({})}
                  className="mt-4 px-5 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  Criar tarefa
                </button>
              </div>
            ) : (
              filteredTasks.map((task) => {
                const stage = stageById(task.stage_id);
                return (
                  <TaskListRow
                    key={task.id}
                    task={task}
                    member={memberById(task.assignee_id)}
                    linkedJob={jobById(task.job_id)}
                    linkedStage={stage}
                    linkedProcess={processById(stage?.process_id)}
                    onToggleComplete={() => handleToggleComplete(task)}
                    onEdit={() => setTaskModal(task)}
                    onDelete={() => setConfirmDelete({ id: task.id, title: task.title })}
                    onView={() => setViewTask(task)}
                  />
                );
              })
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-start">
            {columns.map((column) => {
              const isDropTarget = dragOverColumn === column.id;
              return (
                <section
                  key={column.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverColumn !== column.id) setDragOverColumn(column.id);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDragOverColumn((prev) => (prev === column.id ? null : prev));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const taskId = e.dataTransfer.getData("text/plain") || draggedTaskId;
                    setDragOverColumn(null);
                    setDraggedTaskId(null);
                    if (taskId) handleMoveTaskToBucket(taskId, column.id);
                  }}
                  className={cn(
                    "bg-gray-50 dark:bg-gray-900/60 border rounded-2xl min-h-[320px] transition-colors",
                    isDropTarget
                      ? "border-gold-400 dark:border-gold-500 bg-gold-50/40 dark:bg-gold-900/10"
                      : "border-gray-200 dark:border-gray-800"
                  )}
                >
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">{column.icon}</span>
                  <h3 className="text-sm font-bold text-gray-800 dark:text-white">{column.title}</h3>
                  <span className="ml-auto text-xs font-bold text-gray-400 dark:text-gray-500">
                    {groupedTasks[column.id].length}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {groupedTasks[column.id].length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">{column.empty}</p>
                  ) : (
                    groupedTasks[column.id].map((task) => (
                      <TaskBoardCard
                        key={task.id}
                        task={task}
                        member={memberById(task.assignee_id)}
                        linkedJob={jobById(task.job_id)}
                        isDragging={draggedTaskId === task.id}
                        onDragStart={setDraggedTaskId}
                        onDragEnd={() => { setDraggedTaskId(null); setDragOverColumn(null); }}
                        onToggleComplete={() => handleToggleComplete(task)}
                        onEdit={() => setTaskModal(task)}
                        onDelete={() => setConfirmDelete({ id: task.id, title: task.title })}
                        onView={() => setViewTask(task)}
                      />
                    ))
                  )}
                </div>
              </section>
              );
            })}
          </div>
        )}
      </div>

      {viewTask && (
        <TaskDetailDrawer
          task={viewTask}
          member={memberById(viewTask.assignee_id)}
          linkedJob={jobById(viewTask.job_id)}
          linkedStage={stageById(viewTask.stage_id)}
          linkedProcess={processById(stageById(viewTask.stage_id)?.process_id)}
          onClose={() => setViewTask(null)}
          onEdit={() => { setTaskModal(viewTask); setViewTask(null); }}
          onDelete={() => { setConfirmDelete({ id: viewTask.id, title: viewTask.title }); setViewTask(null); }}
          onToggleComplete={() => handleToggleComplete(viewTask)}
        />
      )}

      {taskModal !== false && (
        <TaskModal
          task={taskModal}
          teamMembers={teamMembers}
          jobs={jobs}
          stages={stages}
          processes={processes}
          onSave={handleSaveTask}
          onClose={() => setTaskModal(false)}
          saving={saving}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir tarefa"
        message={`Excluir "${confirmDelete?.title}"? Esta ação não pode ser desfeita.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => confirmDelete && handleDeleteTask(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
