import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Package, Layers, Briefcase, AlertCircle } from "lucide-react";
import { Deal, Client, PipelineLabel, TeamMember } from "../../types";
import { useDealAvatar, getInitials, getAvatarBg } from "./dealAvatar";
import { SellerAvatar } from "./SellerPicker";

interface DealCardProps {
  deal: Deal;
  client?: Client;
  onClick: () => void;
  labelMap?: Map<string, PipelineLabel>;
  seller?: TeamMember;
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

function formatPhone(raw?: string | null): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return d;
}

const ITEM_ICON = {
  combo: { Icon: Layers, color: 'text-amber-500' },
  produto: { Icon: Package, color: 'text-blue-500' },
  servico: { Icon: Briefcase, color: 'text-purple-500' },
} as const;

export function DealCard({ deal, client, onClick, labelMap, seller }: DealCardProps) {
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

  const phone = client?.phone || deal.contact_phone;
  const contactName = client?.name || deal.contact_name || deal.client_name || deal.title || 'Sem nome';
  const avatarUrl = useDealAvatar(phone);
  const initials = getInitials(contactName);
  const avatarBg = getAvatarBg(contactName);

  const staleness = getStaleness(deal.current_stage_entered_at);
  const tier = client?.tier || client?.status;

  const ringClass =
    staleness === 'urgent'
      ? 'ring-2 ring-red-400/70 dark:ring-red-500/60'
      : staleness === 'warning'
      ? 'ring-2 ring-amber-400/60 dark:ring-amber-500/50'
      : 'ring-1 ring-gray-200 dark:ring-gray-700/80';

  const items = (deal.items || []).slice(0, 2);
  const extraItems = (deal.items?.length || 0) - items.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative bg-white dark:bg-gray-800/90 backdrop-blur-sm ${ringClass} rounded-2xl p-3.5 cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-0.5 dark:shadow-black/20 transition-all ${
        isDragging ? 'opacity-50 shadow-xl rotate-1' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={contactName}
              className="w-11 h-11 rounded-xl object-cover ring-2 ring-white dark:ring-gray-800 shadow-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-sm font-bold ring-2 ring-white dark:ring-gray-800 shadow-sm"
              style={{ background: avatarBg }}
            >
              {initials}
            </div>
          )}
          {staleness && (
            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${
              staleness === 'urgent' ? 'bg-red-500' : 'bg-amber-400'
            }`} />
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
              {contactName}
            </span>
            <TierBadge tier={tier} />
          </div>
          {phone && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {formatPhone(phone)}
            </div>
          )}
          {deal.title && deal.title !== contactName && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {deal.title}
            </div>
          )}
        </div>
      </div>

      {/* Itens do catálogo */}
      {(items.length > 0 || deal.catalog_name) && (
        <div className="mt-3 space-y-1">
          {items.length > 0 ? items.map(item => {
            const cfg = ITEM_ICON[item.catalog_type as keyof typeof ITEM_ICON];
            const Icon = cfg?.Icon;
            return (
              <div key={item.id} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                {Icon && <Icon size={11} className={`${cfg.color} flex-shrink-0`} />}
                <span className="truncate">{item.catalog_name}</span>
              </div>
            );
          }) : deal.catalog_name ? (() => {
            const cfg = ITEM_ICON[deal.catalog_type as keyof typeof ITEM_ICON];
            const Icon = cfg?.Icon;
            return (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                {Icon && <Icon size={11} className={`${cfg.color} flex-shrink-0`} />}
                <span className="truncate">{deal.catalog_name}</span>
              </div>
            );
          })() : null}
          {extraItems > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">+{extraItems} item{extraItems !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Labels */}
      {labelMap && Array.isArray(deal.labels) && deal.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {deal.labels.slice(0, 3).map(lId => {
            const label = labelMap.get(lId);
            if (!label) return null;
            return (
              <span
                key={lId}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-white leading-none"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            );
          })}
          {deal.labels.length > 3 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">+{deal.labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer: valor + vendedor + alerta */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/50">
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {deal.value ? `R$ ${Number(deal.value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
        </span>
        <div className="flex items-center gap-2">
          {staleness && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
              staleness === 'urgent' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              <AlertCircle size={11} />
              {staleness === 'urgent' ? '+24h' : '+12h'}
            </span>
          )}
          {seller && <SellerAvatar member={seller} size={20} />}
        </div>
      </div>
    </div>
  );
}
