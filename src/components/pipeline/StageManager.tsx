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
}

export function StageManager({ open, stages, onClose, onUpdated }: StageManagerProps) {
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
    await authFetch("/api/pipeline/stages/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageIds: reordered.map((s) => s.id) }),
    });
    onUpdated();
  };

  const updateStage = async (stageId: string, patch: Partial<PipelineStage>) => {
    setLocalStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
    await authFetch(`/api/pipeline/stages/${stageId}`, {
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
        await authFetch(`/api/pipeline/stages/${stageId}`, { method: "DELETE" });
        onUpdated();
      },
    });
  };

  const addStage = async () => {
    if (!newStage.name.trim()) return;
    await authFetch("/api/pipeline/stages", {
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/60">
            <div>
              <p className="text-xs uppercase text-gray-400 font-semibold">Etapas do Funil</p>
              <h3 className="text-lg font-bold text-gray-800">Organize o pipeline</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
          </div>

          <div className="p-6 space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-2">Adicionar nova etapa</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={newStage.name}
                  onChange={(e) => setNewStage((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Nome da etapa"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
                <input
                  type="color"
                  value={newStage.color}
                  onChange={(e) => setNewStage((p) => ({ ...p, color: e.target.value }))}
                  className="w-12 h-9 rounded border border-gray-200"
                />
                <button
                  onClick={addStage}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                >
                  <Plus size={16} /> Adicionar
                </button>
              </div>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={localStages.map((s) => s.id)} strategy={rectSortingStrategy}>
                <div className="space-y-2">
                  {localStages.map((stage) => (
                    <SortableItem key={stage.id} stage={stage} onUpdate={updateStage} onDelete={deleteStage} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="border border-gray-100 rounded-xl p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Etapas finais (fixas)</p>
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

type SortableItemProps = { stage: PipelineStage; onUpdate: (id: string, patch: Partial<PipelineStage>) => void; onDelete: (id: string) => void };

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
        "flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm",
        isDragging && "shadow-lg"
      )}
    >
      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
      <input
        value={stage.name}
        onChange={(e) => onUpdate(stage.id, { name: e.target.value })}
        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
      />
      <input
        type="color"
        value={stage.color}
        onChange={(e) => onUpdate(stage.id, { color: e.target.value })}
        className="w-10 h-9 rounded border border-gray-200"
      />
      <button
        onClick={() => onDelete(stage.id)}
        className="text-rose-500 hover:text-rose-600"
        title="Remover"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};
