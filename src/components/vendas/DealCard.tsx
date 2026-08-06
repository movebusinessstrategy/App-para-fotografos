import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Package, AlertCircle } from "lucide-react";
import { Deal, Client, PipelineLabel, TeamMember, SaleCampaign } from "../../types";
import { useDealAvatar, getInitials, getAvatarBg } from "./dealAvatar";
import { SellerAvatar } from "./SellerPicker";

interface DealCardProps {
  deal: Deal;
  client?: Client;
  onClick: () => void;
  labelMap?: Map<string, PipelineLabel>;
  // Mapa opcional de campanhas (venda especial) para resolver nome/cor pelo campaign_id.
  campaignMap?: Map<string, SaleCampaign>;
  seller?: TeamMember;
  // Funcionário sem permissão "Financeiro" não vê o valor do negócio.
  canSeeFinance?: boolean;
}

function getStaleness(enteredAt?: string | null): 'urgent' | 'warning' | null {
  if (!enteredAt) return null;
  const hours = (Date.now() - new Date(enteredAt).getTime()) / 3_600_000;
  if (hours >= 24) return 'urgent';
  if (hours >= 12) return 'warning';
  return null;
}

export function DealCard({ deal, client, onClick, campaignMap, seller, canSeeFinance = true }: DealCardProps) {
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

  const items = (deal.items || []).slice(0, 2);
  const extraItems = (deal.items?.length || 0) - items.length;

  const campaign = deal.campaign_id && campaignMap ? campaignMap.get(deal.campaign_id) : undefined;
  const temperature = deal.temperature || 'cold';
  const temperatureMeta = {
    cold: { label: 'Frio', dot: 'bg-sky-400', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
    warm: { label: 'Morno', dot: 'bg-amber-400', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    hot: { label: 'Quente', dot: 'bg-rose-500', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  }[temperature];
  const primaryPackage = items[0]?.catalog_name || deal.catalog_name || (deal.title !== contactName ? deal.title : 'Pacote não definido');

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative cursor-pointer rounded-[1.35rem] border border-black/[0.06] bg-white p-4 shadow-[0_18px_42px_-36px_rgba(0,0,0,0.7)] transition-all hover:-translate-y-0.5 hover:border-gold-500/25 hover:shadow-[0_24px_48px_-34px_rgba(0,0,0,0.55)] dark:border-white/[0.07] dark:bg-[#171717] dark:shadow-black/30 ${isDragging ? 'rotate-1 opacity-50 shadow-xl' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={contactName}
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-black/5 dark:ring-white/10"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white ring-1 ring-white/20"
              style={{ background: avatarBg }}
            >
              {initials}
            </div>
          )}
          {staleness && (
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-[#171717] ${
              staleness === 'urgent' ? 'bg-red-500' : 'bg-amber-400'
            }`} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-gray-950 dark:text-white">{contactName}</p>
              <p className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">{campaign?.name || 'Oportunidade'}</p>
            </div>
            <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${temperatureMeta.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${temperatureMeta.dot}`} />{temperatureMeta.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-black/[0.025] px-3 py-2.5 dark:bg-white/[0.04]">
        <Package size={13} className="flex-shrink-0 text-gold-600 dark:text-gold-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">{primaryPackage}</span>
        {extraItems > 0 && <span className="flex-shrink-0 text-[9px] text-gray-400">+{extraItems}</span>}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Potencial</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-950 dark:text-white">
            {canSeeFinance ? (deal.value ? `R$ ${Number(deal.value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Sem valor') : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {staleness && (
            <span className={`inline-flex items-center gap-1 text-[9px] font-semibold ${
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
