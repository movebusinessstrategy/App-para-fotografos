import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Images } from "lucide-react";

import { Gallery } from "./types";
import { gallerySummary } from "./utils";

interface GaleriaCardProps {
  gallery: Gallery;
  onClick: () => void;
  // React.Key tipado pro typecheck aceitar <GaleriaCard key={} ...> (padrão do projeto).
  key?: React.Key | null;
}

function CoverThumb({ gallery }: { gallery: Gallery }) {
  if (gallery.cover_thumb_url) {
    return (
      <img
        src={gallery.cover_thumb_url}
        alt=""
        className="w-11 h-11 rounded-lg object-cover flex-shrink-0 ring-1 ring-gray-200 dark:ring-gray-700"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-lg flex-shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400">
      <Images size={18} />
    </div>
  );
}

export function GaleriaCard({ gallery, onClick }: GaleriaCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: gallery.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative bg-white dark:bg-gray-800/90 ring-1 ring-gray-200 dark:ring-gray-700/80 rounded-xl p-3 cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-0.5 dark:shadow-black/20 transition-all ${
        isDragging ? "opacity-50 shadow-xl rotate-1" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <CoverThumb gallery={gallery} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
            {gallery.title}
          </div>
          {gallery.client_name && (
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {gallery.client_name}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {gallery.category && (
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300">
                {gallery.category}
              </span>
            )}
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {gallerySummary(gallery)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Card fantasma exibido no DragOverlay enquanto arrasta.
export function GaleriaCardGhost({ gallery }: { gallery: Gallery }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-3 shadow-lg w-[260px] opacity-95">
      <div className="font-medium text-gray-900 dark:text-white text-sm">{gallery.title}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{gallerySummary(gallery)}</div>
    </div>
  );
}
