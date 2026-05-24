import React, { useEffect, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Plus, Trash2, GripVertical, Check, Pencil, Settings, Star } from 'lucide-react';
import { ProductionProcess, ProductionStageV2 } from '../../types';
import { authFetch } from '../../utils/authFetch';
import { ConfirmModal } from '../ui/ConfirmModal';


interface ProductionCustomizerProps {
  open: boolean;
  processes: ProductionProcess[];
  stages: ProductionStageV2[];
  onClose: () => void;
  onUpdated: () => void;
}

export function ProductionCustomizer({ open, processes, stages, onClose, onUpdated }: ProductionCustomizerProps) {
  const [localProcesses, setLocalProcesses] = useState<ProductionProcess[]>([]);
  const [localStages, setLocalStages] = useState<ProductionStageV2[]>([]);
  const [activeProcessId, setActiveProcessId] = useState('');
  const [saving, setSaving] = useState(false);

  // Editing process name
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [editingProcessName, setEditingProcessName] = useState('');
  const [newProcessName, setNewProcessName] = useState('');

  // Color picker
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState('');
  const [originalColor, setOriginalColor] = useState('');
  const [hexInput, setHexInput] = useState('');

  // Editing stage name
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newStageName, setNewStageName] = useState('');

  // Drag
  const [draggingStage, setDraggingStage] = useState<ProductionStageV2 | null>(null);

  // Confirms
  const [confirmDeleteStage, setConfirmDeleteStage] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });
  const [confirmDeleteProcess, setConfirmDeleteProcess] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    setLocalProcesses(processes);
    setLocalStages(stages);
    if (processes.length && !activeProcessId) setActiveProcessId(processes[0].id);
  }, [processes, stages]);

  useEffect(() => {
    if (processes.length && !processes.find(p => p.id === activeProcessId)) {
      setActiveProcessId(processes[0].id);
    }
  }, [processes, activeProcessId]);

  const currentStages = localStages
    .filter(s => s.process_id === activeProcessId)
    .sort((a, b) => a.position - b.position);

  // ── Process actions ────────────────────────────────────────────────────────

  const startEditProcess = (p: ProductionProcess) => {
    setEditingProcessId(p.id);
    setEditingProcessName(p.name);
  };

  const toggleSpecial = async (p: ProductionProcess) => {
    const next = !p.is_special;
    setLocalProcesses(prev => prev.map(x => x.id === p.id ? { ...x, is_special: next } : x));
    try {
      await authFetch(`/api/production/processes/${p.id}/special`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_special: next }),
      });
      onUpdated();
    } catch (_) {
      setLocalProcesses(prev => prev.map(x => x.id === p.id ? { ...x, is_special: !next } : x));
    }
  };

  const openColorPicker = (p: ProductionProcess) => {
    setColorPickerFor(p.id);
    setDraftColor(p.color || '#6366f1');
    setOriginalColor(p.color || '#6366f1');
    setHexInput((p.color || '#6366f1').replace('#', '').toUpperCase());
  };

  const cancelColorPicker = () => {
    if (colorPickerFor) {
      setLocalProcesses(prev => prev.map(p => p.id === colorPickerFor ? { ...p, color: originalColor } : p));
    }
    setColorPickerFor(null);
  };

  // Update draft + live preview in list
  const handleDraftChange = (color: string) => {
    setDraftColor(color);
    setHexInput(color.replace('#', '').toUpperCase());
    if (colorPickerFor) {
      setLocalProcesses(prev => prev.map(p => p.id === colorPickerFor ? { ...p, color } : p));
    }
  };

  // Commit to API and close
  const saveProcessColor = async () => {
    if (!colorPickerFor || !/^#[0-9a-fA-F]{6}$/i.test(draftColor)) return;
    setSaving(true);
    try {
      await authFetch(`/api/production/processes/${colorPickerFor}/color`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: draftColor }),
      });
      onUpdated();
    } catch (_) {} finally {
      setSaving(false);
      setColorPickerFor(null);
    }
  };

  const saveProcessName = async () => {
    if (!editingProcessId || !editingProcessName.trim()) return;
    setSaving(true);
    try {
      await authFetch(`/api/production/processes/${editingProcessId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingProcessName }),
      });
      setLocalProcesses(prev => prev.map(p => p.id === editingProcessId ? { ...p, name: editingProcessName } : p));
      onUpdated();
    } catch (_) {} finally {
      setSaving(false);
      setEditingProcessId(null);
      setEditingProcessName('');
    }
  };

  const addProcess = async () => {
    if (!newProcessName.trim()) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/production/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProcessName }),
      });
      const created = await res.json() as ProductionProcess;
      setLocalProcesses(prev => [...prev, created]);
      setActiveProcessId(created.id);
      setNewProcessName('');
      onUpdated();
    } catch (_) {} finally { setSaving(false); }
  };

  const deleteProcess = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/production/processes/${confirmDeleteProcess.id}`, { method: 'DELETE' });
      const remaining = localProcesses.filter(p => p.id !== confirmDeleteProcess.id);
      setLocalProcesses(remaining);
      setLocalStages(prev => prev.filter(s => s.process_id !== confirmDeleteProcess.id));
      if (activeProcessId === confirmDeleteProcess.id && remaining.length) setActiveProcessId(remaining[0].id);
      onUpdated();
    } catch (_) {} finally {
      setSaving(false);
      setConfirmDeleteProcess({ open: false, id: '', name: '' });
    }
  };

  // ── Stage actions ──────────────────────────────────────────────────────────

  const startEditStage = (s: ProductionStageV2) => {
    setEditingStageId(s.id);
    setEditingName(s.name);
  };

  const saveStage = async () => {
    if (!editingStageId || !editingName.trim()) return;
    setSaving(true);
    try {
      await authFetch(`/api/production/stages/${editingStageId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName }),
      });
      setLocalStages(prev => prev.map(s => s.id === editingStageId ? { ...s, name: editingName } : s));
      onUpdated();
    } catch (_) {} finally {
      setSaving(false);
      setEditingStageId(null);
      setEditingName('');
    }
  };

  const addStage = async () => {
    if (!newStageName.trim() || !activeProcessId) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/production/stages-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newStageName, process_id: activeProcessId }),
      });
      const created = await res.json() as ProductionStageV2;
      setLocalStages(prev => [...prev, created]);
      setNewStageName('');
      onUpdated();
    } catch (_) {} finally { setSaving(false); }
  };

  const deleteStage = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/production/stages-v2/${confirmDeleteStage.id}`, { method: 'DELETE' });
      setLocalStages(prev => prev.filter(s => s.id !== confirmDeleteStage.id));
      onUpdated();
    } catch (_) {} finally {
      setSaving(false);
      setConfirmDeleteStage({ open: false, id: '', name: '' });
    }
  };

  // ── Drag & drop stages ─────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const stage = currentStages.find(s => s.id === event.active.id);
    setDraggingStage(stage || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingStage(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = currentStages.findIndex(s => s.id === active.id);
    const newIndex = currentStages.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove<ProductionStageV2>(currentStages, oldIndex, newIndex);
    setLocalStages(prev => {
      const others = prev.filter(s => s.process_id !== activeProcessId);
      return [...others, ...reordered.map((s, i) => ({ ...s, position: i }))];
    });
    setSaving(true);
    try {
      await authFetch('/api/production/stages-v2/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageIds: reordered.map(s => s.id) }),
      });
      onUpdated();
    } catch (_) {} finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
        <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-transparent dark:border-gray-800 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Settings size={17} className="text-gold-500" />
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Personalizar Produção</h2>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* ── Processos ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Processos</p>
                <span className="flex items-center gap-1 text-[10px] text-gold-500 dark:text-gold-400">
                  <Star size={10} fill="currentColor" /> = Processo Especial
                </span>
              </div>
              <div className="space-y-1.5">
                {localProcesses.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setActiveProcessId(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                      activeProcessId === p.id
                        ? 'bg-gold-50 dark:bg-gold-900/30 border border-gold-200 dark:border-gold-700'
                        : 'bg-gray-50 dark:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700'
                    }`}
                  >
                    {/* Color swatch - click to open picker */}
                    <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => colorPickerFor === p.id ? cancelColorPicker() : openColorPicker(p)}
                        title="Mudar cor do processo"
                        className="w-4 h-4 rounded-full ring-2 ring-white dark:ring-gray-700 shadow-sm hover:scale-125 transition-transform"
                        style={{ backgroundColor: p.color }}
                      />
                      {colorPickerFor === p.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={cancelColorPicker} />
                          <div className="absolute left-0 top-6 z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden w-56">

                            {/* Header */}
                            <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-black/10" style={{ backgroundColor: draftColor }} />
                              <span className="text-xs font-bold text-gray-700 dark:text-gray-200">Cor do processo</span>
                            </div>

                            {/* Color picker wheel */}
                            <div className="p-3 [&_.react-colorful]:w-full [&_.react-colorful]:rounded-xl [&_.react-colorful__saturation]:rounded-t-xl [&_.react-colorful__last-control]:rounded-b-none [&_.react-colorful__hue]:rounded-none [&_.react-colorful__hue]:h-3 [&_.react-colorful__pointer]:w-4 [&_.react-colorful__pointer]:h-4">
                              <HexColorPicker color={draftColor} onChange={handleDraftChange} />
                            </div>

                            {/* Hex input */}
                            <div className="px-3 pb-3">
                              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700">
                                <div className="w-5 h-5 rounded-md flex-shrink-0 ring-1 ring-black/10" style={{ backgroundColor: draftColor }} />
                                <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">#</span>
                                <input
                                  type="text"
                                  value={hexInput}
                                  onChange={e => {
                                    const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
                                    setHexInput(raw);
                                    if (raw.length === 6) handleDraftChange('#' + raw);
                                  }}
                                  placeholder="F1C665"
                                  className="flex-1 text-xs font-mono bg-transparent text-gray-800 dark:text-gray-200 outline-none uppercase w-0 min-w-0"
                                />
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 px-3 pb-3">
                              <button
                                onClick={cancelColorPicker}
                                className="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={saveProcessColor}
                                disabled={saving}
                                className="flex-1 py-1.5 text-xs font-bold rounded-lg text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                              >
                                {saving ? '...' : 'Salvar'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {editingProcessId === p.id ? (
                      <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editingProcessName}
                          onChange={e => setEditingProcessName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveProcessName(); if (e.key === 'Escape') { setEditingProcessId(null); } }}
                          className="flex-1 px-2 py-0.5 text-sm border border-gold-400 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
                        />
                        <button onClick={saveProcessName} disabled={saving} className="text-emerald-600 hover:text-emerald-700 p-1"><Check size={14} /></button>
                        <button onClick={() => setEditingProcessId(null)} className="text-gray-400 p-1"><X size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm font-medium ${activeProcessId === p.id ? 'text-gold-700 dark:text-gold-300' : 'text-gray-700 dark:text-gray-200'}`}>
                          {p.name}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); toggleSpecial(p); }}
                          title={p.is_special ? 'Remover destaque especial' : 'Marcar como Processo Especial (Páscoa, Natal, etc.)'}
                          className={`p-1 transition-all ${p.is_special ? 'text-gold-500' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gold-500'}`}
                        >
                          <Star size={13} fill={p.is_special ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); startEditProcess(p); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gold-500 transition-all"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDeleteProcess({ open: true, id: p.id, name: p.name }); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                          disabled={localProcesses.length <= 1}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add process */}
              <div className="flex gap-2 mt-2">
                <input
                  value={newProcessName}
                  onChange={e => setNewProcessName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addProcess()}
                  placeholder="Nome do novo processo..."
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-gold-400"
                />
                <button
                  onClick={addProcess}
                  disabled={!newProcessName.trim() || saving}
                  className="px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1 transition-colors"
                >
                  <Plus size={15} /> Adicionar
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100 dark:border-gray-800" />

            {/* ── Etapas do processo ativo ── */}
            {activeProcessId && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                  Etapas - {localProcesses.find(p => p.id === activeProcessId)?.name}
                </p>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                  <SortableContext items={currentStages.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5">
                      {currentStages.map(stage => (
                        <React.Fragment key={stage.id}>
                          <SortableStageRow
                            stage={stage}
                            isEditing={editingStageId === stage.id}
                            editingName={editingName}
                            saving={saving}
                            onStartEdit={() => startEditStage(stage)}
                            onEditingNameChange={setEditingName}
                            onSaveEdit={saveStage}
                            onCancelEdit={() => { setEditingStageId(null); setEditingName(''); }}
                            onDelete={() => setConfirmDeleteStage({ open: true, id: stage.id, name: stage.name })}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                  </SortableContext>

                  <DragOverlay>
                    {draggingStage && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 shadow-lg text-sm text-gray-900 dark:text-white">
                        <GripVertical size={14} className="text-gray-400" />
                        {draggingStage.name}
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>

                {currentStages.length === 0 && (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">Nenhuma etapa. Adicione uma abaixo.</p>
                )}

                {/* Add stage */}
                <div className="flex gap-2 mt-2">
                  <input
                    value={newStageName}
                    onChange={e => setNewStageName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addStage()}
                    placeholder="Nome da nova etapa..."
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-gold-400"
                  />
                  <button
                    onClick={addStage}
                    disabled={!newStageName.trim() || saving}
                    className="px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1 transition-colors"
                  >
                    <Plus size={15} /> Adicionar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800">
            <button onClick={onClose} className="w-full py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors">
              Concluído
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteStage.open}
        title="Excluir etapa"
        message={`Excluir "${confirmDeleteStage.name}"? Os trabalhos serão desvinculados desta etapa.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={deleteStage}
        onCancel={() => setConfirmDeleteStage({ open: false, id: '', name: '' })}
      />
      <ConfirmModal
        open={confirmDeleteProcess.open}
        title="Excluir processo"
        message={`Excluir "${confirmDeleteProcess.name}" e todas as suas etapas? Os trabalhos vinculados serão desvinculados.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={deleteProcess}
        onCancel={() => setConfirmDeleteProcess({ open: false, id: '', name: '' })}
      />
    </>
  );
}

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableStageRow({
  stage, isEditing, editingName, saving,
  onStartEdit, onEditingNameChange, onSaveEdit, onCancelEdit, onDelete,
}: {
  stage: ProductionStageV2;
  isEditing: boolean;
  editingName: string;
  saving: boolean;
  onStartEdit: () => void;
  onEditingNameChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg group ${isDragging ? 'opacity-50 shadow-lg' : ''}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none">
        <GripVertical size={14} />
      </button>

      {isEditing ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            autoFocus
            value={editingName}
            onChange={e => onEditingNameChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }}
            className="flex-1 px-2 py-0.5 text-sm border border-gold-400 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
          />
          <button onClick={onSaveEdit} disabled={saving} className="text-emerald-600 p-1"><Check size={14} /></button>
          <button onClick={onCancelEdit} className="text-gray-400 p-1"><X size={14} /></button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{stage.name}</span>
          <button onClick={onStartEdit} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gold-500 transition-all">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} disabled={saving} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all">
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}
