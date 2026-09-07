import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  CirclePlay,
  FlaskConical,
  Loader2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";
import AgentConversationReplay from "./AgentConversationReplay";
import AgentLearningFeedback from "./AgentLearningFeedback";

type JsonRecord = Record<string, unknown>;
type CaseStatus = "pending" | "approved" | "corrected" | "rejected";

interface LearningMessage {
  role: "client" | "studio";
  text: string;
}

type FlowStepKind = "question" | "portfolio" | "budget" | "handoff";

interface FlowStep {
  id: string;
  label: string;
  kind: FlowStepKind | null;
}

interface FlowState {
  currentStep: string;
  nextStep: string | null;
  completedSteps: string[];
  returnToFlow: boolean;
}

interface LearningCase {
  key: string;
  apiId: string | number;
  status: CaseStatus;
  title: string;
  category: string;
  messages: LearningMessage[];
  flowSteps: FlowStep[];
}

interface LearningRule {
  id: string | number;
  text: string;
  category: string | null;
  active: boolean;
}

interface LearningSummary {
  counts: {
    total: number;
    pending: number;
    approved: number;
    corrected: number;
    rejected: number;
  };
  activeRuleCount: number;
  memoryExamples: number;
  rules: LearningRule[];
}

interface EvaluationCheck {
  label: string;
  passed: boolean;
  detail: string | null;
}

interface SimulationResult {
  simulationId: string | number | null;
  modelId: string | null;
  modelLabel: string | null;
  reply: string;
  action: unknown;
  expectedAction: unknown;
  actualAction: unknown;
  checks: EvaluationCheck[];
  passed: boolean | null;
  flowState: FlowState | null;
}

interface BulkProgress {
  running: boolean;
  completed: number;
  total: number;
  passed: number;
  failed: number;
  unscored: number;
}

interface AgentLearningLabProps {
  demoMode?: boolean;
}

const EMPTY_SUMMARY: LearningSummary = {
  counts: { total: 0, pending: 0, approved: 0, corrected: 0, rejected: 0 },
  activeRuleCount: 0,
  memoryExamples: 0,
  rules: [],
};

const EMPTY_BULK: BulkProgress = {
  running: false,
  completed: 0,
  total: 0,
  passed: 0,
  failed: 0,
  unscored: 0,
};

const CASE_TITLE_BY_ID: Record<string, string> = {
  paid_win_01_gestante_preco: "Gestante pede orçamento",
  paid_win_02_newborn_orcamento: "Newborn quer conhecer os pacotes",
  paid_win_03_aniversario_avancar: "Aniversário quer avançar",
  paid_win_04_consulta_data: "Consulta de uma data específica",
  paid_win_05_intencao_fechar: "Cliente decidiu fechar",
  paid_win_06_pagamento_sinal: "Dúvida sobre Pix e sinal",
  paid_win_07_negociacao_objecao: "Pedido de desconto ou personalização",
  paid_win_08_duvida_incerta: "Dúvida que a Lia não sabe responder",
  flow_09_gestante_semanas: "Gestante informou quantas semanas",
  flow_10_newborn_ainda_nao_nasceu: "Newborn antes do nascimento",
  flow_11_sem_referencia_nao_conhece: "Sem referências e não conhece o trabalho",
  flow_12_instagram_meio_semana: "Conhece pelo Instagram e pode durante a semana",
  flow_13_somente_sabado: "Cliente só consegue no sábado",
  gestante_orcamento: "Gestante pede orçamento",
  newborn_pacotes: "Newborn quer conhecer os pacotes",
  aniversario_avancar: "Aniversário quer avançar",
  data_especifica: "Consulta de uma data específica",
  decidiu_fechar: "Cliente decidiu fechar",
  pix_sinal: "Dúvida sobre Pix e sinal",
  desconto_personalizacao: "Pedido de desconto ou personalização",
  duvida_sem_resposta: "Dúvida que a Lia não sabe responder",
};

const STATUS_STYLE: Record<CaseStatus, { label: string; className: string }> = {
  pending: {
    label: "Para revisar",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  approved: {
    label: "Aprovado",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  corrected: {
    label: "Corrigido",
    className: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  rejected: {
    label: "Descartado",
    className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  },
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function redactPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail oculto]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]*\d{4}\b/g, "[telefone oculto]");
}

function normalizeRole(record: JsonRecord): LearningMessage["role"] {
  if (record.from_me === true) return "studio";
  const role = firstString(record, ["role", "sender", "author"]).toLowerCase();
  return ["assistant", "agent", "studio", "attendant", "outbound"].includes(role)
    ? "studio"
    : "client";
}

function normalizeMessage(value: unknown): LearningMessage | null {
  if (typeof value === "string" && value.trim()) {
    return { role: "client", text: redactPersonalData(value.trim()) };
  }
  const record = asRecord(value);
  const text = firstString(record, ["content", "text", "body", "message"]);
  if (!text) return null;
  return { role: normalizeRole(record), text: redactPersonalData(text) };
}

function messageSource(record: JsonRecord): unknown[] {
  const candidates = [
    record.anonymized_messages,
    record.messages,
    record.transcript,
    record.conversation,
  ];
  return candidates.find(Array.isArray) as unknown[] | undefined ?? [];
}

function normalizeStatus(value: unknown): CaseStatus {
  return value === "approved" || value === "corrected" || value === "rejected"
    ? value
    : "pending";
}

function normalizeFlowKind(value: unknown): FlowStepKind | null {
  return value === "question" || value === "portfolio" || value === "budget" || value === "handoff"
    ? value
    : null;
}

function normalizeFlowStep(value: unknown, index: number): FlowStep | null {
  const record = asRecord(value);
  const id = firstString(record, ["id", "step_id", "key"]) || `step-${index + 1}`;
  const label = firstString(record, ["label", "title", "name"]);
  if (!label) return null;
  return { id, label, kind: normalizeFlowKind(record.kind) };
}

function flowStepSource(record: JsonRecord): unknown[] {
  if (Array.isArray(record.flow_steps)) return record.flow_steps;
  if (Array.isArray(record.flowSteps)) return record.flowSteps;
  return [];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function normalizeFlowState(value: unknown): FlowState | null {
  const record = asRecord(value);
  const currentStep = firstString(record, ["current_step", "currentStep"]);
  if (!currentStep) return null;
  const nextStep = firstString(record, ["next_step", "nextStep"]);
  return {
    currentStep,
    nextStep: nextStep || null,
    completedSteps: stringArray(record.completed_steps ?? record.completedSteps),
    returnToFlow: record.return_to_flow === true || record.returnToFlow === true,
  };
}

function caseTitle(rawId: unknown, fallback: string): string {
  const normalizedId = String(rawId)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const exact = CASE_TITLE_BY_ID[normalizedId];
  if (exact) return exact;
  const partial = Object.entries(CASE_TITLE_BY_ID)
    .find(([id]) => normalizedId.includes(id) || id.includes(normalizedId));
  return partial?.[1] || fallback || "Situação de atendimento";
}

function normalizeCase(value: unknown, index: number): LearningCase {
  const record = asRecord(value);
  const rawId = record.id ?? record.case_id ?? `case-${index + 1}`;
  const messages = messageSource(record)
    .map(normalizeMessage)
    .filter((message): message is LearningMessage => Boolean(message));
  const fallback = firstString(record, [
    "anonymized_excerpt",
    "excerpt",
    "customer_message",
    "context",
  ]);
  if (messages.length === 0 && fallback) {
    messages.push({ role: "client", text: redactPersonalData(fallback) });
  }
  const category = firstString(record, ["category", "niche", "nicho"]) || "Atendimento";
  const flowSteps = flowStepSource(record)
    .map(normalizeFlowStep)
    .filter((step): step is FlowStep => Boolean(step));
  return {
    key: String(rawId),
    apiId: typeof rawId === "number" ? rawId : String(rawId),
    status: normalizeStatus(record.status),
    title: caseTitle(rawId, category),
    category,
    messages,
    flowSteps,
  };
}

function normalizeRule(value: unknown): LearningRule | null {
  const record = asRecord(value);
  const id = record.id ?? record.rule_id;
  const text = firstString(record, ["rule_text", "text", "content", "proposed_rule"]);
  if ((typeof id !== "string" && typeof id !== "number") || !text) return null;
  return {
    id,
    text,
    category: firstString(record, ["category", "type"]) || null,
    active: record.active !== false,
  };
}

function summaryRuleSource(record: JsonRecord): unknown[] {
  if (Array.isArray(record.rules)) return record.rules;
  if (Array.isArray(record.learning_rules)) return record.learning_rules;
  if (Array.isArray(record.active_rules)) return record.active_rules;
  return [];
}

function normalizeSummary(value: unknown): LearningSummary {
  const record = asRecord(value);
  const counts = asRecord(record.counts);
  const rules = summaryRuleSource(record)
    .map(normalizeRule)
    .filter((rule): rule is LearningRule => Boolean(rule));
  const activeFromApi = Array.isArray(record.active_rules)
    ? record.active_rules.length
    : numberValue(record.active_rules);
  return {
    counts: {
      total: numberValue(counts.total),
      pending: numberValue(counts.pending),
      approved: numberValue(counts.approved),
      corrected: numberValue(counts.corrected),
      rejected: numberValue(counts.rejected),
    },
    activeRuleCount: rules.length > 0 ? rules.filter((rule) => rule.active).length : activeFromApi,
    memoryExamples: numberValue(record.memory_examples),
    rules,
  };
}

function normalizeCheck(value: unknown, index: number): EvaluationCheck {
  const record = asRecord(value);
  const passed = record.passed === true || record.ok === true || record.success === true;
  return {
    label: firstString(record, ["label", "name", "check", "criterion"]) || `Critério ${index + 1}`,
    passed,
    detail: firstString(record, ["detail", "reason", "message", "explanation"]) || null,
  };
}

function normalizeModel(record: JsonRecord): { id: string | null; label: string | null } {
  const model = asRecord(record.model);
  const id = firstString(model, ["id", "model_id"])
    || firstString(record, ["model_id", "modelId"]);
  const label = firstString(model, ["label", "name"])
    || (id === "claude-sonnet-4-6" ? "Claude Sonnet 4.6" : "");
  return { id: id || null, label: label || null };
}

function normalizeSimulation(value: unknown): SimulationResult {
  const record = asRecord(value);
  const evaluation = asRecord(record.evaluation);
  const model = normalizeModel(record);
  const checks = Array.isArray(evaluation.checks)
    ? evaluation.checks.map(normalizeCheck)
    : [];
  const explicitPassed = evaluation.passed ?? record.passed;
  const passed = typeof explicitPassed === "boolean"
    ? explicitPassed
    : checks.length > 0
      ? checks.every((check) => check.passed)
      : null;
  const action = record.action ?? record.decision ?? null;
  return {
    simulationId: typeof record.simulation_id === "string" || typeof record.simulation_id === "number"
      ? record.simulation_id
      : null,
    modelId: model.id,
    modelLabel: model.label,
    reply: firstString(record, ["reply", "response", "message"]),
    action,
    expectedAction: evaluation.expected_action
      ?? evaluation.expectedAction
      ?? record.expected_action
      ?? null,
    actualAction: evaluation.actual_action
      ?? evaluation.actualAction
      ?? record.actual_action
      ?? action,
    checks,
    passed,
    flowState: normalizeFlowState(record.flow_state ?? record.flowState),
  };
}

function actionKey(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  const record = asRecord(value);
  return firstString(record, ["type", "action", "decision", "name"]).toLowerCase();
}

function actionSignature(value: unknown): string {
  const record = asRecord(value);
  return [
    actionKey(value),
    firstString(record, ["reason", "motivo"]).toLowerCase(),
    firstString(record, ["nicho", "niche"]).toLowerCase(),
  ].join("|");
}

function actionLabel(value: unknown): string {
  const key = actionKey(value);
  if (!key) return "Não informado";
  const record = asRecord(value);
  const reason = firstString(record, ["reason", "motivo"]);
  const niche = firstString(record, ["nicho", "niche"]);
  if (key.includes("handoff") || key.includes("human")) {
    return reason ? `Chamar uma pessoa · ${reason.replaceAll("_", " ")}` : "Chamar uma pessoa";
  }
  if (key.includes("orcamento") || key.includes("quote")) {
    return niche ? `Enviar o orçamento · ${niche.replaceAll("_", " ")}` : "Enviar o orçamento";
  }
  if (key.includes("wait") || key.includes("aguard")) return "Aguardar o cliente";
  if (key.includes("reply") || key.includes("respond")) return "Responder ao cliente";
  return key.replaceAll("_", " ");
}

function casePreview(learningCase: LearningCase): string {
  return learningCase.messages.at(-1)?.text || "Conversa histórica sem prévia.";
}

function statusAfterDecision(decision: "approve" | "correct"): CaseStatus {
  return decision === "approve" ? "approved" : "corrected";
}

function countsAfterReview(
  counts: LearningSummary["counts"],
  previous: CaseStatus,
  next: CaseStatus,
): LearningSummary["counts"] {
  if (previous === next) return counts;
  return {
    ...counts,
    [previous]: Math.max(0, counts[previous] - 1),
    [next]: counts[next] + 1,
  };
}

function StatCard({
  value,
  label,
  detail,
}: {
  value: number;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">{value}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</div>
      <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">{detail}</div>
    </div>
  );
}

function Transcript({ learningCase }: { learningCase: LearningCase }) {
  if (learningCase.messages.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-400 dark:bg-gray-950/50 dark:text-gray-500">
        Este caso não possui mensagens disponíveis para exibição.
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-950/50 sm:p-4 md:max-h-[460px] md:overflow-y-auto md:overscroll-contain">
      {learningCase.messages.slice(-20).map((message, index) => (
        <div
          key={`${learningCase.key}-${index}`}
          className={cn("flex", message.role === "studio" ? "justify-end" : "justify-start")}
        >
          <div className="max-w-[88%]">
            <div className={cn(
              "mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-400",
              message.role === "studio" && "justify-end",
            )}>
              {message.role === "studio" ? <Sparkles size={11} /> : <UserRound size={11} />}
              {message.role === "studio" ? "Lia" : "Cliente"}
            </div>
            <div className={cn(
              "break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
              message.role === "studio"
                ? "rounded-br-sm bg-gray-900 text-white dark:bg-gray-700"
                : "rounded-bl-sm border border-gray-200 bg-white text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100",
            )}>
              {message.text}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type FlowVisualState = "completed" | "current" | "next" | "planned";

const FLOW_KIND_LABEL: Record<FlowStepKind, string> = {
  question: "Pergunta",
  portfolio: "Referências",
  budget: "PDF",
  handoff: "Humano",
};

function flowStepLabel(steps: FlowStep[], id: string | null): string {
  if (!id) return "Fluxo concluído";
  return steps.find((step) => step.id === id)?.label || id.replaceAll("_", " ");
}

function flowVisualState(step: FlowStep, state: FlowState | null): FlowVisualState {
  if (!state) return "planned";
  if (step.id === state.currentStep) return "current";
  if (state.completedSteps.includes(step.id)) return "completed";
  if (step.id === state.nextStep) return "next";
  return "planned";
}

function FlowStepMarker({ step, index, state }: {
  step: FlowStep;
  index: number;
  state: FlowVisualState;
}) {
  return (
    <div className="w-[132px] flex-shrink-0" aria-current={state === "current" ? "step" : undefined}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold",
          state === "completed" && "border-emerald-500 bg-emerald-500 text-white",
          state === "current" && "border-gold-500 bg-gold-500 text-white ring-4 ring-gold-500/10",
          state === "next" && "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
          state === "planned" && "border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500",
        )}>
          {state === "completed" ? <CheckCircle2 size={14} /> : index + 1}
        </span>
        {state === "current" && (
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-gold-700 dark:text-gold-300">Agora</span>
        )}
        {state === "next" && (
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-blue-600 dark:text-blue-300">Depois</span>
        )}
      </div>
      <p className={cn(
        "mt-2 text-xs font-semibold leading-snug",
        state === "current" ? "text-gray-950 dark:text-white" : "text-gray-600 dark:text-gray-300",
      )}>
        {step.label}
      </p>
      {step.kind && (
        <span className="mt-1 inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {FLOW_KIND_LABEL[step.kind]}
        </span>
      )}
    </div>
  );
}

function FlowJourney({ steps, state }: { steps: FlowStep[]; state: FlowState | null }) {
  if (steps.length === 0) return null;
  const currentLabel = flowStepLabel(steps, state?.currentStep ?? null);
  const nextLabel = flowStepLabel(steps, state?.nextStep ?? null);
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h5 className="text-sm font-bold text-gray-900 dark:text-white">Caminho deste atendimento</h5>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            A Lia percorre somente as etapas necessárias para este caso, sem transformar a conversa em interrogatório.
          </p>
        </div>
        {!state && (
          <span className="mt-2 self-start rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400 sm:mt-0">
            Simule para ver onde ela chegou
          </span>
        )}
      </div>

      {state && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-gold-200 bg-gold-50/60 p-3 dark:border-gold-900/60 dark:bg-gold-950/20">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-gold-700 dark:text-gold-300">Etapa atual</div>
            <div className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{currentLabel}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Próxima etapa</div>
            <div className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{nextLabel}</div>
          </div>
        </div>
      )}

      <div className="-mx-1 mt-4 overflow-x-auto overscroll-x-contain px-1 pb-2">
        <ol className="flex min-w-max items-start" aria-label="Etapas do atendimento">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-start">
              <FlowStepMarker step={step} index={index} state={flowVisualState(step, state)} />
              {index < steps.length - 1 && (
                <ChevronRight size={15} className="mx-1 mt-1.5 flex-shrink-0 text-gray-300 dark:text-gray-700" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </div>

      {state?.returnToFlow && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-violet-50 p-3 text-xs leading-relaxed text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">
          <RotateCcw size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong>A Lia trouxe a conversa de volta ao fluxo.</strong>{" "}
            Ela acolheu a resposta do cliente e retomou em “{currentLabel}”, sem repetir perguntas já respondidas.
          </span>
        </div>
      )}
    </section>
  );
}

function ActionComparison({ simulation }: { simulation: SimulationResult }) {
  const expectedKey = actionKey(simulation.expectedAction);
  const actualKey = actionKey(simulation.actualAction);
  const matches = Boolean(
    expectedKey
    && actualKey
    && actionSignature(simulation.expectedAction) === actionSignature(simulation.actualAction),
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Ação esperada</div>
        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
          {actionLabel(simulation.expectedAction)}
        </div>
      </div>
      <div className={cn(
        "rounded-xl border p-3",
        matches
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/20"
          : "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/20",
      )}>
        <div className={cn(
          "text-[11px] font-bold uppercase tracking-wide",
          matches ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400",
        )}>
          Decisão da Lia
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
          {actionLabel(simulation.actualAction)}
        </div>
      </div>
    </div>
  );
}

function EvaluationPanel({ simulation }: { simulation: SimulationResult }) {
  return (
    <div className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-200">
            <FlaskConical size={17} /> Resultado da simulação
          </div>
          {simulation.modelLabel && (
            <div className="mt-1 text-[11px] font-medium text-blue-700/70 dark:text-blue-300/70" title={simulation.modelId || undefined}>
              Modelo usado · {simulation.modelLabel}
            </div>
          )}
        </div>
        {simulation.passed !== null && (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
            simulation.passed
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
          )}>
            {simulation.passed ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {simulation.passed ? "Passou nos critérios" : "Pede revisão"}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-blue-100 bg-white p-3.5 dark:border-blue-950 dark:bg-gray-900">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">O que a Lia responderia</div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-100">
          {simulation.reply || "A Lia não enviaria uma mensagem neste momento."}
        </p>
      </div>

      <ActionComparison simulation={simulation} />

      {simulation.checks.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-white p-3.5 dark:border-blue-950 dark:bg-gray-900">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Checagem automática</div>
          <div className="space-y-2">
            {simulation.checks.map((check, index) => (
              <div key={`${check.label}-${index}`} className="flex items-start gap-2 text-sm">
                {check.passed ? (
                  <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />
                )}
                <div>
                  <span className="font-medium text-gray-800 dark:text-gray-100">{check.label}</span>
                  {check.detail && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{check.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function flowStateSignature(result: SimulationResult): string {
  const state = result.flowState;
  if (!state) return "";
  return [state.currentStep, state.nextStep || "", ...state.completedSteps].join("|");
}

function VariationPanel({ variations, steps }: {
  variations: SimulationResult[];
  steps: FlowStep[];
}) {
  if (variations.length === 0) return null;
  const first = variations[0];
  const hasFlowEvidence = variations.every((item) => Boolean(item.flowState));
  const sameAction = variations.every((item) => (
    actionSignature(item.actualAction) === actionSignature(first.actualAction)
  ));
  const sameStage = !hasFlowEvidence || variations.every((item) => (
    flowStateSignature(item) === flowStateSignature(first)
  ));
  const sameDecision = sameAction && sameStage;
  const allPassed = variations.every((item) => item.passed !== false);
  const variationSafe = sameDecision && allPassed;
  const wordingChanged = new Set(variations.map((item) => item.reply.trim())).size > 1;
  const stableLabel = hasFlowEvidence
    ? wordingChanged ? "Redação variou; etapa e decisão se mantiveram" : "Etapa e decisão se mantiveram"
    : wordingChanged ? "Redação variou; decisão se manteve" : "Decisão se manteve";
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h5 className="text-sm font-bold text-violet-950 dark:text-violet-100">Variações do mesmo momento</h5>
          <p className="mt-0.5 text-xs text-violet-700/80 dark:text-violet-300/80">
            A Lia pode escrever de formas diferentes sem perder o próximo passo.
          </p>
        </div>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold",
          variationSafe
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        )}>
          {variationSafe ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {variationSafe
            ? stableLabel
            : sameDecision ? "Etapa estável; o tom pede revisão" : "A etapa ou decisão variou"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {variations.map((variation, index) => (
          <article key={variation.simulationId ?? index} className="min-w-0 rounded-xl border border-violet-100 bg-white p-3 dark:border-violet-950 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-violet-500">Resposta {index + 1}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                {variation.passed !== null && (
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                    variation.passed
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                  )}>
                    {variation.passed ? "Aprovada" : "Revisar"}
                  </span>
                )}
                {variation.modelLabel && (
                  <span className="truncate text-[9px] text-gray-400" title={variation.modelId || undefined}>{variation.modelLabel}</span>
                )}
              </div>
            </div>
            <p className="mt-2 break-words text-xs leading-relaxed text-gray-700 dark:text-gray-200">
              {variation.reply || "A Lia não enviaria texto neste momento."}
            </p>
            <div className="mt-3 border-t border-gray-100 pt-2 text-[10px] dark:border-gray-800">
              <div className="font-semibold text-gray-700 dark:text-gray-200">{actionLabel(variation.actualAction)}</div>
              {variation.flowState && (
                <div className="mt-0.5 text-gray-400">
                  Etapa: {flowStepLabel(steps, variation.flowState.currentStep)}
                </div>
              )}
              {variation.passed === false && (
                <div className="mt-1.5 leading-relaxed text-amber-700 dark:text-amber-300">
                  {variation.checks.find((check) => !check.passed)?.detail
                    || variation.checks.find((check) => !check.passed)?.label
                    || "Esta redação precisa da sua avaliação."}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RulesPanel({
  rules,
  busyRule,
  onToggle,
}: {
  rules: LearningRule[];
  busyRule: string | null;
  onToggle: (rule: LearningRule) => void;
}) {
  if (rules.length === 0) return null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
            <BookOpenCheck size={17} className="text-gold-600 dark:text-gold-400" />
            Aprendizados ativos
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Orientações que a Lia usa nas próximas conversas.
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {rules.map((rule) => {
          const key = String(rule.id);
          const isBusy = busyRule === key;
          return (
            <div key={key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className={cn(
                "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                rule.active ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600",
              )} />
              <div className="min-w-0 flex-1">
                <p className={cn(
                  "text-sm leading-relaxed",
                  rule.active
                    ? "text-gray-800 dark:text-gray-100"
                    : "text-gray-400 dark:text-gray-500",
                )}>
                  {rule.text}
                </p>
                {rule.category && (
                  <p className="mt-0.5 text-[11px] text-gray-400">{rule.category}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggle(rule)}
                disabled={isBusy}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                {isBusy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : rule.active ? (
                  <CirclePause size={13} />
                ) : (
                  <CirclePlay size={13} />
                )}
                {rule.active ? "Pausar" : "Reativar"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AgentLearningLab({ demoMode = false }: AgentLearningLabProps) {
  const queryDemo = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("learning-demo") === "1";
  const isDemo = import.meta.env.DEV && (demoMode || queryDemo);
  const apiBase = isDemo ? "/api/dev/agent-learning" : "/api/agent/learning";
  const [summary, setSummary] = useState<LearningSummary>(EMPTY_SUMMARY);
  const [cases, setCases] = useState<LearningCase[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SimulationResult>>({});
  const [variations, setVariations] = useState<Record<string, SimulationResult[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [simulatingKey, setSimulatingKey] = useState<string | null>(null);
  const [varyingKey, setVaryingKey] = useState<string | null>(null);
  const [variationProgress, setVariationProgress] = useState(0);
  const [bulk, setBulk] = useState<BulkProgress>(EMPTY_BULK);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [labSection, setLabSection] = useState<"replay" | "cases">("replay");

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = isDemo
      ? await fetch(`${apiBase}${path}`, {
          ...options,
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        })
      : await authFetch(`${apiBase}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    const message = firstString(asRecord(data), ["error", "message"]);
    throw new Error(message || "Não foi possível concluir esta ação.");
  }, [apiBase, isDemo]);

  const loadLab = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [summaryData, casesData] = await Promise.all([
        request("/summary"),
        request("/cases?limit=30&offset=0"),
      ]);
      const caseRecord = asRecord(casesData);
      const rawCases = Array.isArray(caseRecord.items)
        ? caseRecord.items
        : Array.isArray(casesData) ? casesData : [];
      const nextCases = rawCases.map(normalizeCase);
      setSummary(normalizeSummary(summaryData));
      setCases(nextCases);
      setSelectedKey((current) => (
        current && nextCases.some((item) => item.key === current)
          ? current
          : nextCases[0]?.key ?? null
      ));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível abrir o laboratório.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadLab();
  }, [loadLab]);

  const selectedCase = useMemo(
    () => cases.find((item) => item.key === selectedKey) ?? null,
    [cases, selectedKey],
  );
  const selectedSimulation = selectedCase ? results[selectedCase.key] : undefined;
  const selectedVariations = selectedCase ? variations[selectedCase.key] ?? [] : [];

  function selectCase(learningCase: LearningCase) {
    setSelectedKey(learningCase.key);
    setActionError(null);
  }

  async function simulateCase(learningCase: LearningCase): Promise<SimulationResult> {
    const data = await request("/simulate", {
      method: "POST",
      body: JSON.stringify({ case_id: learningCase.apiId }),
    });
    return normalizeSimulation(data);
  }

  async function runOne(learningCase: LearningCase) {
    setSimulatingKey(learningCase.key);
    setActionError(null);
    try {
      const result = await simulateCase(learningCase);
      setResults((current) => ({ ...current, [learningCase.key]: result }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível simular este caso.");
    } finally {
      setSimulatingKey(null);
    }
  }

  async function runVariations(learningCase: LearningCase) {
    setVaryingKey(learningCase.key);
    setVariationProgress(0);
    setActionError(null);
    const generated: SimulationResult[] = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        const result = await simulateCase(learningCase);
        generated.push(result);
        setVariationProgress(index + 1);
      }
      setVariations((current) => ({ ...current, [learningCase.key]: generated }));
      setResults((current) => ({ ...current, [learningCase.key]: generated.at(-1) as SimulationResult }));
    } catch (error) {
      if (generated.length > 0) {
        setVariations((current) => ({ ...current, [learningCase.key]: generated }));
      }
      setActionError(error instanceof Error ? error.message : "Não foi possível concluir as três variações.");
    } finally {
      setVaryingKey(null);
    }
  }

  function addBulkResult(current: BulkProgress, result: SimulationResult): BulkProgress {
    return {
      ...current,
      completed: current.completed + 1,
      passed: current.passed + (result.passed === true ? 1 : 0),
      failed: current.failed + (result.passed === false ? 1 : 0),
      unscored: current.unscored + (result.passed === null ? 1 : 0),
    };
  }

  async function runAllCases() {
    setBulk({ ...EMPTY_BULK, running: true, total: cases.length });
    setActionError(null);
    for (const learningCase of cases) {
      try {
        const result = await simulateCase(learningCase);
        setResults((current) => ({ ...current, [learningCase.key]: result }));
        setBulk((current) => addBulkResult(current, result));
      } catch {
        setBulk((current) => ({
          ...current,
          completed: current.completed + 1,
          unscored: current.unscored + 1,
        }));
      }
    }
    setBulk((current) => ({ ...current, running: false }));
  }

  function handleFeedbackSaved(decision: "approve" | "correct", appliedRule: boolean) {
    if (!selectedCase) return;
    const nextStatus = statusAfterDecision(decision);
    setCases((current) => current.map((item) => (
      item.key === selectedCase.key
        ? { ...item, status: nextStatus }
        : item
    )));
    setSummary((current) => ({
      ...current,
      counts: countsAfterReview(current.counts, selectedCase.status, nextStatus),
    }));
    if (appliedRule) setTimeout(() => void loadLab(), 500);
  }

  async function toggleRule(rule: LearningRule) {
    const key = String(rule.id);
    setBusyRule(key);
    setActionError(null);
    try {
      await request(`/rules/${encodeURIComponent(key)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !rule.active }),
      });
      setSummary((current) => {
        const rules = current.rules.map((item) => (
          String(item.id) === key ? { ...item, active: !item.active } : item
        ));
        return {
          ...current,
          rules,
          activeRuleCount: rules.filter((item) => item.active).length,
        };
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível alterar este aprendizado.");
    } finally {
      setBusyRule(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-gray-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gold-500/10">
              <BrainCircuit size={23} className="text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">Laboratório de Aprendizado</h2>
                {isDemo && (
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                    Demonstração local
                  </span>
                )}
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                Primeiro, coloque a Lia à prova nas conversas completas que realmente viraram venda. Depois, use os casos rápidos para corrigir situações específicas e ensinar o padrão certo.
              </p>
            </div>
          </div>
          <div className="inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ShieldCheck size={13} /> Nada vai ao WhatsApp
          </div>
        </div>
      </section>

      <nav className="grid grid-cols-2 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm dark:border-gray-800 dark:bg-gray-900" aria-label="Áreas do laboratório">
        <button
          type="button"
          onClick={() => setLabSection("replay")}
          aria-pressed={labSection === "replay"}
          className={cn(
            "flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition-colors",
            labSection === "replay"
              ? "bg-[#075e54] text-white shadow-sm"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white",
          )}
        >
          <MessageCircle size={17} />
          <span>Conversas reais</span>
        </button>
        <button
          type="button"
          onClick={() => setLabSection("cases")}
          aria-pressed={labSection === "cases"}
          className={cn(
            "flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition-colors",
            labSection === "cases"
              ? "bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white",
          )}
        >
          <FlaskConical size={17} />
          <span>Casos rápidos</span>
          {summary.counts.pending > 0 && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px]",
              labSection === "cases" ? "bg-white/15 text-white dark:bg-black/10 dark:text-gray-900" : "bg-amber-100 text-amber-700",
            )}>
              {summary.counts.pending}
            </span>
          )}
        </button>
      </nav>

      {labSection === "replay" ? (
        <AgentConversationReplay demoMode={isDemo} />
      ) : loadError ? (
        <div className="flex flex-col items-center rounded-2xl border border-red-200 bg-red-50 px-5 py-10 text-center dark:border-red-900 dark:bg-red-950/20">
          <AlertCircle size={28} className="mb-3 text-red-500" />
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadLab()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-gray-900 dark:text-red-300"
          >
            <RefreshCw size={15} /> Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard value={summary.activeRuleCount} label="Aprendizados ativos" detail="valendo nas próximas conversas" />
            <StatCard value={summary.counts.approved} label="Respostas aprovadas" detail="bons exemplos confirmados" />
            <StatCard value={summary.counts.corrected} label="Correções feitas" detail="ajustes ensinados por você" />
            <StatCard value={summary.counts.pending} label="Para revisar" detail="casos aguardando sua análise" />
          </div>

          <RulesPanel rules={summary.rules} busyRule={busyRule} onToggle={toggleRule} />

          {actionError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
              <AlertCircle size={17} className="mt-0.5 flex-shrink-0" /> {actionError}
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Casos históricos</h3>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {cases.length} de {summary.counts.total || cases.length} casos carregados · dados pessoais ocultos
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runAllCases()}
                disabled={bulk.running || cases.length === 0 || Boolean(simulatingKey) || Boolean(varyingKey)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {bulk.running ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
                {bulk.running ? `Testando ${bulk.completed + 1} de ${bulk.total}` : "Testar todos os casos"}
              </button>
            </div>

            {(bulk.running || bulk.completed > 0) && (
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/40 sm:px-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {bulk.running ? "Conferindo em sequência…" : "Placar da simulação"}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    <strong className="text-emerald-600 dark:text-emerald-400">{bulk.passed} passaram</strong>
                    {" · "}<strong className="text-amber-600 dark:text-amber-400">{bulk.failed} pedem revisão</strong>
                    {bulk.unscored > 0 && ` · ${bulk.unscored} sem nota`}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
                  role="progressbar"
                  aria-valuenow={bulk.completed}
                  aria-valuemin={0}
                  aria-valuemax={bulk.total}
                >
                  <div
                    className="h-full rounded-full bg-gold-500 transition-all"
                    style={{ width: `${bulk.total > 0 ? (bulk.completed / bulk.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {cases.length === 0 ? (
              <div className="flex flex-col items-center px-5 py-16 text-center">
                <MessageCircle size={34} className="mb-3 text-gray-300 dark:text-gray-700" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nenhum caso disponível agora</p>
                <p className="mt-1 max-w-sm text-xs text-gray-400 dark:text-gray-500">
                  Quando houver atendimentos históricos preparados, eles aparecerão aqui sem os dados pessoais do cliente.
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.45fr)]">
                <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain border-b border-gray-100 p-2 dark:border-gray-800 md:block md:max-h-[760px] md:overflow-y-auto md:border-b-0 md:border-r">
                  {cases.map((learningCase, index) => {
                    const status = STATUS_STYLE[learningCase.status];
                    const result = results[learningCase.key];
                    return (
                      <button
                        key={learningCase.key}
                        type="button"
                        onClick={() => selectCase(learningCase)}
                        aria-pressed={selectedKey === learningCase.key}
                        className={cn(
                          "flex min-w-[260px] max-w-[300px] flex-shrink-0 items-start gap-3 rounded-xl p-3 text-left transition-colors md:mb-1 md:w-full md:min-w-0 md:max-w-none md:last:mb-0",
                          selectedKey === learningCase.key
                            ? "bg-gold-500/10"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/60",
                        )}
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="mb-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-gray-900 dark:text-white">{learningCase.title}</span>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", status.className)}>
                              {status.label}
                            </span>
                            {learningCase.flowSteps.length > 0 && (
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                {learningCase.flowSteps.length} etapas
                              </span>
                            )}
                            {result?.passed !== null && result && (
                              <span className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                result.passed
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400",
                              )}>
                                {result.passed ? "Passou" : "Revisar"}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {casePreview(learningCase)}
                          </span>
                        </span>
                        <ChevronRight size={15} className="mt-2 flex-shrink-0 text-gray-300 dark:text-gray-600" />
                      </button>
                    );
                  })}
                </div>

                {selectedCase && (
                  <div className="min-w-0 scroll-mt-4 space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                          Caso selecionado
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] normal-case tracking-normal text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Situação real anonimizada
                          </span>
                        </div>
                        <h4 className="mt-1 font-bold text-gray-900 dark:text-white">{selectedCase.title}</h4>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void runOne(selectedCase)}
                          disabled={bulk.running || Boolean(simulatingKey) || Boolean(varyingKey)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-gold-600 disabled:opacity-50"
                        >
                          {simulatingKey === selectedCase.key ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          Simular este caso
                        </button>
                        <button
                          type="button"
                          onClick={() => void runVariations(selectedCase)}
                          disabled={bulk.running || Boolean(simulatingKey) || Boolean(varyingKey)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                          {varyingKey === selectedCase.key ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
                          {varyingKey === selectedCase.key
                            ? `Variação ${Math.min(variationProgress + 1, 3)} de 3`
                            : "Testar variações"}
                        </button>
                      </div>
                    </div>

                    <FlowJourney steps={selectedCase.flowSteps} state={selectedSimulation?.flowState ?? null} />

                    <Transcript learningCase={selectedCase} />

                    {selectedSimulation && (
                      <>
                        <EvaluationPanel simulation={selectedSimulation} />
                        <VariationPanel variations={selectedVariations} steps={selectedCase.flowSteps} />
                        <AgentLearningFeedback
                          key={`${selectedCase.key}-${selectedSimulation.simulationId ?? "simulation"}`}
                          demoMode={isDemo}
                          context={{
                            caseId: selectedCase.apiId,
                            simulationId: selectedSimulation.simulationId,
                            assistantResult: selectedSimulation.reply,
                          }}
                          onSaved={handleFeedbackSaved}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
