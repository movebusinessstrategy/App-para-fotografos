import React, { useEffect, useRef, useState } from "react";
import { Calendar, Camera, Clock, Pencil, Check, X, MoveRight, Tag, UserCircle, Star, GripHorizontal, Trash2 } from "lucide-react";
import { Job, ProductionProcess, ProductionStageV2, TeamMember } from "../../types";
import { parseDate } from "../../utils/date";
import { cn } from "../../utils/cn";
import { MoveStageModal } from "./MoveStageModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { authFetch } from "../../utils/authFetch";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type JobWithProduction = Job & {
  production_stage?: string | null;
  production_stage_entered_at?: string | null;
};

function getMemberInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export type { ProductionProcess, ProductionStageV2 };
export type ProductionStage = { id: string; name: string; position: number; color?: string };

interface ProductionBoardProps {
  jobs: JobWithProduction[];
  processes: ProductionProcess[];
  stages: ProductionStageV2[];
  teamMembers: TeamMember[];
  onChangeStage: (jobId: number, stageId: string) => void;
  onJobClick: (job: JobWithProduction) => void;
  onStagesUpdate: (stages: ProductionStageV2[]) => void;
  onAssigneeChange: (jobId: number, assigneeId: string | null) => void;
  onRemoveFromProduction: (jobId: number) => void;
}

const formatCurrency = (value: number) =>
  (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

function getStaleness(enteredAt?: string | null, expectedHours?: number): 'urgent' | 'warning' | null {
  if (!enteredAt || !expectedHours || expectedHours <= 0) return null;
  const progress = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000 / expectedHours;
  if (progress >= 1.0) return 'urgent';
  if (progress >= 0.5) return 'warning';
  return null;
}

function formatElapsed(enteredAt?: string | null): string | null {
  if (!enteredAt) return null;
  const ms = Date.now() - new Date(enteredAt).getTime();
  if (ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const LABEL_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#f43f5e','#8b5cf6','#22c55e'];
function getLabelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

// ── Stage column ──────────────────────────────────────────────────────────────
function StageColumn({
  stage, jobs, process, allStages, allProcesses, dragOverStage,
  onDragStart, onDragOver, onDragLeave, onDrop, onJobClick, onMoveClick,
  onNameSave, onHoursSave, teamMembers, onAssigneeChange, onRemoveFromProduction,
}: {
  stage: ProductionStageV2;
  jobs: JobWithProduction[];
  process: ProductionProcess | undefined;
  allStages: ProductionStageV2[];
  allProcesses: ProductionProcess[];
  dragOverStage: string | null;
  onDragStart: (id: number) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onJobClick: (job: JobWithProduction) => void;
  onMoveClick: (job: JobWithProduction) => void;
  onNameSave: (stageId: string, name: string) => void;
  onHoursSave: (stageId: string, hours: number) => void;
  teamMembers: TeamMember[];
  onAssigneeChange: (jobId: number, assigneeId: string | null) => void;
  onRemoveFromProduction: (jobId: number) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [nameVal, setNameVal] = useState(stage.name);
  const [hoursVal, setHoursVal] = useState(String(stage.expected_hours || ''));
  const [confirmRemoveJob, setConfirmRemoveJob] = useState<JobWithProduction | null>(null);
  const isOver = dragOverStage === stage.id;
  const dotColor = stage.color || process?.color || '#94a3b8';

  const commitName = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== stage.name) onNameSave(stage.id, trimmed);
    setEditingName(false);
  };
  const commitHours = () => { onHoursSave(stage.id, parseFloat(hoursVal) || 0); setEditingHours(false); };

  return (
    <div
      className={cn(
        'flex h-full w-72 flex-shrink-0 flex-col rounded-xl border shadow-sm transition-colors',
        isOver ? 'border-gold-400 bg-gold-50 dark:border-gold-500 dark:bg-gold-900/20'
               : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      )}
      onDragOver={e => onDragOver(e, stage.id)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, stage.id)}
    >
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          {editingName ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditingName(false); setNameVal(stage.name); } }}
                className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-gold-500 outline-none text-gray-900 dark:text-gray-100"
              />
              <button onClick={commitName} className="text-emerald-600 flex-shrink-0"><Check size={13} /></button>
              <button onClick={() => { setEditingName(false); setNameVal(stage.name); }} className="text-gray-400 flex-shrink-0"><X size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0 group/name">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{stage.name}</h3>
              <button onClick={() => setEditingName(true)} className="opacity-0 group-hover/name:opacity-100 text-gray-400 hover:text-gold-500 transition-opacity flex-shrink-0">
                <Pencil size={11} />
              </button>
            </div>
          )}
          <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">
            {jobs.length}
          </span>
        </div>
        <div className="flex items-center gap-1 pl-5">
          <Clock size={10} className="text-gray-400 flex-shrink-0" />
          {editingHours ? (
            <div className="flex items-center gap-1">
              <input autoFocus type="number" min="0" value={hoursVal} onChange={e => setHoursVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitHours(); if (e.key === 'Escape') { setEditingHours(false); setHoursVal(String(stage.expected_hours || '')); } }}
                className="w-16 text-xs bg-transparent border-b border-gold-500 outline-none text-gray-700 dark:text-gray-300" placeholder="0"
              />
              <span className="text-[10px] text-gray-400">h</span>
              <button onClick={commitHours} className="text-emerald-600"><Check size={11} /></button>
              <button onClick={() => { setEditingHours(false); setHoursVal(String(stage.expected_hours || '')); }} className="text-gray-400"><X size={11} /></button>
            </div>
          ) : (
            <button onClick={() => setEditingHours(true)} className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-gold-500 transition-colors group/h">
              {stage.expected_hours > 0 ? <><span className="font-medium">{stage.expected_hours}h</span> previsto</> : 'Definir tempo previsto'}
              <Pencil size={9} className="ml-1 opacity-0 group-hover/h:opacity-100" />
            </button>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {jobs.map(job => {
          const staleness = getStaleness(job.production_stage_entered_at, stage.expected_hours);
          const jobDate = job.job_date ? parseDate(job.job_date) : null;
          const elapsed = formatElapsed(job.production_stage_entered_at);
          const assignee = teamMembers.find(m => m.id === job.assignee_id);

          return (
            <div
              key={job.id}
              draggable
              onDragStart={() => onDragStart(job.id)}
              className={cn(
                'rounded-xl border p-3 shadow-sm transition-all cursor-pointer hover:shadow-md group/card active:opacity-70',
                staleness === 'urgent' ? 'border-red-500 animate-pulse-red bg-red-50/70 dark:bg-red-900/10' :
                staleness === 'warning' ? 'border-amber-400 animate-pulse-amber bg-amber-50/70 dark:bg-amber-900/10' :
                'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
              )}
            >
              <div onClick={() => onJobClick(job)}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {job.client_name || job.job_name || 'Trabalho'}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      <Camera size={10} /> {job.job_type}
                    </p>
                  </div>
                  <AssigneeAvatar assignee={assignee} teamMembers={teamMembers} onAssign={id => onAssigneeChange(job.id, id)} />
                </div>

                {assignee && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg mb-2 text-white text-[11px] font-semibold" style={{ backgroundColor: assignee.color }}>
                    <span className="w-4 h-4 rounded-full bg-white/30 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                      {getMemberInitials(assignee.name)}
                    </span>
                    <span className="truncate">{assignee.name}</span>
                  </div>
                )}

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {jobDate && (
                      <p className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
                        <Calendar size={10} /> {jobDate.toLocaleDateString('pt-BR')}
                      </p>
                    )}
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{formatCurrency(job.amount)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {staleness === 'urgent' && <span className="text-[9px] font-bold text-red-500">ATRASADO</span>}
                    {staleness === 'warning' && <span className="text-[9px] font-bold text-amber-500">ATENÇÃO</span>}
                    {elapsed && (
                      <span className={cn('flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                        staleness === 'urgent' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                        staleness === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      )}>
                        <Clock size={9} /> {elapsed}
                      </span>
                    )}
                  </div>
                </div>

                {job.labels && job.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {job.labels.map(label => (
                      <span key={label} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: getLabelColor(label) }}>
                        <Tag size={8} /> {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-1 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); onMoveClick(job); }}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[11px] font-medium text-gray-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                >
                  <MoveRight size={12} /> Mover para...
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmRemoveJob(job); }}
                  className="flex items-center justify-center px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Remover da produção"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {jobs.length === 0 && (
          <div className={cn('rounded-xl border border-dashed p-4 text-center text-xs transition-colors',
            isOver ? 'border-gold-400 bg-gold-50/50 text-gold-400 dark:border-gold-500 dark:bg-gold-900/10' : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500'
          )}>
            {isOver ? 'Soltar aqui' : 'Vazio'}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!confirmRemoveJob}
        title="Remover da produção"
        message={`Remover "${confirmRemoveJob?.client_name || confirmRemoveJob?.job_name || 'este trabalho'}" da produção? O cliente e o trabalho continuam salvos.`}
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { onRemoveFromProduction(confirmRemoveJob!.id); setConfirmRemoveJob(null); }}
        onCancel={() => setConfirmRemoveJob(null)}
      />
    </div>
  );
}

// ── Assignee avatar dropdown ──────────────────────────────────────────────────
function AssigneeAvatar({ assignee, teamMembers, onAssign }: { assignee: TeamMember | undefined; teamMembers: TeamMember[]; onAssign: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (teamMembers.length === 0) return null;

  return (
    <>
      <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setOpen(v => !v)}
          title={assignee ? assignee.name : 'Atribuir responsável'}
          className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-md ring-2 ring-white dark:ring-gray-800 transition-transform hover:scale-110',
            assignee ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          )}
          style={assignee ? { backgroundColor: assignee.color } : {}}
        >
          {assignee ? getMemberInitials(assignee.name) : <UserCircle size={16} />}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-10 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1.5 min-w-[160px]">
              <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Responsável</p>
              {teamMembers.map(m => (
                <button key={m.id} onClick={() => { onAssign(m.id === assignee?.id ? null : m.id); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ backgroundColor: m.color }}>
                    {getMemberInitials(m.name)}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{m.name}</span>
                  {m.id === assignee?.id && <Check size={13} className="ml-auto text-gold-500 flex-shrink-0" />}
                </button>
              ))}
              {assignee && (
                <>
                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => { setOpen(false); setConfirmRemove(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left text-red-500"
                  >
                    <X size={13} /><span className="text-sm">Remover</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmRemove}
        title="Remover responsável"
        message={`Remover ${assignee?.name} desta etapa?`}
        confirmText="Remover"
        variant="danger"
        onConfirm={() => { onAssign(null); setConfirmRemove(false); }}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}

// ── Kanban columns for a process ──────────────────────────────────────────────
function ProcessKanban({
  process, stages, jobs, teamMembers, dragOverStage,
  onDragStart, onDragOver, onDragLeave, onDrop,
  onJobClick, onMoveClick, onNameSave, onHoursSave, onAssigneeChange, onRemoveFromProduction, allProcesses,
}: {
  process: ProductionProcess;
  stages: ProductionStageV2[];
  jobs: JobWithProduction[];
  teamMembers: TeamMember[];
  dragOverStage: string | null;
  onDragStart: (id: number) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onJobClick: (job: JobWithProduction) => void;
  onMoveClick: (job: JobWithProduction) => void;
  onNameSave: (stageId: string, name: string) => void;
  onHoursSave: (stageId: string, hours: number) => void;
  onAssigneeChange: (jobId: number, assigneeId: string | null) => void;
  onRemoveFromProduction: (jobId: number) => void;
  allProcesses: ProductionProcess[];
}) {
  const procStages = stages.filter(s => s.process_id === process.id).sort((a, b) => a.position - b.position);

  return (
    <div className="flex gap-4 overflow-x-auto h-full p-3 pb-4">
      {procStages.map(stage => (
        <React.Fragment key={stage.id}>
          <StageColumn
            stage={stage}
            jobs={jobs.filter(j => j.production_stage === stage.id)}
            process={process}
            allStages={stages}
            allProcesses={allProcesses}
            dragOverStage={dragOverStage}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onJobClick={onJobClick}
            onMoveClick={onMoveClick}
            onNameSave={onNameSave}
            onHoursSave={onHoursSave}
            teamMembers={teamMembers}
            onAssigneeChange={onAssigneeChange}
            onRemoveFromProduction={onRemoveFromProduction}
          />
        </React.Fragment>
      ))}
      {procStages.length === 0 && (
        <div className="flex items-center justify-center w-full py-12">
          <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhuma etapa neste processo.</p>
        </div>
      )}
    </div>
  );
}

// ── Sortable process tab ───────────────────────────────────────────────────────
type SortableProcessTabProps = {
  process: ProductionProcess;
  isActive: boolean;
  jobs: JobWithProduction[];
  stages: ProductionStageV2[];
  isDraggingThis: boolean;
  onSelect: () => void;
};
const SortableProcessTab: React.FC<SortableProcessTabProps> = ({
  process, isActive, jobs, stages, isDraggingThis, onSelect,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: process.id });
  const isSpecial = !!process.is_special;
  const color = process.color || '#94a3b8';
  const procStages = stages.filter(s => s.process_id === process.id);
  const jobCount = jobs.filter(j => procStages.some(s => s.id === j.production_stage)).length;

  return (
    <button
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(!isActive ? { backgroundColor: isSpecial ? '#D4A94A' : color, borderColor: 'transparent' } : {}),
      }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 rounded-t-xl border transition-colors flex-shrink-0 select-none cursor-pointer',
        isDraggingThis && 'opacity-0',
        isActive
          ? 'px-5 py-2.5 text-sm font-bold border-b-white dark:border-b-gray-900 shadow-sm z-10 -mb-px text-gray-900 dark:text-white'
          : 'px-4 py-2 text-xs font-semibold border-b-0 text-white hover:brightness-110',
        isActive && isSpecial
          ? 'bg-amber-50 dark:bg-amber-950 border-gold-300 dark:border-gold-700'
          : isActive
            ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            : ''
      )}
    >
      {isActive
        ? isSpecial
          ? <Star size={13} className="text-gold-500 flex-shrink-0" fill="currentColor" />
          : <GripHorizontal size={12} className="text-gray-300 dark:text-gray-600 flex-shrink-0" />
        : isSpecial
          ? <Star size={11} className="text-white/80 flex-shrink-0" fill="currentColor" />
          : <GripHorizontal size={11} className="text-white/50 flex-shrink-0" />
      }
      <span className={cn(
        'truncate',
        isActive ? 'max-w-[140px]' : 'max-w-[90px]',
        isActive && isSpecial && 'text-gold-700 dark:text-gold-300'
      )}>
        {process.name}
      </span>
      {jobCount > 0 && (
        <span className={cn(
          'px-1.5 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0',
          isActive && isSpecial
            ? 'bg-gold-200 dark:bg-gold-800/50 text-gold-700 dark:text-gold-300'
            : isActive
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              : 'bg-black/25 text-white'
        )}>
          {jobCount}
        </span>
      )}
    </button>
  );
}

// ── Main board ────────────────────────────────────────────────────────────────
export function ProductionBoard({ jobs, processes, stages, teamMembers, onChangeStage, onJobClick, onStagesUpdate, onAssigneeChange, onRemoveFromProduction }: ProductionBoardProps) {
  const [orderedProcesses, setOrderedProcesses] = useState<ProductionProcess[]>(processes);
  useEffect(() => { setOrderedProcesses(processes); }, [processes]);

  const regularProcesses = orderedProcesses.filter(p => !p.is_special);
  const specialProcesses = orderedProcesses.filter(p => p.is_special);

  const [openProcess, setOpenProcess] = useState<string>(regularProcesses[0]?.id || processes[0]?.id || '');
  const [movingJob, setMovingJob] = useState<JobWithProduction | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [draggingTab, setDraggingTab] = useState<ProductionProcess | null>(null);
  const dragJobId = useRef<number | null>(null);

  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleTabDragStart = (event: DragStartEvent) => {
    const p = orderedProcesses.find(x => x.id === event.active.id);
    setDraggingTab(p || null);
  };

  const handleTabDragEnd = async (event: DragEndEvent) => {
    setDraggingTab(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedProcesses.findIndex(p => p.id === active.id);
    const newIdx = orderedProcesses.findIndex(p => p.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove<ProductionProcess>(orderedProcesses, oldIdx, newIdx);
    setOrderedProcesses(newOrder);
    try {
      await authFetch('/api/production/processes/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processIds: newOrder.map(p => p.id) }),
      });
    } catch (_) {
      setOrderedProcesses(orderedProcesses);
    }
  };

  const handleDragStart = (jobId: number) => { dragJobId.current = jobId; };
  const handleDragOver = (e: React.DragEvent, stageId: string) => { e.preventDefault(); setDragOverStage(stageId); };
  const handleDragLeave = () => setDragOverStage(null);
  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragJobId.current !== null) { onChangeStage(dragJobId.current, stageId); dragJobId.current = null; }
  };

  const handleNameSave = async (stageId: string, name: string) => {
    try {
      await authFetch(`/api/production/stages/${stageId}/name`, { method: 'PATCH', body: JSON.stringify({ name }) });
      onStagesUpdate(stages.map(s => s.id === stageId ? { ...s, name } : s));
    } catch (_) {}
  };

  const handleHoursSave = async (stageId: string, hours: number) => {
    try {
      await authFetch(`/api/production/stages/${stageId}/expected-hours`, { method: 'PATCH', body: JSON.stringify({ expected_hours: hours }) });
      onStagesUpdate(stages.map(s => s.id === stageId ? { ...s, expected_hours: hours } : s));
    } catch (_) {}
  };

  const kanbanProps = {
    jobs, teamMembers, dragOverStage, allProcesses: processes,
    onDragStart: handleDragStart, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop,
    onJobClick, onMoveClick: (job: JobWithProduction) => setMovingJob(job),
    onNameSave: handleNameSave, onHoursSave: handleHoursSave, onAssigneeChange, onRemoveFromProduction,
  };

  const activeProcess = processes.find(p => p.id === openProcess);
  const isActiveSpecial = activeProcess?.is_special ?? false;

  return (
    <div className="flex flex-col gap-3">

      {/* ── All processes — folder tabs (special ones highlighted) ── */}
      {processes.length > 0 && (
        <div className="flex flex-col">

          {/* Tab row — draggable to reorder */}
          <DndContext
            sensors={tabSensors}
            collisionDetection={closestCenter}
            onDragStart={handleTabDragStart}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext items={orderedProcesses.map(p => p.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex items-end gap-1.5 overflow-x-auto flex-shrink-0 pb-0">
                {orderedProcesses.map(process => (
                  <SortableProcessTab
                    key={process.id}
                    process={process}
                    isActive={openProcess === process.id}
                    jobs={jobs}
                    stages={stages}
                    isDraggingThis={draggingTab?.id === process.id}
                    onSelect={() => setOpenProcess(process.id)}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {draggingTab && (
                <div
                  className="flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-bold text-white shadow-xl opacity-90 cursor-grabbing"
                  style={{ backgroundColor: draggingTab.color || '#94a3b8' }}
                >
                  <GripHorizontal size={13} className="text-white/70" />
                  {draggingTab.name}
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Kanban panel — gold border when a special process is active */}
          <div
            className={cn(
              'rounded-b-xl rounded-tr-xl overflow-hidden relative z-0',
              isActiveSpecial
                ? 'border-2 border-gold-400 dark:border-gold-600 bg-amber-50/30 dark:bg-amber-950/30'
                : 'border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'
            )}
            style={{
              height: 'calc(100vh - 300px)',
              minHeight: '380px',
              ...(isActiveSpecial ? { boxShadow: '0 0 0 1px rgba(241,198,101,0.15), 0 4px 16px rgba(212,169,74,0.10)' } : {}),
            }}
          >
            {activeProcess ? (
              <ProcessKanban process={activeProcess} stages={stages} {...kanbanProps} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
                Selecione um processo acima.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Move modal */}
      {movingJob && (
        <MoveStageModal
          job={movingJob}
          processes={processes}
          stages={stages}
          onMove={stageId => { onChangeStage(movingJob.id, stageId); setMovingJob(null); }}
          onClose={() => setMovingJob(null)}
        />
      )}
    </div>
  );
}
