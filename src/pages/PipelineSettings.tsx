// src/pages/PipelineSettings.tsx
import React, { useState, useEffect } from 'react'
import { authFetch } from '../utils/authFetch'
import { 
  Plus, 
  GripVertical, 
  Pencil, 
  Trash2, 
  Check, 
  X,
  AlertCircle,
  AlertTriangle
} from 'lucide-react'

interface Stage {
  id: string
  name: string
  position: number
  is_final: boolean
  is_won: boolean
}

// Modal de Confirmação
function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm, 
  onCancel,
  variant = 'danger'
}: {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  variant?: 'danger' | 'warning'
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl dark:shadow-2xl dark:shadow-black/30 max-w-md w-full mx-4 p-6 border border-transparent dark:border-gray-800">
        <div className="flex items-start gap-4">
          <div className={`p-2 rounded-full ${variant === 'danger' ? 'bg-red-100 dark:bg-red-500/20' : 'bg-amber-100 dark:bg-amber-500/20'}`}>
            <AlertTriangle className={`w-6 h-6 ${variant === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              variant === 'danger' 
                ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600' 
                : 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

const MAX_STAGES = 10

export default function PipelineSettings() {
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newStageName, setNewStageName] = useState('')
  const [error, setError] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; stage: Stage | null }>({
    isOpen: false,
    stage: null
  })

  useEffect(() => {
    fetchStages()
  }, [])

  async function fetchStages() {
    try {
      const res = await authFetch('/api/pipeline/stages')
      if (!res.ok) throw new Error('Erro ao carregar')
      const data = await res.json()
      setStages(data)
    } catch (err) {
      console.error('Erro ao carregar estágios:', err)
      setError('Erro ao carregar estágios')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddStage() {
    if (!newStageName.trim()) {
      setError('Digite um nome para o estágio')
      return
    }

    const regularStages = stages.filter(s => !s.is_final)
    if (regularStages.length >= MAX_STAGES) {
      setError(`Limite máximo de ${MAX_STAGES} estágios atingido`)
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await authFetch('/api/pipeline/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newStageName.trim() })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Erro ao criar')
      }

      await fetchStages()
      setNewStageName('')
    } catch (err: any) {
      console.error('Erro ao criar estágio:', err)
      setError(err.message || 'Erro ao criar estágio')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateStage(id: string) {
    if (!editName.trim()) {
      setError('O nome não pode estar vazio')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await authFetch(`/api/pipeline/stages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() })
      })

      if (!res.ok) throw new Error('Erro ao atualizar')

      await fetchStages()
      setEditingId(null)
    } catch (err: any) {
      console.error('Erro ao atualizar estágio:', err)
      setError('Erro ao atualizar estágio')
    } finally {
      setSaving(false)
    }
  }

  function openDeleteModal(stage: Stage) {
    if (stage.is_final) {
      setError('Não é possível excluir estágios finais')
      return
    }

    const regularStages = stages.filter(s => !s.is_final)
    if (regularStages.length <= 1) {
      setError('É necessário ter pelo menos 1 estágio')
      return
    }

    setDeleteModal({ isOpen: true, stage })
  }

  async function handleConfirmDelete() {
    const stage = deleteModal.stage
    if (!stage) return

    setDeleteModal({ isOpen: false, stage: null })
    setSaving(true)
    setError('')

    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}`, {
        method: 'DELETE'
      })

      if (!res.ok) throw new Error('Erro ao excluir')

      await fetchStages()
    } catch (err) {
      console.error('Erro ao excluir estágio:', err)
      setError('Erro ao excluir estágio')
    } finally {
      setSaving(false)
    }
  }

  // Drag and Drop
  function handleDragStart(index: number) {
    setDraggedIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newStages = [...stages]
    const draggedItem = newStages[draggedIndex]
    newStages.splice(draggedIndex, 1)
    newStages.splice(index, 0, draggedItem)

    setStages(newStages)
    setDraggedIndex(index)
  }

  async function handleDragEnd() {
    if (draggedIndex === null) return

    setSaving(true)
    try {
      const stageIds = stages.filter(s => !s.is_final).map(s => s.id)
      
      const res = await authFetch('/api/pipeline/stages/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageIds })
      })

      if (!res.ok) throw new Error('Erro ao reordenar')
      
      await fetchStages()
    } catch (err) {
      console.error('Erro ao reordenar:', err)
      fetchStages()
    } finally {
      setDraggedIndex(null)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
      </div>
    )
  }

  const regularStages = stages.filter(s => !s.is_final)
  const finalStages = stages.filter(s => s.is_final)

  return (
    <div className="max-w-2xl mx-auto">
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Excluir estágio"
        message={`Tem certeza que deseja excluir o estágio "${deleteModal.stage?.name}"? Os deals neste estágio serão movidos para o primeiro estágio disponível.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, stage: null })}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Configurar Funil</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Personalize os estágios do seu pipeline de vendas
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm dark:shadow-lg dark:shadow-black/10 border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {regularStages.length} de {MAX_STAGES} estágios
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Arraste para reordenar</span>
          </div>
        </div>

        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {regularStages.map((stage, index) => (
            <li
              key={stage.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`p-4 flex items-center gap-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                draggedIndex === index ? 'opacity-50' : ''
              }`}
            >
              <div className="cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <GripVertical className="w-5 h-5" />
              </div>

              {editingId === stage.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdateStage(stage.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <button
                    onClick={() => handleUpdateStage(stage.id)}
                    disabled={saving}
                    className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-lg transition-colors"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 font-medium text-gray-900 dark:text-white">{stage.name}</span>
                  <button
                    onClick={() => {
                      setEditingId(stage.id)
                      setEditName(stage.name)
                    }}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openDeleteModal(stage)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        {/* Estágios finais com cores fixas */}
        {finalStages.length > 0 && (
          <div className="border-t-2 border-gray-300 dark:border-gray-700">
            <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Estágios Finais (não editáveis)
            </div>
            {finalStages.map(stage => (
              <div key={stage.id} className="p-4 flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50">
                <div className="w-5" />
                <div
                  className={`w-3 h-3 rounded-full ${
                    stage.is_won ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="flex-1 font-medium text-gray-600 dark:text-gray-300">{stage.name}</span>
                <span className={`px-2 py-0.5 text-xs rounded ${
                  stage.is_won 
                    ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' 
                    : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
                }`}>
                  {stage.is_won ? 'Ganho' : 'Perdido'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Adicionar novo estágio - SEM color picker */}
        {regularStages.length < MAX_STAGES && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Nome do novo estágio..."
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-indigo-500 dark:focus:border-indigo-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddStage()
                }}
              />
              <button
                onClick={handleAddStage}
                disabled={saving || !newStageName.trim()}
                className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Adicionar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
        <p className="text-sm text-amber-800 dark:text-amber-300">
          <strong>💡 Dica:</strong> Os estágios finais (Fechado/Perdido) são do sistema e não podem ser removidos.
        </p>
      </div>
    </div>
  )
}
