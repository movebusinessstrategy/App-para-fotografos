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
      className={`bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      <div className="font-medium text-gray-900 text-sm truncate">
        {deal.title}
      </div>
      <div className="text-xs text-gray-500 mt-1 truncate">
        {client?.name || deal.client_name || "Sem cliente"}
      </div>
      <div className="text-sm font-semibold text-gray-900 mt-2">
        R$ {(deal.value || 0).toLocaleString("pt-BR")}
      </div>
    </div>
  );
}
