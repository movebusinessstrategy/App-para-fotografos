import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Deal, Client } from "../../types";

interface DealCardProps {
  deal: Deal;
  client?: Client;
  onClick: () => void;
}

export function DealCard({ deal, client, onClick }: DealCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id.toString() });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm dark:hover:shadow-black/20 transition-all ${
        isDragging ? "opacity-50 shadow-lg dark:shadow-black/40" : ""
      }`}
    >
      <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
        {deal.title}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
        {client?.name || deal.client_name || "Sem cliente"}
      </div>
      <div className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
        R$ {(deal.value || 0).toLocaleString("pt-BR")}
      </div>
    </div>
  );
}
