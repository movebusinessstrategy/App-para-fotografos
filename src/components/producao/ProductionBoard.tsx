import React, { useRef, useState } from "react";
import { Calendar, Camera, Clock, Pencil, Check, X, MoveRight, Tag, UserCircle } from "lucide-react";
import { Job, ProductionProcess, ProductionStageV2, TeamMember } from "../../types";
import { parseDate } from "../../utils/date";
import { cn } from "../../utils/cn";
import { MoveStageModal } from "./MoveStageModal";
import { authFetch } from "../../utils/authFetch";

export type JobWithProduction = Job & {
  production_stage?: string | null;
  production_stage_entered_at?: string | null;
};

function getMemberInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export type { ProductionProcess, ProductionStageV2 };
// Re-export for backward compat (old ProductionStage type)
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
}

const formatCurrency = (value: number) =>
  (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

function getStaleness(enteredAt?: string | null, expectedHours?: number): 'urgent' | 'warning' | null {
  if (!enteredAt || !expectedHours || expectedHours <= 0) return null;
  const hoursInStage = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000;
  const progress = hoursInStage / expectedHours;
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
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const LABEL_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#f43f5e','#8b5cf6','#22c55e',
];

function getLabelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

// ── Column header with editable name + expected hours ──────────────────────
function StageColumn({
  stage,
  jobs,
  process,
  allStages,
  allProcesses,
  dragOverStage,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onJobClick,
  onMoveClick,
  onNameSave,
  onHoursSave,
  teamMembers,
  onAssigneeChange,
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
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [nameVal, setNameVal] = useState(stage.name);
  const [hoursVal, setHoursVal] = useState(String(stage.expected_hours || ''));
  const isOver = dragOverStage === stage.id;

  const commitName = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== stage.name) onNameSave(stage.id, trimmed);
    setEditingName(false);
  };

  const commitHours = () => {
    const h = parseFloat(hoursVal) || 0;
    onHoursSave(stage.id, h);
    setEditingHours(false);
  };

  const dotColor = stage.color || process?.color || '#94a3b8';

  return (
    <div
      className={cn(
        'flex h-full w-72 flex-shrink-0 flex-col rounded-xl border shadow-sm transition-colors',
        isOver
          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      )}
      onDragOver={e => onDragOver(e, stage.id)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, stage.id)}
    >
      {/* Column header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />

          {editingName ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                autoFocus
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditingName(false); setNameVal(stage.name); } }}
                className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-indigo-500 outline-none text-gray-900 dark:text-gray-100"
              />
              <button onClick={commitName} className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"><Check size={13} /></button>
              <button onClick={() => { setEditingName(false); setNameVal(stage.name); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0 group/name">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{stage.name}</h3>
              <button
                onClick={() => setEditingName(true)}
                className="opacity-0 group-hover/name:opacity-100 text-gray-400 hover:text-indigo-500 transition-opacity flex-shrink-0"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}

          <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">
            {jobs.length}
          </span>
        </div>

        {/* Expected hours row */}
        <div className="flex items-center gap-1 pl-5">
          <Clock size={10} className="text-gray-400 flex-shrink-0" />
          {editingHours ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                min="0"
                value={hoursVal}
                onChange={e => setHoursVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitHours(); if (e.key === 'Escape') { setEditingHours(false); setHoursVal(String(stage.expected_hours || '')); } }}
                className="w-16 text-xs bg-transparent border-b border-indigo-500 outline-none text-gray-700 dark:text-gray-300"
                placeholder="0"
              />
              <span className="text-[10px] text-gray-400">h</span>
              <button onClick={commitHours} className="text-emerald-600"><Check size={11} /></button>
              <button onClick={() => { setEditingHours(false); setHoursVal(String(stage.expected_hours || '')); }} className="text-gray-400"><X size={11} /></button>
            </div>
          ) : (
            <button
              onClick={() => setEditingHours(true)}
              className="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors group/h"
            >
              {stage.expected_hours > 0
                ? <><span className="font-medium">{stage.expected_hours}h</span> previsto</>
                : 'Definir tempo previsto'
              }
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

          const borderClass =
            staleness === 'urgent' ? 'border-red-500 animate-pulse-red' :
            staleness === 'warning' ? 'border-amber-400 animate-pulse-amber' :
            'border-gray-200 dark:border-gray-700';

          const bgClass =
            staleness === 'urgent' ? 'bg-red-50/70 dark:bg-red-900/10' :
            staleness === 'warning' ? 'bg-amber-50/70 dark:bg-amber-900/10' :
            'bg-gray-50 dark:bg-gray-900';

          const elapsed = formatElapsed(job.production_stage_entered_at);

          const assignee = teamMembers.find(m => m.id === job.assignee_id);

          return (
            <div
              key={job.id}
              draggable
              onDragStart={() => onDragStart(job.id)}
              className={cn('rounded-xl border p-3 shadow-sm transition-all cursor-pointer hover:shadow-md group/card active:opacity-70', bgClass, borderClass)}
            >
              {/* Click area */}
              <div onClick={() => onJobClick(job)}>
                {/* Top row: nome + avatar responsável */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {job.client_name || job.job_name || 'Trabalho'}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      <Camera size={10} /> {job.job_type}
                    </p>
                  </div>

                  {/* Avatar do responsável — bem visível */}
                  <AssigneeAvatar
                    assignee={assignee}
                    teamMembers={teamMembers}
                    onAssign={id => onAssigneeChange(job.id, id)}
                  />
                </div>

                {/* Responsável por extenso (quando tem) */}
                {assignee && (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg mb-2 text-white text-[11px] font-semibold"
                    style={{ backgroundColor: assignee.color }}
                  >
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
                      <span className={cn(
                        'flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                        staleness === 'urgent'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                          : staleness === 'warning'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      )}>
                        <Clock size={9} />
                        {elapsed}
                      </span>
                    )}
                  </div>
                </div>

                {/* Labels */}
                {job.labels && job.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {job.labels.map(label => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: getLabelColor(label) }}
                      >
                        <Tag size={8} />
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Move button */}
              <button
                onClick={e => { e.stopPropagation(); onMoveClick(job); }}
                className="w-full mt-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors opacity-0 group-hover/card:opacity-100"
              >
                <MoveRight size={12} />
                Mover para...
              </button>
            </div>
          );
        })}

        {jobs.length === 0 && (
          <div className={cn(
            'rounded-xl border border-dashed p-4 text-center text-xs transition-colors',
            isOver
              ? 'border-indigo-400 bg-indigo-50/50 text-indigo-400 dark:border-indigo-500 dark:bg-indigo-900/10 dark:text-indigo-400'
              : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500'
          )}>
            {isOver ? 'Soltar aqui' : 'Vazio'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente de avatar do responsável com dropdown ─────────────────────────
function AssigneeAvatar({
  assignee,
  teamMembers,
  onAssign,
}: {
  assignee: TeamMember | undefined;
  teamMembers: TeamMember[];
  onAssign: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (teamMembers.length === 0) return null;

  return (
    <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        title={assignee ? assignee.name : 'Atribuir responsável'}
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-md ring-2 ring-white dark:ring-gray-800 transition-transform hover:scale-110',
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
              <button
                key={m.id}
                onClick={() => { onAssign(m.id === assignee?.id ? null : m.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                  style={{ backgroundColor: m.color }}
                >
                  {getMemberInitials(m.name)}
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{m.name}</span>
                {m.id === assignee?.id && <Check size={13} className="ml-auto text-indigo-500 flex-shrink-0" />}
              </button>
            ))}
            {assignee && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                <button
                  onClick={() => { onAssign(null); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left text-red-500"
                >
                  <X size={13} />
                  <span className="text-sm">Remover</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ProductionBoard({ jobs, processes, stages, teamMembers, onChangeStage, onJobClick, onStagesUpdate, onAssigneeChange }: ProductionBoardProps) {
  const [activeProcess, setActiveProcess] = useState(processes[0]?.id || '');
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [movingJob, setMovingJob] = useState<JobWithProduction | null>(null);
  const dragJobId = useRef<number | null>(null);

  const processStages = stages
    .filter(s => s.process_id === activeProcess)
    .sort((a, b) => a.position - b.position);

  const activeProcessObj = processes.find(p => p.id === activeProcess);

  const handleDragStart = (jobId: number) => { dragJobId.current = jobId; };
  const handleDragOver = (e: React.DragEvent, stageId: string) => { e.preventDefault(); setDragOverStage(stageId); };
  const handleDragLeave = () => setDragOverStage(null);
  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragJobId.current !== null) {
      onChangeStage(dragJobId.current, stageId);
      dragJobId.current = null;
    }
  };

  const handleNameSave = async (stageId: string, name: string) => {
    try {
      await authFetch(`/api/production/stages/${stageId}/name`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      onStagesUpdate(stages.map(s => s.id === stageId ? { ...s, name } : s));
    } catch (_) {}
  };

  const handleHoursSave = async (stageId: string, hours: number) => {
    try {
      await authFetch(`/api/production/stages/${stageId}/expected-hours`, {
        method: 'PATCH',
        body: JSON.stringify({ expected_hours: hours }),
      });
      onStagesUpdate(stages.map(s => s.id === stageId ? { ...s, expected_hours: hours } : s));
    } catch (_) {}
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Process tabs */}
      <div className="flex gap-2 flex-wrap">
        {processes.map(p => (
          <button
            key={p.id}
            onClick={() => setActiveProcess(p.id)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-semibold border transition-all',
              activeProcess === p.id
                ? 'text-white border-transparent shadow-md'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            )}
            style={activeProcess === p.id ? { backgroundColor: p.color, borderColor: p.color } : {}}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Count summary for this process */}
      {activeProcessObj && (
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: activeProcessObj.color }} />
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {jobs.filter(j => processStages.some(s => s.id === j.production_stage)).length} trabalhos neste processo
          </span>
        </div>
      )}

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1 scrollbar-thin" style={{ minHeight: '400px' }}>
        {processStages.map(stage => {
          const stageJobs = jobs.filter(job => job.production_stage === stage.id);
          const proc = processes.find(p => p.id === stage.process_id);
          return (
            <React.Fragment key={stage.id}>
              <StageColumn
                stage={stage}
                jobs={stageJobs}
                process={proc}
                allStages={stages}
                allProcesses={processes}
                dragOverStage={dragOverStage}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onJobClick={onJobClick}
                onMoveClick={job => setMovingJob(job)}
                onNameSave={handleNameSave}
                onHoursSave={handleHoursSave}
                teamMembers={teamMembers}
                onAssigneeChange={onAssigneeChange}
              />
            </React.Fragment>
          );
        })}

        {processStages.length === 0 && (
          <div className="flex items-center justify-center w-full py-20">
            <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhuma etapa neste processo.</p>
          </div>
        )}
      </div>

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
