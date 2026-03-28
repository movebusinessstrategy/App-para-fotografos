import React, { useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2 } from "lucide-react";

import { ConfirmModal } from "../ui/ConfirmModal";
import { PipelineStage } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";

interface StageManagerProps {
  open: boolean;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdated: () => void;
  apiBasePath?: string;
}

export function StageManager({ open, stages, onClose, onUpdated, apiBasePath = "/api/pipeline/stages" }: StageManagerProps) {
  const [localStages, setLocalStages] = useState<PipelineStage[]>([]);
  const [newStage, setNewStage] = useState({ name: "", color: "#E5E7EB" });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
    title: string;
    message: string;
    variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });

  useEffect(() => {
    setLocalStages(stages.filter((s) => !s.is_final));
  }, [stages]);

  const finals = useMemo(() => stages.filter((s) => s.is_final).sort((a, b) => a.position - b.position), [stages]);

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(localStages, oldIndex, newIndex).map((stage: PipelineStage, idx: number) => ({ ...stage, position: idx }));
    setLocalStages(reordered);
    await authFetch(`${apiBasePath}/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageIds: reordered.map((s) => s.id) }),
    });
    onUpdated();
  };

  const updateStage = async (stageId: string, patch: Partial<PipelineStage>) => {
    setLocalStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
    await authFetch(`${apiBasePath}/${stageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onUpdated();
  };

  const deleteStage = (stageId: string) => {
    setConfirmModal({
      open: true,
      title: "Remover etapa",
      message: "Remover esta etapa? Os deals serão movidos para a primeira etapa.",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`${apiBasePath}/${stageId}`, { method: "DELETE" });
        onUpdated();
      },
    });
  };

  const addStage = async () => {
    if (!newStage.name.trim()) return;
    await authFetch(apiBasePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newStage),
    });
    setNewStage({ name: "", color: "#E5E7EB" });
    onUpdated();
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/40 w-full max-w-3xl overflow-hidden border border-transparent dark:border-gray-800">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/50">
            <div>
              <p className="text-xs uppercase text-gray-400 dark:text-gray-500 font-semibold">Etapas do Funil</p>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Organize o pipeline</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl font-light transition-colors">
              ×
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Add Stage Section */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Adicionar nova etapa</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={newStage.name}
                  onChange={(e) => setNewStage((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Nome da etapa"
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                />
                <input
                  type="color"
                  value={newStage.color}
                  onChange={(e) => setNewStage((p) => ({ ...p, color: e.target.value }))}
                  className="w-12 h-9 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer"
                />
                <button
                  onClick={addStage}
                  className="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                >
                  <Plus size={16} /> Adicionar
                </button>
              </div>
            </div>

            {/* Sortable Stages */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={localStages.map((s) => s.id)} strategy={rectSortingStrategy}>
                <div className="space-y-2">
                  {localStages.map((stage) => (
                    <SortableItem key={stage.id} stage={stage} onUpdate={updateStage} onDelete={deleteStage} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Final Stages */}
            <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800/30">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Etapas finais (fixas)</p>
              <div className="flex flex-wrap gap-2">
                {finals.map((stage) => (
                  <span
                    key={stage.id}
                    className="px-3 py-2 rounded-lg text-sm font-semibold border"
                    style={{ backgroundColor: stage.color, borderColor: stage.color }}
                  >
                    {stage.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}

type SortableItemProps = { 
  stage: PipelineStage; 
  onUpdate: (id: string, patch: Partial<PipelineStage>) => void; 
  onDelete: (id: string) => void;
};

const SortableItem: React.FC<SortableItemProps> = ({ stage, onUpdate, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm dark:shadow-black/20",
        isDragging && "shadow-lg dark:shadow-black/40 ring-2 ring-indigo-500/50 dark:ring-indigo-400/50"
      )}
    >
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
      <input
        value={stage.name}
        onChange={(e) => onUpdate(stage.id, { name: e.target.value })}
        className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
      />
      <input
        type="color"
        value={stage.color}
        onChange={(e) => onUpdate(stage.id, { color: e.target.value })}
        className="w-10 h-9 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer"
      />
      <button
        onClick={() => onDelete(stage.id)}
        className="text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors"
        title="Remover"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};
