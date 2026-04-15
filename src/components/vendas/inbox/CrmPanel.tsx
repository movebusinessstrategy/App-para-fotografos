import React, { useEffect, useState } from "react";
import {
  ChevronDown, ChevronUp, Save, Loader2, UserPlus, Phone,
  User, Info, Pencil, Check, Copy, ExternalLink,
} from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { Deal, PipelineStage } from "../../../types";

interface ContactInfo {
  profile_picture_url: string | null;
  about: string | null;
  contact_name: string | null;
  last_message_at: string | null;
}

interface Props {
  phone: string;
  contactName?: string | null;
  deals: Deal[];
  stages: PipelineStage[];
  onDealUpdated: () => void;
}

const COLORS = [
  "bg-gold-500", "bg-violet-500", "bg-emerald-500",
  "bg-sky-500", "bg-rose-500", "bg-amber-500", "bg-teal-500",
];
function avatarColor(phone: string) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

// Normaliza para o formato brasileiro com código de país (13 dígitos)
function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("55")) {
    if (d.length === 12) return d.slice(0, 4) + "9" + d.slice(4); // adiciona 9
    return d; // 13 dígitos = correto
  }
  if (d.length === 11) return "55" + d;
  if (d.length === 10) return "55" + d.slice(0, 2) + "9" + d.slice(2);
  return d;
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("55") && d.length === 12)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d.slice(0, 2)} ${d.slice(2)}`;
}

function timeAgo(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "agora há pouco";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hoje às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  if (diff < 172800) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

type Tab = "contact" | "crm";

export function CrmPanel({ phone, contactName, deals, stages, onDealUpdated }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("contact");
  const [savingStage, setSavingStage] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [stagesOpen, setStagesOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [copied, setCopied] = useState(false);

  const deal = deals.find(
    (d) => normalizePhone(d.contact_phone || "") === normalizePhone(phone)
  );

  useEffect(() => {
    setNoteText(deal?.notes || "");
  }, [deal?.id]);

  useEffect(() => {
    setContactInfo(null);
    setEditingName(false);
    setLoadingInfo(true);
    const cleanPhone = phone.replace(/\D/g, "");
    authFetch(`/api/inbox/contact-info/${cleanPhone}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setContactInfo(d);
          setNameInput(d.contact_name || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [phone]);

  const activeStages = stages.filter((s) => !s.is_final);
  const finalStages = stages.filter((s) => s.is_final);
  const currentStage = stages.find((s) => s.id === deal?.stage);

  // Nome final: do banco > do componente pai > telefone formatado
  const displayName = contactInfo?.contact_name || contactName || null;
  const photoUrl = contactInfo?.profile_picture_url;

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    setSavingName(true);
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const res = await authFetch(`/api/inbox/contact-name/${cleanPhone}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (res.ok) {
        setContactInfo((prev) => prev ? { ...prev, contact_name: nameInput.trim() } : prev);
        setEditingName(false);
      }
    } finally {
      setSavingName(false);
    }
  };

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleStageChange = async (stageId: string) => {
    if (!deal || savingStage) return;
    setSavingStage(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: stageId }),
      });
      onDealUpdated();
    } finally {
      setSavingStage(false);
    }
  };

  const handleSaveNote = async () => {
    if (!deal || savingNote) return;
    setSavingNote(true);
    try {
      await authFetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: noteText }),
      });
      onDealUpdated();
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateDeal = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const firstStage = activeStages[0];
      await authFetch("/api/deals", {
        method: "POST",
        body: JSON.stringify({
          title: displayName || phone,
          contact_name: displayName || null,
          contact_phone: phone,
          stage: firstStage?.id || "new",
          value: 0,
          priority: "medium",
        }),
      });
      onDealUpdated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button
          onClick={() => setActiveTab("contact")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "contact"
              ? "border-b-2 border-gold-500 text-gold-600 dark:text-gold-400"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
        >
          <User size={13} /> Contato
        </button>
        <button
          onClick={() => setActiveTab("crm")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "crm"
              ? "border-b-2 border-gold-500 text-gold-600 dark:text-gold-400"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
        >
          <Info size={13} /> CRM
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "contact" ? (
          /* ── Aba Contato ──────────────────────────────────────── */
          <div className="flex flex-col">
            {/* Foto + nome */}
            <div className="flex flex-col items-center gap-3 px-5 pt-6 pb-5 border-b border-gray-100 dark:border-gray-700">
              {/* Avatar */}
              <div className="relative">
                {loadingInfo ? (
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md ${avatarColor(phone)}`}>
                    <Loader2 size={20} className="animate-spin opacity-70" />
                  </div>
                ) : photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={displayName || phone}
                    className="w-20 h-20 rounded-full object-cover shadow-md ring-2 ring-white dark:ring-gray-700"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md ${avatarColor(phone)}`}>
                    {(displayName || phone).slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Nome editável */}
              <div className="w-full text-center">
                {editingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveName();
                        if (e.key === "Escape") { setEditingName(false); setNameInput(contactInfo?.contact_name || ""); }
                      }}
                      placeholder="Nome do contato"
                      className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gold-300 dark:border-gold-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-gold-400"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={savingName || !nameInput.trim()}
                      className="p-1.5 rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-40 transition-colors"
                    >
                      {savingName ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5">
                    <p className="text-base font-bold text-gray-900 dark:text-white">
                      {displayName || <span className="text-gray-400 font-normal italic text-sm">Sem nome</span>}
                    </p>
                    <button
                      onClick={() => { setEditingName(true); setNameInput(displayName || ""); }}
                      className="p-1 rounded text-gray-400 hover:text-gold-500 transition-colors"
                      title="Editar nome"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* Última atividade */}
              {contactInfo?.last_message_at && (
                <p className="text-[11px] text-gray-400">
                  Última mensagem: {timeAgo(contactInfo.last_message_at)}
                </p>
              )}
            </div>

            {/* Informações */}
            <div className="px-4 py-4 space-y-4">
              {/* Telefone */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Telefone</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-gray-700 dark:text-gray-200 font-mono">{formatPhone(phone)}</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCopyPhone}
                      title="Copiar número"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gold-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                    </button>
                    <a
                      href={`https://wa.me/${phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir no WhatsApp"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>

              <div className="h-px bg-gray-100 dark:bg-gray-700" />

              {/* Sobre */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sobre (WhatsApp)</p>
                {loadingInfo ? (
                  <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
                ) : contactInfo?.about ? (
                  <p className="text-sm text-gray-700 dark:text-gray-300 italic leading-snug">"{contactInfo.about}"</p>
                ) : (
                  <p className="text-xs text-gray-400 italic">Nenhuma descrição</p>
                )}
              </div>

              {/* Fase do CRM se tiver deal */}
              {currentStage && (
                <>
                  <div className="h-px bg-gray-100 dark:bg-gray-700" />
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fase no Funil</p>
                    <div
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold w-fit"
                      style={{ background: `${currentStage.color}22`, color: currentStage.color }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: currentStage.color }} />
                      {currentStage.name}
                    </div>
                  </div>
                </>
              )}

              {/* Botão ver CRM se sem deal */}
              {!deal && (
                <>
                  <div className="h-px bg-gray-100 dark:bg-gray-700" />
                  <button
                    onClick={handleCreateDeal}
                    disabled={creating}
                    className="flex w-full items-center justify-center gap-2 px-3 py-2.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    Adicionar ao funil de vendas
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── Aba CRM ─────────────────────────────────────────── */
          <div className="flex flex-col">
            <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-700">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">CRM</p>
              <p className="text-base font-bold text-gray-900 dark:text-white truncate">
                {displayName || phone}
              </p>
              {displayName && <p className="text-xs text-gray-400 mt-0.5">{formatPhone(phone)}</p>}
              {currentStage && (
                <div
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: `${currentStage.color}22`, color: currentStage.color }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: currentStage.color }} />
                  {currentStage.name}
                </div>
              )}
            </div>

            {!deal ? (
              <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-gold-50 dark:bg-gold-900/30 flex items-center justify-center">
                  <UserPlus size={22} className="text-gold-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Sem lead no pipeline</p>
                  <p className="text-xs text-gray-400 mt-1">Adicione esta conversa ao funil de vendas</p>
                </div>
                <button
                  onClick={handleCreateDeal}
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Adicionar ao funil
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 py-2">
                {/* Fases */}
                <div className="px-4">
                  <button
                    onClick={() => setStagesOpen((v) => !v)}
                    className="flex items-center justify-between w-full py-2"
                  >
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fase do Lead</span>
                    {stagesOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {stagesOpen && (
                    <div className="flex flex-col gap-1 pb-3">
                      {activeStages.map((stage) => {
                        const isActive = deal.stage === stage.id;
                        return (
                          <button
                            key={stage.id}
                            onClick={() => handleStageChange(stage.id)}
                            disabled={savingStage}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                              isActive ? "font-semibold" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            }`}
                            style={isActive ? { background: `${stage.color}18`, color: stage.color } : {}}
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                            {stage.name}
                            {isActive && savingStage && <Loader2 size={12} className="animate-spin ml-auto" />}
                          </button>
                        );
                      })}
                      {finalStages.length > 0 && (
                        <>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mt-2 mb-1">Finalizar</p>
                          {finalStages.map((stage) => {
                            const isActive = deal.stage === stage.id;
                            return (
                              <button
                                key={stage.id}
                                onClick={() => handleStageChange(stage.id)}
                                disabled={savingStage}
                                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                                  isActive ? "font-semibold" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                }`}
                                style={isActive ? { background: `${stage.color}18`, color: stage.color } : {}}
                              >
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                                {stage.name}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mx-4 h-px bg-gray-100 dark:bg-gray-700" />

                {/* Valor */}
                <div className="px-4 py-3">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Valor Estimado</p>
                  <p className="text-xl font-bold text-gold-600">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(deal.value || 0)}
                  </p>
                </div>

                <div className="mx-4 h-px bg-gray-100 dark:bg-gray-700" />

                {/* Anotações */}
                <div className="px-4 py-3 flex flex-col gap-2">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Anotações</p>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escreva sobre essa conversa..."
                    rows={4}
                    className="w-full text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 outline-none resize-none focus:border-gold-400 transition-colors"
                  />
                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote || noteText === (deal.notes || "")}
                    className="flex items-center justify-center gap-2 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {savingNote ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
