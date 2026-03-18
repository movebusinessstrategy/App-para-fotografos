import React, { useState, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, GripVertical, Trash2, Plus, Check, Pencil } from "lucide-react";
import { PipelineStage } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../ui/ConfirmModal";

interface StageCustomizerProps {
  open: boolean;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdated: (options?: { silent?: boolean }) => void | Promise<void>;
}

export function StageCustomizer({
  open,
  stages,
  onClose,
  onUpdated,
}: StageCustomizerProps) {
  const [localStages, setLocalStages] = useState<PipelineStage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggingStage, setDraggingStage] = useState<PipelineStage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    stageId: string | null;
    stageName: string;
  }>({ open: false, stageId: null, stageName: "" });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    setLocalStages(stages);
  }, [stages]);

  const regularStages = localStages
    .filter((s) => !s.is_final)
    .sort((a, b) => a.position - b.position);
  const finalStages = localStages.filter((s) => s.is_final);

  const startEditing = (stage: PipelineStage) => {
    setEditingId(stage.id);
    setEditingName(stage.name);
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    setSaving(true);
    try {
      await authFetch(`/api/pipeline/stages/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName }),
      });
      // Atualiza localmente sem fechar
      setLocalStages((prev) =>
        prev.map((s) =>
          s.id === editingId ? { ...s, name: editingName } : s
        )
      );
      setEditingId(null);
      setEditingName("");
      onUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const addStage = async () => {
    if (!newStageName.trim()) return;
    setSaving(true);
    try {
      const res = await authFetch("/api/pipeline/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newStageName,
          position: regularStages.length,
        }),
      });
      const newStage = await res.json();
      setLocalStages((prev) => [...prev, newStage]);
      setNewStageName("");
      onUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteStage = (stage: PipelineStage) => {
    setDeleteConfirm({ open: true, stageId: stage.id, stageName: stage.name });
  };

  const confirmDeleteStage = async () => {
    if (!deleteConfirm.stageId) return;
    setSaving(true);
    try {
      await authFetch(`/api/pipeline/stages/${deleteConfirm.stageId}`, {
        method: "DELETE",
      });
      setLocalStages((prev) =>
        prev.filter((s) => s.id !== deleteConfirm.stageId)
      );
      onUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
      setDeleteConfirm({ open: false, stageId: null, stageName: "" });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const stage = regularStages.find((s) => s.id === event.active.id);
    setDraggingStage(stage || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingStage(null);
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = regularStages.findIndex((s) => s.id === active.id);
    const newIndex = regularStages.findIndex((s) => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove<PipelineStage>(regularStages, oldIndex, newIndex);

    // Atualiza localmente primeiro
    setLocalStages((prev) => {
      const finals = prev.filter((s) => s.is_final);
      const reordered = newOrder.map((s, i) => ({ ...s, position: i }));
      return [...reordered, ...finals];
    });

    // Persiste no backend
    setSaving(true);
    try {
      await Promise.all(
        newOrder.map((stage: PipelineStage, i) =>
          authFetch(`/api/pipeline/stages/${stage.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position: i }),
          })
        )
      );
      onUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Personalizar Funil</h2>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* Etapas regulares com drag and drop */}
            <div className="space-y-2 mb-6">
              <label className="text-xs font-medium text-gray-500 uppercase">
                Etapas do Funil
              </label>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={regularStages.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {regularStages.map((stage) => (
                      <React.Fragment key={stage.id}>
                        <SortableStageItem
                          stage={stage}
                          isEditing={editingId === stage.id}
                          editingName={editingName}
                          saving={saving}
                          onStartEdit={() => startEditing(stage)}
                          onEditingNameChange={setEditingName}
                          onSaveEdit={saveEdit}
                          onCancelEdit={cancelEdit}
                          onDelete={() => requestDeleteStage(stage)}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </SortableContext>

                <DragOverlay>
                  {draggingStage && (
                    <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-300 shadow-lg">
                      <GripVertical size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-900">{draggingStage.name}</span>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>

              {/* Adicionar etapa */}
              <div className="flex gap-2 mt-4 pt-2">
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStage()}
                  placeholder="Nome da nova etapa..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
                />
                <button
                  onClick={addStage}
                  disabled={!newStageName.trim() || saving}
                  className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1"
                >
                  <Plus size={16} />
                  Adicionar
                </button>
              </div>
            </div>

            {/* Etapas finais */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">
                Etapas Finais (não editáveis)
              </label>
              {finalStages.map((stage) => (
                <div
                  key={stage.id}
                  className="flex items-center gap-3 p-3 bg-gray-100 rounded-lg"
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      stage.is_won ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm text-gray-600">{stage.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              Concluído
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteConfirm.open}
        title="Excluir etapa"
        message={`Excluir "${deleteConfirm.stageName}"? Os negócios serão movidos para a primeira etapa.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={confirmDeleteStage}
        onCancel={() =>
          setDeleteConfirm({ open: false, stageId: null, stageName: "" })
        }
      />
    </>
  );
}

interface SortableStageItemProps {
  stage: PipelineStage;
  isEditing: boolean;
  editingName: string;
  saving: boolean;
  onStartEdit: () => void;
  onEditingNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function SortableStageItem({
  stage,
  isEditing,
  editingName,
  saving,
  onStartEdit,
  onEditingNameChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: SortableStageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-3 bg-gray-50 rounded-lg group ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      {/* Handle para arrastar */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
      >
        <GripVertical size={16} />
      </button>

      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            autoFocus
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm outline-none focus:border-gray-400"
          />
          <button
            onClick={onSaveEdit}
            disabled={saving}
            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
          >
            <Check size={16} />
          </button>
          <button
            onClick={onCancelEdit}
            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-900">{stage.name}</span>
          <button
            onClick={onStartEdit}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Editar nome"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            disabled={saving}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Excluir etapa"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}
