import React from "react";
import { useNavigate } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageCircle, Package, Layers, Briefcase } from "lucide-react";
import { Deal, Client } from "../../types";

interface DealCardProps {
  deal: Deal;
  client?: Client;
  onClick: () => void;
}

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const t = tier.toLowerCase();
  if (t === 'gold' || t === 'ouro') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">Gold</span>;
  }
  if (t === 'silver' || t === 'prata') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Silver</span>;
  }
  if (t === 'bronze') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300">Bronze</span>;
  }
  return null;
}

function getStaleness(enteredAt?: string | null): 'urgent' | 'warning' | null {
  if (!enteredAt) return null;
  const hours = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000;
  if (hours >= 24) return 'urgent';
  if (hours >= 12) return 'warning';
  return null;
}

export function DealCard({ deal, client, onClick }: DealCardProps) {
  const navigate = useNavigate();
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

  const staleness = getStaleness(deal.current_stage_entered_at);
  const tier = client?.tier || client?.status;

  const borderClass =
    staleness === 'urgent'
      ? 'border-red-500 dark:border-red-500 animate-pulse-red'
      : staleness === 'warning'
      ? 'border-amber-400 dark:border-amber-400 animate-pulse-amber'
      : 'border-gray-200 dark:border-gray-700';

  const bgClass =
    staleness === 'urgent'
      ? 'bg-red-50/60 dark:bg-red-900/10'
      : staleness === 'warning'
      ? 'bg-amber-50/60 dark:bg-amber-900/10'
      : 'bg-white dark:bg-gray-800';

  const phone = deal.contact_phone || client?.phone;

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    const clean = phone?.replace(/\D/g, '') || '';
    if (clean) navigate(`/vendas?tab=inbox&phone=${clean}`);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`${bgClass} border ${borderClass} rounded-lg p-3 cursor-pointer hover:shadow-sm dark:hover:shadow-black/20 transition-all ${
        isDragging ? "opacity-50 shadow-lg dark:shadow-black/40" : ""
      }`}
    >
      <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
        {deal.title}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
          {client?.name || deal.client_name || "Sem cliente"}
        </span>
        <TierBadge tier={tier} />
      </div>
      {deal.items && deal.items.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {deal.items.slice(0, 2).map(item => (
            <div key={item.id} className="flex items-center gap-1">
              {item.catalog_type === 'combo' && <Layers size={10} className="text-amber-500 flex-shrink-0" />}
              {item.catalog_type === 'produto' && <Package size={10} className="text-blue-500 flex-shrink-0" />}
              {item.catalog_type === 'servico' && <Briefcase size={10} className="text-purple-500 flex-shrink-0" />}
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{item.catalog_name}</span>
            </div>
          ))}
          {deal.items.length > 2 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">+{deal.items.length - 2} mais</span>
          )}
        </div>
      ) : deal.catalog_name ? (
        <div className="flex items-center gap-1 mt-1.5">
          {deal.catalog_type === 'combo' && <Layers size={11} className="text-amber-500 flex-shrink-0" />}
          {deal.catalog_type === 'produto' && <Package size={11} className="text-blue-500 flex-shrink-0" />}
          {deal.catalog_type === 'servico' && <Briefcase size={11} className="text-purple-500 flex-shrink-0" />}
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{deal.catalog_name}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          R$ {(deal.value || 0).toLocaleString("pt-BR")}
        </span>
        <div className="flex items-center gap-1.5">
          {staleness === 'urgent' && (
            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">+24h</span>
          )}
          {staleness === 'warning' && (
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">+12h</span>
          )}
          {phone && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleWhatsApp}
              title="Abrir conversa no WhatsApp"
              className="p-1 rounded-md text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
            >
              <MessageCircle size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
