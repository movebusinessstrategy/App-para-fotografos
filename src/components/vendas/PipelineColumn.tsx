import React, { FC } from "react";
import { Lead, PipelineStage } from "../../types/vendas";
import { LeadCard } from "./LeadCard";

interface PipelineColumnProps {
  title: string;
  stage: PipelineStage;
  leads: Lead[];
  onSelectLead: (id: string) => void;
  selectedLeadId?: string | null;
  onEditLead?: (lead: Lead) => void;
}

export const PipelineColumn: FC<PipelineColumnProps> = ({
  title,
  stage,
  leads,
  onSelectLead,
  selectedLeadId,
  onEditLead,
}) => {
  return (
    <div
      data-stage={stage}
      className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-100">
        <span>{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {leads.length === 0 ? (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">Nenhum lead</p>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              selected={lead.id === selectedLeadId}
              onClick={() => onSelectLead(lead.id)}
              onEdit={onEditLead ? () => onEditLead(lead) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};
