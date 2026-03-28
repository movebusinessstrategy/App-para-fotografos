import React, { useEffect, useState } from "react";
import { FileText, Tag, User, Phone, Instagram, DollarSign, X } from "lucide-react";
import { Lead } from "../../types/vendas";

interface LeadPanelDadosProps {
  lead: Lead;
  stageLabel?: string;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
}

const normalizeTag = (value: string) => value.trim().replace(/^#/, "").toLowerCase();

export function LeadPanelDados({
  lead,
  stageLabel,
  onAddTag,
  onRemoveTag,
}: LeadPanelDadosProps) {
  const [notes, setNotes] = useState(lead.notes);
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    setNotes(lead.notes);
    setTagDraft("");
  }, [lead.id, lead.notes]);

  const infoRow = (label: string, value?: string) => (
    <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
      <span className="font-medium">{label}</span>
      <span className="text-gray-600 dark:text-gray-300">{value || "—"}</span>
    </div>
  );

  const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(lead.estimatedValue);

  const handleAddTag = () => {
    if (!onAddTag) return;
    const parsed = normalizeTag(tagDraft);
    if (!parsed) return;
    onAddTag(parsed);
    setTagDraft("");
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-100">
          <User size={16} />
          Informações
        </div>
        <div className="space-y-2">
          {infoRow("Nome", lead.name)}
          {infoRow("Telefone", lead.phone)}
          {infoRow("Instagram", lead.instagramHandle)}
          <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
            <span className="font-medium">Canal</span>
            <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
              {lead.channel === "whatsapp" ? <Phone size={14} /> : <Instagram size={14} />}
              <span className="capitalize">{lead.channel}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-100">
          <DollarSign size={16} />
          Serviço
        </div>
        <div className="space-y-2">
          {infoRow("Tipo", lead.serviceType)}
          {infoRow("Valor", currency)}
          {infoRow("Status", stageLabel || lead.stage)}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-100">
          <Tag size={16} />
          Tags
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => onRemoveTag?.(tag)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                onRemoveTag
                  ? "bg-blue-100 text-blue-700 transition hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100"
              }`}
            >
              #{tag}
              {onRemoveTag && <X size={12} />}
            </button>
          ))}
          {lead.tags.length === 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">Nenhuma etiqueta cadastrada.</span>
          )}
        </div>
        {onAddTag && (
          <div className="flex items-center gap-2">
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder="Nova etiqueta"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={handleAddTag}
              disabled={!tagDraft.trim()}
              className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Adicionar
            </button>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-100">
          <FileText size={16} />
          Notas
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          rows={4}
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Dica: para salvar notas no cadastro principal, use o botão Editar lead no topo da conversa.
        </p>
      </section>
    </div>
  );
}
