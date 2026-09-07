import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, MessageCircle, UserRound } from "lucide-react";
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

function getStalenessFrame(staleness: ReturnType<typeof getStaleness>) {
  if (staleness === 'urgent') {
    return 'border-red-400/90 ring-1 ring-red-400/25 dark:border-red-500/80 dark:ring-red-500/20';
  }
  if (staleness === 'warning') {
    return 'border-amber-400/80 ring-1 ring-amber-400/20 dark:border-amber-500/70 dark:ring-amber-500/15';
  }
  return 'border-black/[0.07] dark:border-white/[0.08]';
}

function getStalenessLabel(staleness: ReturnType<typeof getStaleness>) {
  if (staleness === 'urgent') return 'Há mais de 24 horas nesta etapa';
  if (staleness === 'warning') return 'Há mais de 12 horas nesta etapa';
  return undefined;
}

function getActivitySegments(activityCount?: number) {
  if (!activityCount) return 0;
  return Math.min(5, Math.max(1, Math.ceil(activityCount / 2)));
}

function hasQualifiedLabel(deal: Deal, labelMap?: Map<string, PipelineLabel>) {
  return (deal.labels || []).some((labelId) => {
    const labelName = labelMap?.get(labelId)?.name || '';
    return labelName.toLocaleLowerCase('pt-BR').includes('qualific');
  });
}

export function DealCard({ deal, client, onClick, labelMap, campaignMap, seller, canSeeFinance = true }: DealCardProps) {
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
  const source = deal.lead_source?.trim() || null;
  const campaign = deal.campaign_id ? campaignMap?.get(deal.campaign_id) : null;
  const origin = [source, campaign?.name].filter((item, index, list) => item && list.indexOf(item) === index).join(' · ');
  const hasValue = canSeeFinance && Number(deal.value) > 0;
  const activitySegments = getActivitySegments(deal.activity_count);
  const sellerName = seller?.name || 'Sem responsável';
  const qualifiedByLabel = hasQualifiedLabel(deal, labelMap);
  const manuallyQualified = deal.temperature_locked && deal.temperature === 'hot';
  const isQualified = qualifiedByLabel || manuallyQualified;
  const qualificationTitle = qualifiedByLabel
    ? 'Lead qualificado pela etiqueta aplicada'
    : 'Lead qualificado manualmente como Quente';
  const temperature = deal.temperature || 'cold';
  const temperatureMeta = {
    cold: { label: 'Frio', dot: 'bg-sky-500', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
    warm: { label: 'Morno', dot: 'bg-amber-500', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    hot: { label: 'Quente', dot: 'bg-rose-500', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  }[temperature];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      title={getStalenessLabel(staleness)}
      className={`group relative min-h-[142px] cursor-pointer rounded-2xl border bg-white p-3.5 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.7)] transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-28px_rgba(0,0,0,0.5)] dark:bg-[#171717] dark:shadow-black/30 ${getStalenessFrame(staleness)} ${isDragging ? 'rotate-1 opacity-50 shadow-xl' : ''}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-2.5">
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
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[11px] font-bold text-white ring-1 ring-white/20"
                style={{ background: avatarBg }}
              >
                {initials}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[14px] font-semibold tracking-tight text-gray-950 dark:text-white">{contactName}</p>
            <p className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
              {phone || deal.contact_email || 'Contato ainda incompleto'}
            </p>
          </div>
          <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${temperatureMeta.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${temperatureMeta.dot}`} />
            {temperatureMeta.label}
          </span>
        </div>

        <div className="mt-3 flex min-h-6 items-center gap-1.5">
          <span
            className={`max-w-[132px] truncate rounded-md px-2 py-1 text-[10px] font-medium ${
              origin
                ? 'bg-black/[0.04] text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}
            title={origin || 'Origem não informada'}
          >
            {origin || 'Origem não informada'}
          </span>
          {isQualified && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
              title={qualificationTitle}
            >
              <CheckCircle2 size={12} /> Qualificado
            </span>
          )}
          {phone && <MessageCircle size={15} className="ml-auto flex-shrink-0 text-gray-400 dark:text-gray-500" aria-label="Conversa disponível" />}
        </div>

        <div className="mt-2 flex items-center gap-1" title={`${deal.activity_count || 0} interação(ões) registrada(s)`}>
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${index < activitySegments ? 'bg-gold-500/75' : 'bg-black/[0.055] dark:bg-white/[0.08]'}`}
            />
          ))}
        </div>

        <div className="mt-auto flex items-center gap-1.5 pt-2 text-[10px] text-gray-500 dark:text-gray-400">
          {seller ? <SellerAvatar member={seller} size={16} /> : <UserRound size={14} className="text-gray-400 dark:text-gray-500" />}
          <span className="min-w-0 flex-1 truncate">{sellerName}</span>
          {hasValue && (
            <span className="flex-shrink-0 font-semibold tabular-nums text-gray-700 dark:text-gray-200">
              R$ {Number(deal.value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
