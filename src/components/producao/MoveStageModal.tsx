import React, { useState } from 'react';
import { X, MoveRight } from 'lucide-react';
import { ProductionProcess, ProductionStageV2, Job } from '../../types';
import { cn } from '../../utils/cn';

interface MoveStageModalProps {
  job: Job & { production_stage?: string | null };
  processes: ProductionProcess[];
  stages: ProductionStageV2[];
  onMove: (stageId: string) => void;
  onClose: () => void;
}

export function MoveStageModal({ job, processes, stages, onMove, onClose }: MoveStageModalProps) {
  const currentProcessId = stages.find(s => s.id === job.production_stage)?.process_id;
  const [selectedProcess, setSelectedProcess] = useState(currentProcessId || processes[0]?.id || '');
  const [selectedStage, setSelectedStage] = useState(job.production_stage || '');

  const processStages = stages
    .filter(s => s.process_id === selectedProcess)
    .sort((a, b) => a.position - b.position);

  const handleProcessSelect = (pid: string) => {
    setSelectedProcess(pid);
    const first = stages.filter(s => s.process_id === pid).sort((a, b) => a.position - b.position)[0];
    setSelectedStage(first?.id || '');
  };

  const handleMove = () => {
    if (selectedStage) {
      onMove(selectedStage);
      onClose();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Mover para etapa</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-xs">
                {job.client_name || job.job_name || 'Trabalho'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Process selector */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Processo</p>
              <div className="flex flex-wrap gap-2">
                {processes.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProcessSelect(p.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      selectedProcess === p.id
                        ? 'text-white border-transparent'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    )}
                    style={selectedProcess === p.id ? { backgroundColor: p.color, borderColor: p.color } : {}}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage selector */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Etapa</p>
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {processStages.map(s => {
                  const proc = processes.find(p => p.id === s.process_id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStage(s.id)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-xl border text-left text-xs font-medium transition-all',
                        selectedStage === s.id
                          ? 'border-transparent text-white'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                      style={selectedStage === s.id ? { backgroundColor: s.color || proc?.color || '#6366f1', borderColor: s.color || proc?.color } : {}}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: selectedStage === s.id ? 'rgba(255,255,255,0.6)' : (s.color || proc?.color || '#94a3b8') }}
                      />
                      <span className="truncate">{s.name}</span>
                      {s.is_final && (
                        <span className={cn('ml-auto text-[9px] font-bold uppercase', selectedStage === s.id ? 'text-white/70' : 'text-gray-400')}>Final</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100 dark:border-gray-800">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleMove}
              disabled={!selectedStage || selectedStage === job.production_stage}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <MoveRight size={15} />
              Mover
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
