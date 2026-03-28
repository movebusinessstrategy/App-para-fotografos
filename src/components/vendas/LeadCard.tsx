import React, { FC } from "react";
import { Edit2, Instagram, MessageCircle, Phone } from "lucide-react";
import { Lead } from "../../types/vendas";

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
  selected?: boolean;
  onEdit?: () => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);

const timeAgo = (date: Date) => {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `há ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
};

export const LeadCard: FC<LeadCardProps> = ({ lead, onClick, selected, onEdit }) => {
  const isWhatsapp = lead.channel === "whatsapp";
  const leftBorder = isWhatsapp ? "border-green-500" : "border-pink-500";

  return (
    <button
      onClick={onClick}
      className={`group relative w-full rounded-lg border-l-4 ${leftBorder} bg-white p-4 text-left shadow-sm transition hover:shadow-md hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 ${
        selected ? "ring-2 ring-blue-500/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {lead.name}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            {isWhatsapp ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                <Phone size={12} />
                WhatsApp
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                <Instagram size={12} />
                Instagram
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            {lead.serviceType}
          </p>
          {onEdit && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-100 dark:hover:bg-gray-700 transition"
              title="Editar lead"
            >
              <Edit2 size={12} />
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm font-bold text-gray-900 dark:text-gray-100">
        {formatCurrency(lead.estimatedValue)}
      </p>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{timeAgo(lead.updatedAt)}</span>
        {lead.unreadCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
            <MessageCircle size={12} />
            {lead.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
};
