import React, { useRef, useState } from "react";
import { Calendar, Camera, GripVertical } from "lucide-react";
import { Job } from "../../types";
import { parseDate } from "../../utils/date";

export type ProductionStage = {
  id: string;
  name: string;
  position: number;
  color?: string;
};

export type JobWithProduction = Job & { production_stage?: string | null };

interface ProductionBoardProps {
  jobs: JobWithProduction[];
  stages: ProductionStage[];
  onChangeStage: (jobId: number, stageId: string) => void;
  onJobClick: (job: JobWithProduction) => void;
}

const formatCurrency = (value: number) =>
  (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

export function ProductionBoard({ jobs, stages, onChangeStage, onJobClick }: ProductionBoardProps) {
  const orderedStages = [...stages].sort((a, b) => a.position - b.position);
  const dragJobId = useRef<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (jobId: number) => {
    dragJobId.current = jobId;
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(stageId);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragJobId.current !== null) {
      onChangeStage(dragJobId.current, stageId);
      dragJobId.current = null;
    }
  };

  const handleDragEnd = () => {
    setDragOverStage(null);
    dragJobId.current = null;
  };

  return (
    <div className="flex h-[calc(100vh-220px)] gap-4 overflow-x-auto pb-2">
      {orderedStages.map((stage) => {
        const stageJobs = jobs.filter((job) => {
          const jobStage = job.production_stage || stageFallback(job.status);
          return jobStage === stage.id || `prod-${jobStage}` === stage.id || jobStage === stage.id.replace(/^prod-/, '');
        });

        const isOver = dragOverStage === stage.id;

        return (
          <div
            key={stage.id}
            className={`flex h-full w-72 flex-shrink-0 flex-col rounded-xl border shadow-sm transition-colors ${
              isOver
                ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
                : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            }`}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, stage.id)}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: stage.color || "#94a3b8" }}
                />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stage.name}</h3>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {stageJobs.length}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {stageJobs.map((job) => {
                const jobDate = job.job_date ? parseDate(job.job_date) : null;
                return (
                  <div
                    key={job.id}
                    draggable
                    onDragStart={() => handleDragStart(job.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onJobClick(job)}
                    className="cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-3 shadow-sm transition hover:shadow-md active:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1">
                        <GripVertical size={14} className="mt-0.5 flex-shrink-0 text-gray-300 dark:text-gray-600" />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {job.client_name || job.job_name || "Tarefa"}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <Camera size={12} /> {job.job_type}
                          </p>
                          {jobDate && (
                            <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <Calendar size={12} /> {jobDate.toLocaleDateString("pt-BR")}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="flex-shrink-0 text-xs font-bold text-gray-700 dark:text-gray-200">
                        {formatCurrency(job.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {stageJobs.length === 0 && (
                <div className={`rounded-lg border border-dashed p-4 text-center text-xs transition-colors ${
                  isOver
                    ? "border-blue-400 bg-blue-50 text-blue-400 dark:border-blue-500 dark:bg-blue-900/10 dark:text-blue-400"
                    : "border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500"
                }`}>
                  {isOver ? "Soltar aqui" : "Nada aqui ainda."}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const stageFallback = (status?: string) => {
  if (status === "completed") return "prod-entregue";
  if (status === "scheduled") return "prod-agendado";
  return "prod-agendado";
};
