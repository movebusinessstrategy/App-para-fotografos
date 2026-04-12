import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { Send, X, Loader2, CheckCircle2, AlertCircle, Rocket } from "lucide-react";

import { Deal, PipelineStage, Client, PipelineLabel } from "../../types";
import { authFetch } from "../../utils/authFetch";
import { DealCard } from "./DealCard";
import { DealDetailDrawer } from "./DealDetailDrawer";

interface FunilTabProps {
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  onUpdate: (options?: { silent?: boolean }) => void | Promise<void>;
}

// ─── Follow-up Blast Modal ───────────────────────────────────────────────────

interface BlastResult {
  sent: number;
  failed: number;
  total: number;
  errors: string[];
}

interface FollowUpModalProps {
  stage: PipelineStage;
  dealsInStage: Deal[];
  onClose: () => void;
}

const DELAY_OPTIONS = [
  { value: 0.5, label: "30 minutos" },
  { value: 1, label: "1 hora" },
  { value: 2, label: "2 horas" },
  { value: 4, label: "4 horas" },
  { value: 8, label: "8 horas" },
  { value: 12, label: "12 horas" },
  { value: 18, label: "18 horas" },
];

function FollowUpModal({ stage, dealsInStage, onClose }: FollowUpModalProps) {
  const withPhone = dealsInStage.filter((d) => d.contact_phone?.trim());
  const [tab, setTab] = useState<"auto" | "agora">("auto");

  // Aba Automático
  const [autoMessage, setAutoMessage] = useState(stage.follow_up_message || "");
  const [autoEnabled, setAutoEnabled] = useState(stage.auto_follow_up_enabled ?? false);
  const [delayHours, setDelayHours] = useState(stage.follow_up_delay_hours ?? 2);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Aba Agora
  const [nowMessage, setNowMessage] = useState(stage.follow_up_message || "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BlastResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [error, setError] = useState("");

  const handleSaveAuto = async () => {
    if (!autoMessage.trim()) return;
    setSaving(true);
    setError("");
    setSaveOk(false);
    try {
      const [r1, r2] = await Promise.all([
        authFetch(`/api/pipeline/stages/${stage.id}/follow-up`, {
          method: "PATCH",
          body: JSON.stringify({ message: autoMessage }),
        }),
        authFetch(`/api/pipeline/stages/${stage.id}`, {
          method: "PUT",
          body: JSON.stringify({ auto_follow_up_enabled: autoEnabled, follow_up_delay_hours: delayHours }),
        }),
      ]);
      const d1 = await r1.json();
      if (!r1.ok) {
        setError(d1.error || "Erro ao salvar mensagem");
      } else if (!r2.ok) {
        setError("Erro ao salvar configuração");
      } else {
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      }
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  };

  const handleBlast = async () => {
    if (!nowMessage.trim() || withPhone.length === 0) return;
    setSending(true);
    setError("");
    setResult(null);
    try {
      const res = await authFetch(`/api/pipeline/stages/${stage.id}/blast`, {
        method: "POST",
        body: JSON.stringify({ message: nowMessage }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Erro ao disparar");
      else setResult(data);
    } catch {
      setError("Erro de conexão");
    } finally {
      setSending(false);
      setConfirmed(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Rocket size={18} className="text-gold-500" />
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white text-sm">Follow-up</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{stage.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={() => { setTab("auto"); setError(""); }}
            className={`flex-1 py-3 text-xs font-semibold transition-colors ${
              tab === "auto"
                ? "text-gold-600 border-b-2 border-gold-500"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Automático
          </button>
          <button
            onClick={() => { setTab("agora"); setError(""); setResult(null); setConfirmed(false); }}
            className={`flex-1 py-3 text-xs font-semibold transition-colors ${
              tab === "agora"
                ? "text-gold-600 border-b-2 border-gold-500"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Enviar agora
          </button>
        </div>

        {/* ── ABA AUTOMÁTICO ── */}
        {tab === "auto" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">Ativar envio automático</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Envia para o lead quando ele entrar nesta etapa
                  </p>
                </div>
                <button
                  onClick={() => setAutoEnabled((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    autoEnabled ? "bg-gold-500" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    autoEnabled ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>

              {/* Delay — só mostra se ativado */}
              {autoEnabled && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                    Enviar após entrar na etapa
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DELAY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setDelayHours(opt.value)}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                          delayHours === opt.value
                            ? "bg-gold-500 border-gold-500 text-white"
                            : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gold-400 hover:text-gold-500"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Horários entre 22h–07h são adiados para às 07h para não acordar ninguém.
                  </p>
                </div>
              )}

              {/* Mensagem */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Mensagem da etapa
                </label>
                <textarea
                  value={autoMessage}
                  onChange={(e) => setAutoMessage(e.target.value)}
                  rows={5}
                  placeholder={"Olá {nome}, tudo bem?\n\nVi que ainda não finalizamos sua sessão..."}
                  className="w-full rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-200 px-4 py-3 outline-none focus:ring-2 focus:ring-gold-400 resize-none placeholder-gray-400"
                />
                <p className="text-[11px] text-gray-400">
                  Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{"{nome}"}</code> para inserir o nome do contato automaticamente.
                </p>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              <button
                onClick={handleSaveAuto}
                disabled={saving || !autoMessage.trim()}
                className={`w-full py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 ${
                  saveOk
                    ? "bg-green-500 text-white"
                    : "bg-gold-600 hover:bg-gold-700 text-white"
                }`}
              >
                {saving
                  ? <><Loader2 size={14} className="animate-spin inline mr-1.5" />Salvando...</>
                  : saveOk
                  ? <><CheckCircle2 size={14} className="inline mr-1.5" />Configuração salva!</>
                  : "Salvar configuração"}
              </button>
            </div>
          </>
        )}

        {/* ── ABA ENVIAR AGORA ── */}
        {tab === "agora" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Contadores */}
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl bg-gray-50 dark:bg-gray-800 p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{dealsInStage.length}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">cards na etapa</p>
                </div>
                <div className="flex-1 rounded-xl bg-gold-50 dark:bg-gold-900/20 p-3 text-center">
                  <p className="text-2xl font-bold text-gold-600 dark:text-gold-400">{withPhone.length}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">com telefone</p>
                </div>
              </div>

              {withPhone.length === 0 && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-400">
                  Nenhum contato nesta etapa tem telefone cadastrado.
                </div>
              )}

              {/* Mensagem */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Mensagem
                </label>
                <textarea
                  value={nowMessage}
                  onChange={(e) => setNowMessage(e.target.value)}
                  rows={5}
                  placeholder={"Olá {nome}, tudo bem?\n\nVi que ainda não finalizamos..."}
                  className="w-full rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-200 px-4 py-3 outline-none focus:ring-2 focus:ring-gold-400 resize-none placeholder-gray-400"
                />
                <p className="text-[11px] text-gray-400">
                  Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{"{nome}"}</code> para personalizar. Será enviado imediatamente para todos com telefone.
                </p>
              </div>

              {/* Prévia */}
              {withPhone.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Quem vai receber agora
                  </p>
                  <div className="max-h-28 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                    {withPhone.map((d) => (
                      <div key={d.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-gray-700 dark:text-gray-300 truncate">{d.contact_name || d.title}</span>
                        <span className="text-gray-400 ml-2 flex-shrink-0">{d.contact_phone}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resultado */}
              {result && (
                <div className={`rounded-xl p-4 text-sm space-y-1 ${
                  result.failed === 0
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                }`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {result.failed === 0
                      ? <CheckCircle2 size={15} className="text-green-600" />
                      : <AlertCircle size={15} className="text-amber-600" />}
                    <span>{result.sent} de {result.total} enviados com sucesso</span>
                  </div>
                  {result.failed > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 ml-5">
                      Falhas: {result.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              {result ? (
                <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  Fechar
                </button>
              ) : !confirmed ? (
                <button
                  onClick={() => setConfirmed(true)}
                  disabled={!nowMessage.trim() || withPhone.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-40 transition-colors"
                >
                  <Rocket size={15} />
                  Disparar para {withPhone.length} contato{withPhone.length !== 1 ? "s" : ""} agora
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmed(false)}
                    className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleBlast}
                    disabled={sending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-40 transition-colors"
                  >
                    {sending
                      ? <><Loader2 size={14} className="animate-spin" />Enviando...</>
                      : <><Send size={14} />Confirmar</>}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── FunilTab ────────────────────────────────────────────────────────────────

export function FunilTab({ deals, stages, clients, onUpdate }: FunilTabProps) {
  const [localDeals, setLocalDeals] = useState<Deal[]>(deals);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [blastStage, setBlastStage] = useState<PipelineStage | null>(null);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabel[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    setLocalDeals(deals);
    setSelectedDeal((prev) => {
      if (!prev) return prev;
      return deals.find((d) => d.id === prev.id) ?? prev;
    });
  }, [deals]);

  useEffect(() => {
    authFetch('/api/pipeline/labels').then(r => r.json()).then(d => setPipelineLabels(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const labelMap = useMemo(() => {
    const map = new Map<string, PipelineLabel>();
    pipelineLabels.forEach(l => map.set(l.id, l));
    return map;
  }, [pipelineLabels]);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const activeStages = stages.filter((s) => !s.is_final);

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    activeStages.forEach((s) => (map[s.id] = []));
    localDeals.forEach((d) => {
      if (map[d.stage]) map[d.stage].push(d);
    });
    return map;
  }, [localDeals, activeStages]);

  const handleDragStart = (event: DragStartEvent) => {
    const deal = localDeals.find((d) => String(d.id) === String(event.active.id));
    setActiveDeal(deal || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    let newStageId = String(over.id);

    const targetDeal = localDeals.find((d) => String(d.id) === newStageId);
    if (targetDeal) newStageId = targetDeal.stage || newStageId;

    const deal = localDeals.find((d) => String(d.id) === dealId);
    const targetStage = stages.find((s) => s.id === newStageId);
    if (!deal || !targetStage || deal.stage === newStageId) return;

    const previousDeals = localDeals.map((d) => ({ ...d }));
    setLocalDeals((prev) =>
      prev.map((d) => (String(d.id) === dealId ? { ...d, stage: newStageId } : d))
    );

    try {
      await authFetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStageId }),
      });
      onUpdate({ silent: true });
    } catch {
      setLocalDeals(previousDeals);
    }
  };

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="h-full flex flex-col">
          <div ref={boardRef} className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-4 h-full px-1" style={{ minWidth: "max-content" }}>
              {activeStages.map((stage) => (
                <React.Fragment key={stage.id}>
                  <StageColumn
                    stage={stage}
                    deals={dealsByStage[stage.id] || []}
                    clientMap={clientMap}
                    onDealClick={setSelectedDeal}
                    onFollowUp={() => setBlastStage(stage)}
                    labelMap={labelMap}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeDeal && (
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-3 shadow-lg w-[260px] opacity-95">
              <div className="font-medium text-gray-900 dark:text-white text-sm">{activeDeal.title}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                R$ {(activeDeal.value || 0).toLocaleString("pt-BR")}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <DealDetailDrawer
        deal={selectedDeal}
        client={selectedDeal?.client_id ? clientMap.get(selectedDeal.client_id) : undefined}
        clients={clients}
        stages={stages}
        onClose={() => setSelectedDeal(null)}
        onUpdate={onUpdate}
      />

      {blastStage && (
        <FollowUpModal
          stage={blastStage}
          dealsInStage={dealsByStage[blastStage.id] || []}
          onClose={() => setBlastStage(null)}
        />
      )}
    </>
  );
}

// ─── StageColumn ─────────────────────────────────────────────────────────────

interface StageColumnProps {
  stage: PipelineStage;
  deals: Deal[];
  clientMap: Map<number, Client>;
  onDealClick: (deal: Deal) => void;
  onFollowUp: () => void;
  labelMap: Map<string, PipelineLabel>;
}

function StageColumn({ stage, deals, clientMap, onDealClick, onFollowUp, labelMap }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 w-[280px] min-w-[280px] h-full rounded-lg border transition-colors ${
        isOver
          ? "border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-800/80"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      }`}
    >
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
            {stage.name}
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {deals.length}
            </span>
            <button
              onClick={onFollowUp}
              title="Disparar follow-up em massa"
              className="p-1 rounded-md text-gray-400 hover:text-gold-500 hover:bg-gold-50 dark:hover:bg-gold-900/20 transition-colors"
            >
              <Rocket size={14} />
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          R$ {totalValue.toLocaleString("pt-BR")}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={deals.map((d) => d.id.toString())}>
          {deals.map((deal) => (
            <React.Fragment key={deal.id}>
              <DealCard
                deal={deal}
                client={deal.client_id ? clientMap.get(deal.client_id) : undefined}
                onClick={() => onDealClick(deal)}
                labelMap={labelMap}
              />
            </React.Fragment>
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <div className="flex items-center justify-center h-20 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <span className="text-xs text-gray-400 dark:text-gray-500">Arraste negócios aqui</span>
          </div>
        )}
      </div>
    </div>
  );
}
