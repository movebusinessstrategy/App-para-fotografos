import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "../../../utils/cn";
import { SpreadView } from "./SpreadView";
import type { AlbumAsset, AlbumSpread } from "../types";

interface TiraProps {
  spreads: AlbumSpread[];
  assets: AlbumAsset[];
  size: string;
  currentIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onReorder: (next: AlbumSpread[]) => void;
}

function MiniLamina({ spread, assets, size, index, active, onSelect, onDelete }: {
  spread: AlbumSpread;
  assets: AlbumAsset[];
  size: string;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: spread.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group relative flex-shrink-0", isDragging && "opacity-50 z-10")}
    >
      <button
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={cn(
          "block w-32 rounded-lg overflow-hidden ring-2 transition-colors touch-none",
          active ? "ring-violet-500" : "ring-transparent hover:ring-gray-300 dark:hover:ring-gray-600",
        )}
        title={`Lâmina ${index + 1}`}
      >
        <SpreadView spread={spread} assets={assets} size={size} gap={2} className="!shadow-none" />
      </button>
      <span className="absolute top-0.5 left-0.5 rounded bg-black/55 text-white text-[9px] px-1 leading-tight">
        {index + 1}
      </span>
      <button
        onClick={onDelete}
        className="absolute top-0.5 right-0.5 rounded-full bg-black/55 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remover lâmina"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

// Tira inferior com todas as lâminas: selecionar, adicionar, reordenar, remover.
export function Tira({
  spreads, assets, size, currentIndex, onSelect, onAdd, onDelete, onReorder,
}: TiraProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = spreads.findIndex((s) => s.id === active.id);
    const to = spreads.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(spreads, from, to).map((s, i) => ({ ...s, position: i })));
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={spreads.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {spreads.map((s, i) => (
              <MiniLamina
                key={s.id}
                spread={s}
                assets={assets}
                size={size}
                index={i}
                active={i === currentIndex}
                onSelect={() => onSelect(i)}
                onDelete={() => onDelete(i)}
              />
            ))}
            <button
              onClick={onAdd}
              className="flex-shrink-0 w-32 aspect-[2/1] rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors"
              title="Adicionar lâmina"
            >
              <Plus size={18} />
              <span className="text-[10px]">Lâmina</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
