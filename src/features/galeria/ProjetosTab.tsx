import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { useApi, liveRefresh } from "../../utils/useApi";
import { Gallery, GalleryStatus } from "./types";
import { GALLERY_COLUMNS } from "./utils";
import { GaleriaCard, GaleriaCardGhost } from "./GaleriaCard";
import { NovaGaleriaModal } from "./NovaGaleriaModal";
import { ToastKind } from "./Toast";

interface ProjetosTabProps {
  onNotify: (kind: ToastKind, message: string) => void;
}

export default function ProjetosTab({ onNotify }: ProjetosTabProps) {
  // Única lista com auto-refresh de 5s (tempo real do kanban).
  const { data, isLoading, mutate } = useApi<{ galleries: Gallery[] }>("/api/galleries", liveRefresh);
  const galleries = useMemo(() => data?.galleries ?? [], [data]);

  const navigate = useNavigate();
  const [localGalleries, setLocalGalleries] = useState<Gallery[]>(galleries);
  const [activeGallery, setActiveGallery] = useState<Gallery | null>(null);
  const [novaOpen, setNovaOpen] = useState(false);
  const openGallery = (id: string) => navigate(`/galeria/${id}`);
  // Mesmo guard do FunilTab: poll de 5s não pode "voltar" o card no meio
  // de um arraste nem nos ~2s seguintes a um movimento local.
  const isDraggingRef = useRef(false);
  const lastLocalMoveRef = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (isDraggingRef.current) return;
    if (Date.now() - lastLocalMoveRef.current < 2000) return;
    setLocalGalleries(galleries);
  }, [galleries]);

  const byStatus = useMemo(() => {
    const map: Record<GalleryStatus, Gallery[]> = { draft: [], sent: [], selected: [], delivered: [] };
    localGalleries.forEach((g) => {
      (map[g.status] ?? map.draft).push(g);
    });
    return map;
  }, [localGalleries]);

  const handleDragStart = (event: DragStartEvent) => {
    isDraggingRef.current = true;
    setActiveGallery(localGalleries.find((g) => g.id === String(event.active.id)) || null);
  };

  const resolveTargetStatus = (overId: string): GalleryStatus | null => {
    if (GALLERY_COLUMNS.some((c) => c.id === overId)) return overId as GalleryStatus;
    const target = localGalleries.find((g) => g.id === overId);
    return target ? target.status : null;
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    isDraggingRef.current = false;
    setActiveGallery(null);
    const { active, over } = event;
    if (!over) return;

    const galleryId = String(active.id);
    const newStatus = resolveTargetStatus(String(over.id));
    const gallery = localGalleries.find((g) => g.id === galleryId);
    if (!gallery || !newStatus || gallery.status === newStatus) return;

    const previous = localGalleries.map((g) => ({ ...g }));
    lastLocalMoveRef.current = Date.now();
    setLocalGalleries((prev) =>
      prev.map((g) => (g.id === galleryId ? { ...g, status: newStatus } : g)),
    );

    try {
      const res = await authFetch(`/api/galleries/${galleryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      setLocalGalleries(previous);
      onNotify("error", "Não foi possível mover a galeria.");
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setNovaOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Plus size={14} />
          Nova galeria
        </button>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none">
          <div className="flex gap-2 sm:gap-4 px-1" style={{ minWidth: "max-content" }}>
            {GALLERY_COLUMNS.map((column) => (
              <StatusColumn
                key={column.id}
                column={column}
                galleries={byStatus[column.id]}
                onCardClick={openGallery}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeGallery && <GaleriaCardGhost gallery={activeGallery} />}
        </DragOverlay>
      </DndContext>

      {novaOpen && (
        <NovaGaleriaModal
          onClose={() => setNovaOpen(false)}
          onCreated={(gallery) => {
            setNovaOpen(false);
            mutate();
            openGallery(gallery.id);
            onNotify("success", "Galeria criada! Agora envie as fotos.");
          }}
          onNotify={onNotify}
        />
      )}
    </>
  );
}

// ─── Coluna do kanban ─────────────────────────────────────────────────────────

interface StatusColumnProps {
  column: { id: GalleryStatus; label: string };
  galleries: Gallery[];
  onCardClick: (id: string) => void;
  // React.Key tipado pro typecheck aceitar <StatusColumn key={} ...> (padrão do projeto).
  key?: React.Key | null;
}

function StatusColumn({ column, galleries, onCardClick }: StatusColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 snap-center w-[85vw] sm:w-[280px] max-w-[320px] sm:min-w-[280px] min-h-[55vh] rounded-lg border transition-colors ${
        isOver
          ? "border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-800/80"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      }`}
    >
      <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
            {column.label}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {galleries.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={galleries.map((g) => g.id)}>
          {galleries.map((gallery) => (
            <GaleriaCard key={gallery.id} gallery={gallery} onClick={() => onCardClick(gallery.id)} />
          ))}
        </SortableContext>

        {galleries.length === 0 && (
          <div className="flex items-center justify-center h-20 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <span className="text-xs text-gray-400 dark:text-gray-500">Arraste galerias aqui</span>
          </div>
        )}
      </div>
    </div>
  );
}
