import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  EyeOff,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";

type JsonRecord = Record<string, unknown>;

interface ReplayCase {
  id: string;
  niche: string;
  convertedAt: string | null;
  messageCount: number;
  durationDays: number | null;
  customerTurns: number;
}

interface ReplayCheck {
  label: string;
  passed: boolean;
  detail: string | null;
}

interface ReplayFlowState {
  currentStep: string | null;
  nextStep: string | null;
  completedSteps: string[];
  returnToFlow: boolean;
}

interface ReplayTurn {
  index: number;
  customerMessages: string[];
  humanMessages: string[];
  aiReply: string;
  aiAction: unknown;
  expectedAction: unknown;
  flowState: ReplayFlowState | null;
  checks: ReplayCheck[];
  passed: boolean | null;
}

interface ReplayTotals {
  total: number;
  passed: number;
  failed: number;
  unscored: number;
}

interface ReplayResult {
  modelId: string | null;
  modelLabel: string;
  summary: string;
  warning: string | null;
  executed: boolean;
  turns: ReplayTurn[];
  totals: ReplayTotals;
}

export interface AgentConversationReplayProps {
  className?: string;
  demoMode?: boolean;
}

interface ReplayCoverage {
  strictSales: number;
  eligibleEpisodes: number;
}

interface ReplayProviderStatus {
  configured: boolean;
  available: boolean;
  modelLabel: string;
  message: string;
}

const EMPTY_TOTALS: ReplayTotals = { total: 0, passed: 0, failed: 0, unscored: 0 };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      return firstString(asRecord(item), ["content", "text", "body", "message"]);
    })
    .filter(Boolean)
    .map(redactPersonalData);
}

// O servidor já entrega episódios anonimizados. Esta segunda barreira evita que
// algum campo legado exponha acidentalmente telefone, documento ou contato.
function redactPersonalData(value: string): string {
  return String(value || "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link oculto]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail oculto]")
    .replace(/(^|\s)@[A-Za-z0-9._-]{2,}/g, "$1[perfil oculto]")
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, "[documento oculto]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]*\d{4}\b/g, "[telefone oculto]")
    .replace(/\b\d{2}[/-]\d{2}[/-]\d{2,4}\b/g, "[data ocultada]")
    .replace(/(?:\d[\s()./-]*){11,}/g, "[dado oculto]");
}

function normalizeCase(value: unknown, index: number): ReplayCase {
  const record = asRecord(value);
  const duration = finiteNumber(record.duration_days ?? record.durationDays);
  return {
    id: firstString(record, ["id", "case_id", "caseId"]) || `case-${index + 1}`,
    niche: firstString(record, ["niche", "nicho", "category"]) || "Atendimento",
    convertedAt: firstString(record, ["converted_at", "convertedAt"]) || null,
    messageCount: finiteNumber(record.message_count ?? record.messageCount) ?? 0,
    durationDays: duration,
    customerTurns: finiteNumber(record.customer_turns ?? record.customerTurns) ?? 0,
  };
}

function normalizeCheck(value: unknown, index: number): ReplayCheck {
  const record = asRecord(value);
  return {
    label: firstString(record, ["label", "name", "criterion"]) || `Critério ${index + 1}`,
    passed: record.passed === true || record.ok === true,
    detail: redactPersonalData(firstString(record, ["detail", "reason", "message"])) || null,
  };
}

function normalizeFlowState(value: unknown): ReplayFlowState | null {
  const record = asRecord(value);
  const currentStep = firstString(record, ["current_step", "currentStep"]);
  const nextStep = firstString(record, ["next_step", "nextStep"]);
  const completedSteps = stringList(record.completed_steps ?? record.completedSteps);
  if (!currentStep && !nextStep && completedSteps.length === 0) return null;
  return {
    currentStep: currentStep || null,
    nextStep: nextStep || null,
    completedSteps,
    returnToFlow: record.return_to_flow === true || record.returnToFlow === true,
  };
}

function normalizeTurn(value: unknown, index: number): ReplayTurn {
  const record = asRecord(value);
  const checks = Array.isArray(record.checks)
    ? record.checks.map(normalizeCheck)
    : [];
  const explicitPassed = record.passed;
  const passed = typeof explicitPassed === "boolean"
    ? explicitPassed
    : checks.length > 0
      ? checks.every((check) => check.passed)
      : null;
  return {
    index: finiteNumber(record.index) ?? index + 1,
    customerMessages: stringList(record.customer_messages ?? record.customerMessages),
    humanMessages: stringList(record.human_messages ?? record.humanMessages),
    aiReply: redactPersonalData(firstString(record, ["ai_reply", "aiReply", "reply"])),
    aiAction: record.ai_action ?? record.aiAction ?? record.action ?? null,
    expectedAction: record.expected_action ?? record.expectedAction ?? null,
    flowState: normalizeFlowState(record.flow_state ?? record.flowState),
    checks,
    passed,
  };
}

function totalsFromTurns(turns: ReplayTurn[]): ReplayTotals {
  return turns.reduce<ReplayTotals>((totals, turn) => {
    totals.total += 1;
    if (turn.passed === true) totals.passed += 1;
    else if (turn.passed === false) totals.failed += 1;
    else totals.unscored += 1;
    return totals;
  }, { ...EMPTY_TOTALS });
}

function normalizeTotals(value: unknown, turns: ReplayTurn[]): ReplayTotals {
  const record = asRecord(value);
  const derived = totalsFromTurns(turns);
  return {
    total: finiteNumber(record.total ?? record.turns) ?? derived.total,
    passed: finiteNumber(record.passed ?? record.approved) ?? derived.passed,
    failed: finiteNumber(record.failed ?? record.reproved) ?? derived.failed,
    unscored: finiteNumber(record.unscored ?? record.pending) ?? derived.unscored,
  };
}

function normalizeModel(record: JsonRecord): { id: string | null; label: string } {
  const model = asRecord(record.model);
  const directModel = typeof record.model === "string" ? record.model : "";
  const id = firstString(model, ["id", "model_id"])
    || firstString(record, ["model_id", "modelId"])
    || directModel;
  const label = firstString(model, ["label", "name"])
    || (id === "claude-sonnet-4-6" ? "Claude Sonnet 4.6" : id);
  return { id: id || null, label: label || "Modelo não informado" };
}

function summaryText(value: unknown): string {
  if (typeof value === "string") return redactPersonalData(value.trim());
  const record = asRecord(value);
  return redactPersonalData(firstString(record, ["text", "message", "overview", "summary"]));
}

function normalizeReplay(value: unknown): ReplayResult {
  const record = asRecord(value);
  const source = Array.isArray(record.turns) ? record.turns : [];
  const turns = source.map(normalizeTurn);
  const model = normalizeModel(record);
  return {
    modelId: model.id,
    modelLabel: model.label,
    summary: summaryText(record.summary),
    warning: redactPersonalData(firstString(record, ["warning"])) || null,
    executed: record.executed !== false,
    turns,
    totals: normalizeTotals(record.totals, turns),
  };
}

function coverageFromResponse(value: unknown): ReplayCoverage {
  const record = asRecord(value);
  return {
    strictSales: finiteNumber(record.strict_sales ?? record.strictSales) ?? 0,
    eligibleEpisodes: finiteNumber(record.eligible_episodes ?? record.eligibleEpisodes) ?? 0,
  };
}

function providerStatusFromResponse(value: unknown): ReplayProviderStatus {
  const record = asRecord(value);
  return {
    configured: record.configured === true,
    available: record.available === true,
    modelLabel: firstString(record, ["modelLabel", "model_label"]) || "OpenAI",
    message: firstString(record, ["message"]) || "Não foi possível confirmar a credencial OpenAI.",
  };
}

function casesFromResponse(value: unknown): ReplayCase[] {
  const record = asRecord(value);
  const source = Array.isArray(value)
    ? value
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.cases)
        ? record.cases
        : [];
  return source.map(normalizeCase);
}

function errorMessage(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return firstString(record, ["error", "message"]) || fallback;
}

function formatNiche(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const FLOW_STAGE_LABELS: Record<string, string> = {
  niche: "Entender qual ensaio a cliente procura",
  lifecycle: "Confirmar semanas da gestação ou dias do bebê",
  creative_intent: "Entender como ela imaginou registrar esse momento",
  trust_asset: "Descobrir se conhece o trabalho e mostrar referências",
  portfolio: "Mostrar trabalhos alinhados ao que ela procura",
  schedule_preference: "Entender a preferência entre semana ou sábado",
  quote_sent: "Enviar os pacotes para ela escolher",
  budget: "Enviar os pacotes para ela escolher",
  buying_signal: "Perceber que ela quer fechar ou consultar uma data",
  handoff: "Chamar uma pessoa para assumir",
};

function flowStageLabel(value: string | null): string {
  if (!value) return "Fluxo concluído";
  return FLOW_STAGE_LABELS[value.toLowerCase()] || formatNiche(value);
}

function formatConvertedAt(value: string | null): string {
  if (!value) return "Venda convertida";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Venda convertida";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function actionParts(value: unknown): { title: string; detail: string | null } {
  if (typeof value === "string") return { title: formatNiche(value), detail: null };
  const record = asRecord(value);
  const type = firstString(record, ["type", "action", "name", "decision"]);
  const reason = firstString(record, ["reason", "motivo"]);
  const niche = firstString(record, ["niche", "nicho"]);
  const titles: Record<string, string> = {
    reply: "Responder",
    handoff: "Chamar uma pessoa",
    orcamento: "Enviar orçamento",
    budget: "Enviar orçamento",
    portfolio: "Mostrar referências",
    wait: "Aguardar cliente",
    human_active: "Humano já assumiu",
  };
  return {
    title: titles[type.toLowerCase()] || (type ? formatNiche(type) : "Não informado"),
    detail: reason ? formatNiche(reason) : niche ? formatNiche(niche) : null,
  };
}

function Metric({ icon: Icon, value, label }: {
  icon: typeof MessageCircle;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-950/60">
      <Icon size={15} className="flex-shrink-0 text-gray-400" />
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-gray-900 dark:text-white">{value}</div>
        <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      </div>
    </div>
  );
}

function CaseSelector({
  cases,
  selected,
  onChange,
}: {
  cases: ReplayCase[];
  selected: ReplayCase;
  onChange: (id: string) => void;
}) {
  const selectedIndex = cases.findIndex((item) => item.id === selected.id);
  const move = (offset: number) => {
    const next = cases[selectedIndex + offset];
    if (next) onChange(next.id);
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Conversa convertida
          </span>
          <select
            value={selected.id}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-gold-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
          >
            {cases.map((item, index) => (
              <option key={item.id} value={item.id}>
                Caso {index + 1} · {formatNiche(item.niche)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2" aria-label="Navegar entre casos">
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={selectedIndex <= 0}
            aria-label="Caso anterior"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={selectedIndex >= cases.length - 1}
            aria-label="Próximo caso"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric icon={Sparkles} value={formatNiche(selected.niche)} label="Tipo de ensaio" />
        <Metric icon={MessageCircle} value={selected.messageCount} label="Mensagens" />
        <Metric icon={MessagesSquare} value={selected.customerTurns} label="Turnos do cliente" />
        <Metric
          icon={selected.durationDays === null ? CalendarDays : Clock3}
          value={selected.durationDays === null ? formatConvertedAt(selected.convertedAt) : `${selected.durationDays} dia${selected.durationDays === 1 ? "" : "s"}`}
          label={selected.durationDays === null ? "Período anonimizado" : "Até a conversão"}
        />
      </div>
    </div>
  );
}

function MessageStack({ title, icon: Icon, messages, tone, emptyText }: {
  title: string;
  icon: typeof UserRound;
  messages: string[];
  tone: "customer" | "human" | "ai";
  emptyText?: string;
}) {
  const styles = {
    customer: "border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100",
    human: "border-blue-100 bg-blue-50/70 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-100",
    ai: "border-amber-100 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100",
  };
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
        <Icon size={14} /> {title}
      </div>
      <div className="space-y-2">
        {messages.length > 0 ? messages.map((message, index) => (
          <div
            key={`${tone}-${index}`}
            className={cn("whitespace-pre-wrap break-words rounded-xl border px-3 py-2.5 text-sm leading-relaxed", styles[tone])}
          >
            {message}
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {emptyText || (tone === "ai" ? "Aguardando a execução da Lia." : "Nenhuma mensagem neste lado do turno.")}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionComparison({ expected, actual }: { expected: unknown; actual: unknown }) {
  const expectedAction = actionParts(expected);
  const actualAction = actionParts(actual);
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
      <div className="rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-950/60">
        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Esperado</div>
        <div className="mt-0.5 text-sm font-bold text-gray-800 dark:text-gray-100">{expectedAction.title}</div>
        {expectedAction.detail && <div className="text-xs text-gray-500 dark:text-gray-400">{expectedAction.detail}</div>}
      </div>
      <ArrowRight size={16} className="hidden self-center text-gray-300 sm:block" />
      <div className="rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-950/60">
        <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Decisão da Lia</div>
        <div className="mt-0.5 text-sm font-bold text-gray-800 dark:text-gray-100">{actualAction.title}</div>
        {actualAction.detail && <div className="text-xs text-gray-500 dark:text-gray-400">{actualAction.detail}</div>}
      </div>
    </div>
  );
}

function FlowState({ state }: { state: ReplayFlowState }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gray-700 dark:text-gray-200">Condução do fluxo</span>
        {state.returnToFlow && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            Retomou o roteiro
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {state.currentStep && (
          <span className="rounded-lg bg-gray-100 px-2 py-1 font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            Agora: {formatNiche(state.currentStep)}
          </span>
        )}
        {state.nextStep && (
          <>
            <ArrowRight size={13} className="text-gray-300" />
            <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Depois: {formatNiche(state.nextStep)}
            </span>
          </>
        )}
      </div>
      {state.completedSteps.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          Já concluído: {state.completedSteps.map(formatNiche).join(" · ")}
        </p>
      )}
    </div>
  );
}

function CheckList({ checks }: { checks: ReplayCheck[] }) {
  if (checks.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500">Este turno não trouxe critérios de avaliação.</p>;
  }
  return (
    <ul className="space-y-2">
      {checks.map((check, index) => (
        <li key={`${check.label}-${index}`} className="flex items-start gap-2 text-sm">
          {check.passed
            ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />
            : <XCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />}
          <div className="min-w-0">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{check.label}</span>
            {check.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-500 dark:text-gray-400">{check.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TurnCard({ turn }: { turn: ReplayTurn }) {
  const aiMessages = turn.aiReply ? [turn.aiReply] : [];
  const humanActive = actionParts(turn.aiAction).title === "Humano já assumiu";
  const status = turn.passed === true
    ? { label: "Passou", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" }
    : turn.passed === false
      ? { label: "Precisa melhorar", icon: XCircle, className: "bg-red-50 text-red-700 dark:bg-red-950/35 dark:text-red-300" }
      : { label: "Aguardando Lia", icon: Clock3, className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" };
  const StatusIcon = status.icon;
  return (
    <article className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Turno</p>
          <h4 className="text-base font-extrabold text-gray-900 dark:text-white">{turn.index}</h4>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", status.className)}>
          <StatusIcon size={13} /> {status.label}
        </span>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        <MessageStack title="Cliente" icon={UserRound} messages={turn.customerMessages} tone="customer" />

        <div className="grid gap-4 lg:grid-cols-2">
          <MessageStack title="Atendimento humano original" icon={MessageCircle} messages={turn.humanMessages} tone="human" />
          <MessageStack
            title="Resposta da Lia no replay"
            icon={Bot}
            messages={aiMessages}
            tone="ai"
            emptyText={humanActive ? "A Lia ficou em silêncio porque uma pessoa já havia assumido." : undefined}
          />
        </div>

        <ActionComparison expected={turn.expectedAction} actual={turn.aiAction} />
        {turn.flowState && <FlowState state={turn.flowState} />}

        <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
          <h5 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">Verificação deste turno</h5>
          <CheckList checks={turn.checks} />
        </div>
      </div>
    </article>
  );
}

function ReplayOverview({ result }: { result: ReplayResult }) {
  const scored = result.totals.passed + result.totals.failed;
  const score = result.executed && scored > 0 ? Math.round((result.totals.passed / scored) * 100) : null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <Bot size={13} /> {result.modelLabel}
            </span>
            {result.modelId && <span className="text-[11px] text-gray-400">{result.modelId}</span>}
          </div>
          <h3 className="mt-3 text-lg font-extrabold text-gray-900 dark:text-white">
            {result.executed ? "Resultado da conversa completa" : "Conversa real pronta para comparação"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {result.summary || "Cada resposta foi comparada ao atendimento que resultou em venda e às regras atuais da Lia."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 lg:min-w-[300px]">
          <Metric icon={CheckCircle2} value={result.totals.passed} label="Passaram" />
          <Metric icon={XCircle} value={result.totals.failed} label="Falharam" />
          <Metric icon={MessagesSquare} value={result.totals.total} label="Turnos" />
        </div>
      </div>

      <div className="mt-4" aria-label={score === null ? "Replay sem nota" : `${score}% dos turnos avaliados passaram`}>
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-600 dark:text-gray-300">{result.executed ? "Aderência à condução" : "Status do replay"}</span>
          <span className="font-bold text-gray-900 dark:text-white">{score === null ? "Aguardando execução" : `${score}%`}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", result.totals.failed > 0 ? "bg-amber-500" : "bg-emerald-500")}
            style={{ width: `${score ?? 0}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function LoadingReplay() {
  return (
    <div role="status" className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
        <Loader2 size={24} className="animate-spin" />
      </div>
      <h3 className="mt-4 text-base font-extrabold text-gray-900 dark:text-white">Reproduzindo a conversa</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
        A Lia está respondendo cada turno com o contexto disponível naquele momento. Nada será enviado ao WhatsApp.
      </p>
      <div className="mx-auto mt-5 h-1.5 max-w-md overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-gold-500" />
      </div>
    </div>
  );
}

type ReplayViewMode = "human" | "ai";

function statusPresentation(turn: ReplayTurn, executed: boolean) {
  if (!executed) return {
    label: "Conversa original",
    description: "Este é o atendimento humano que terminou em venda.",
    className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  };
  if (turn.passed === true) return {
    label: "Condução correta",
    description: "A Lia manteve o mesmo objetivo comercial com uma resposta segura.",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  };
  if (turn.passed === false) return {
    label: "Precisa de ajuste",
    description: "A resposta da Lia se afastou do caminho que queremos ensinar.",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  };
  return {
    label: "Humano assumiu",
    description: "A Lia parou de responder porque este momento pede atendimento humano.",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  };
}

function ReplayConversationList({
  cases,
  selectedId,
  onSelect,
}: {
  cases: ReplayCase[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="hidden min-h-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:flex">
      <div className="border-b border-gray-200 bg-[#f0f2f5] px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] text-white">
            <MessageCircle size={19} />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Vendas reais</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Escolha uma conversa</p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {cases.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={selectedId === item.id}
            className={cn(
              "flex w-full items-start gap-3 border-b border-gray-100 px-3 py-3.5 text-left transition-colors dark:border-gray-900",
              selectedId === item.id
                ? "bg-[#f0f2f5] dark:bg-gray-900"
                : "hover:bg-gray-50 dark:hover:bg-gray-900/60",
            )}
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#d9fdd3] to-[#9de7d7] text-sm font-extrabold text-[#075e54]">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-gray-900 dark:text-white">{formatNiche(item.niche)}</span>
                <span className="flex-shrink-0 text-[10px] text-gray-400">{item.messageCount} msgs</span>
              </span>
              <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                {item.customerTurns} momentos da cliente · venda confirmada
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ChatBubble({
  children,
  side,
  selected = false,
  status,
}: {
  children: string;
  side: "client" | "studio";
  selected?: boolean;
  status?: boolean | null;
}) {
  const studio = side === "studio";
  return (
    <div className={cn("flex", studio ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[86%] sm:max-w-[76%]", studio ? "items-end" : "items-start")}>
        <div className={cn(
          "relative whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-[1.45] shadow-sm sm:text-sm",
          studio
            ? "rounded-[8px] rounded-tr-[2px] bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-gray-50"
            : "rounded-[8px] rounded-tl-[2px] bg-white text-[#111b21] dark:bg-[#202c33] dark:text-gray-50",
          selected && "ring-2 ring-[#00a884] ring-offset-2 ring-offset-[#efeae2] dark:ring-offset-gray-950",
          studio && status === false && "ring-2 ring-amber-400",
        )}>
          {children}
          <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[9px] text-[#667781] dark:text-gray-400">
            {studio && <CheckCircle2 size={10} className={status === false ? "text-amber-600" : "text-[#53bdeb]"} />}
          </span>
        </div>
      </div>
    </div>
  );
}

function ReplayChat({
  selectedCase,
  result,
  mode,
  onModeChange,
  selectedTurn,
  onSelectTurn,
  onExplain,
}: {
  selectedCase: ReplayCase;
  result: ReplayResult;
  mode: ReplayViewMode;
  onModeChange: (mode: ReplayViewMode) => void;
  selectedTurn: number;
  onSelectTurn: (index: number) => void;
  onExplain: () => void;
}) {
  return (
    <section className="flex min-h-[620px] min-w-0 flex-col bg-[#efeae2] dark:bg-gray-950 lg:min-h-0" data-testid="whatsapp-replay">
      <header className="flex flex-col gap-3 border-b border-gray-200 bg-[#f0f2f5] px-3 py-3 dark:border-gray-800 dark:bg-[#202c33] sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#00a884] font-extrabold text-white">L</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#111b21] dark:text-white">{formatNiche(selectedCase.niche)}</p>
            <p className="truncate text-[11px] text-[#667781] dark:text-gray-400">
              Conversa anonimizada · terminou em venda
              {result.executed && result.modelLabel ? ` · ${result.modelLabel}` : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-white/80 p-1 text-xs dark:bg-gray-950/50" aria-label="Versão da conversa">
          <button
            type="button"
            onClick={() => onModeChange("human")}
            aria-pressed={mode === "human"}
            className={cn("rounded-md px-3 py-1.5 font-bold transition-colors", mode === "human" ? "bg-white text-[#075e54] shadow-sm dark:bg-gray-800 dark:text-emerald-300" : "text-gray-500")}
          >
            Como vendeu
          </button>
          <button
            type="button"
            onClick={() => onModeChange("ai")}
            disabled={!result.executed}
            aria-pressed={mode === "ai"}
            className={cn("rounded-md px-3 py-1.5 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40", mode === "ai" ? "bg-white text-[#075e54] shadow-sm dark:bg-gray-800 dark:text-emerald-300" : "text-gray-500")}
          >
            Como a Lia faria
          </button>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-5 sm:px-5"
        style={{ backgroundImage: "radial-gradient(rgba(17,27,33,.055) 0.8px, transparent 0.8px)", backgroundSize: "11px 11px" }}
      >
        <div className="mx-auto mb-5 w-fit rounded-md bg-[#ffeecd] px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#54656f] shadow-sm">
          Conversa real · dados pessoais ocultos
        </div>
        {result.turns.map((turn) => {
          const replies = mode === "human" ? turn.humanMessages : turn.aiReply ? [turn.aiReply] : [];
          const humanActive = mode === "ai" && actionParts(turn.aiAction).title === "Humano já assumiu";
          return (
            <button
              key={turn.index}
              type="button"
              onClick={() => onSelectTurn(turn.index)}
              className="block w-full space-y-2 text-left focus:outline-none"
              aria-label={`Ver explicação do momento ${turn.index}`}
            >
              {turn.customerMessages.map((message, index) => (
                <ChatBubble key={`client-${turn.index}-${index}`} side="client" selected={selectedTurn === turn.index && index === turn.customerMessages.length - 1}>
                  {message}
                </ChatBubble>
              ))}
              {replies.map((message, index) => (
                <ChatBubble key={`reply-${turn.index}-${index}`} side="studio" selected={selectedTurn === turn.index} status={mode === "ai" ? turn.passed : null}>
                  {message}
                </ChatBubble>
              ))}
              {humanActive && (
                <div className="mx-auto w-fit rounded-lg bg-white/85 px-3 py-1.5 text-center text-[11px] font-semibold text-[#667781] shadow-sm dark:bg-gray-900/90 dark:text-gray-300">
                  A Lia chamou uma pessoa e parou de responder
                </div>
              )}
              {selectedTurn === turn.index && (
                <span className="mx-auto mt-1 hidden w-fit items-center gap-1 rounded-full bg-[#111b21]/75 px-2.5 py-1 text-[10px] font-bold text-white lg:inline-flex">
                  Ver explicação ao lado <ChevronRight size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <footer className="flex items-center gap-2 border-t border-gray-200 bg-[#f0f2f5] px-4 py-3 text-xs text-[#667781] dark:border-gray-800 dark:bg-[#202c33] dark:text-gray-400">
        <ShieldCheck size={14} className="text-[#00a884]" />
        <span className="flex-1">Este laboratório não envia nenhuma mensagem ao WhatsApp.</span>
        <button type="button" onClick={onExplain} className="font-bold text-[#008069] hover:underline lg:hidden">Entender este momento</button>
      </footer>
    </section>
  );
}

function ReplayInspector({
  turn,
  result,
  providerStatus,
  consent,
  onConsentChange,
  running,
  onRun,
}: {
  turn: ReplayTurn | null;
  result: ReplayResult;
  providerStatus: ReplayProviderStatus | null;
  consent: boolean;
  onConsentChange: (checked: boolean) => void;
  running: boolean;
  onRun: () => void;
}) {
  const presentation = turn ? statusPresentation(turn, result.executed) : null;
  const expected = actionParts(turn?.expectedAction ?? null);
  const actual = actionParts(turn?.aiAction ?? null);
  const expectedLabel = expected.title === "Responder" && turn?.flowState
    ? flowStageLabel(turn.flowState.currentStep)
    : expected.title;
  const actualLabel = actual.title === "Responder" && turn?.flowState
    ? flowStageLabel(turn.flowState.currentStep)
    : actual.title;
  const firstFailure = turn?.checks.find((check) => !check.passed);
  return (
    <aside id="replay-explanation" className="min-h-0 scroll-mt-4 overflow-y-auto border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 lg:border-l lg:border-t-0 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gray-400">Entenda este momento</p>
          <h3 className="mt-1 text-lg font-extrabold text-gray-950 dark:text-white">Momento {turn?.index ?? 1}</h3>
        </div>
        {presentation && <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", presentation.className)}>{presentation.label}</span>}
      </div>
      {presentation && <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{presentation.description}</p>}

      <div className="mt-5 space-y-3">
        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">O atendimento que vendeu fez</p>
          <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{expectedLabel}</p>
          {expected.detail && <p className="mt-0.5 text-xs text-gray-500">{expected.detail}</p>}
        </div>
        {result.executed && (
          <div className={cn("rounded-xl p-3", turn?.passed === false ? "bg-amber-50 dark:bg-amber-950/25" : "bg-emerald-50 dark:bg-emerald-950/25")}>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">A Lia decidiu</p>
            <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{actualLabel}</p>
            {actual.detail && <p className="mt-0.5 text-xs text-gray-500">{actual.detail}</p>}
          </div>
        )}
      </div>

      {turn?.flowState && (
        <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-900 dark:text-white">Onde estamos no atendimento</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Agora: <strong>{flowStageLabel(turn.flowState.currentStep)}</strong>
          </p>
          {turn.flowState.nextStep && <p className="mt-1 text-xs text-gray-500">Próximo passo: {flowStageLabel(turn.flowState.nextStep)}</p>}
        </div>
      )}

      {result.executed && turn && (
        <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-900 dark:text-white">Por que recebeu essa avaliação?</p>
          {firstFailure ? (
            <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{firstFailure.detail || firstFailure.label}</span>
            </div>
          ) : (
            <ul className="mt-2 space-y-2">
              {turn.checks.slice(0, 4).map((check, index) => (
                <li key={`${check.label}-${index}`} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" /> {check.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
        {!result.executed && (
          <>
            <label className={cn("flex items-start gap-2.5", providerStatus?.available ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => onConsentChange(event.target.checked)}
                disabled={providerStatus?.available !== true}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#00a884] focus:ring-[#00a884]"
              />
              <span className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Autorizar o envio desta conversa anonimizada à OpenAI somente para o teste.
              </span>
            </label>
            <button
              type="button"
              onClick={onRun}
              disabled={running || !consent || providerStatus?.available !== true}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#00a884] px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-[#008f72] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {running ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}
              {running ? "A Lia está atendendo…" : "Comparar com a Lia"}
            </button>
          </>
        )}
        {result.executed && (
          <div className="rounded-xl bg-gray-950 p-3 text-white dark:bg-gray-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Resultado da conversa</p>
            <p className="mt-1 text-2xl font-extrabold">{result.totals.passed}/{result.totals.passed + result.totals.failed}</p>
            <p className="text-xs text-gray-300">momentos seguiram a condução esperada</p>
          </div>
        )}
      </div>
    </aside>
  );
}

export default function AgentConversationReplay({ className, demoMode = false }: AgentConversationReplayProps) {
  const isDemo = import.meta.env.DEV && demoMode;
  const apiBase = isDemo ? "/api/dev/agent-replay" : "/api/agent/replay";
  const [cases, setCases] = useState<ReplayCase[]>([]);
  const [coverage, setCoverage] = useState<ReplayCoverage>({ strictSales: 0, eligibleEpisodes: 0 });
  const [providerStatus, setProviderStatus] = useState<ReplayProviderStatus | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [running, setRunning] = useState(false);
  const [externalConsent, setExternalConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [viewMode, setViewMode] = useState<ReplayViewMode>("human");
  const [selectedTurn, setSelectedTurn] = useState(1);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedId) || cases[0] || null,
    [cases, selectedId],
  );

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    if (isDemo) {
      return fetch(`${apiBase}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      });
    }
    return authFetch(`${apiBase}${path}`, options);
  }, [apiBase, isDemo]);

  const loadCases = useCallback(async (signal?: AbortSignal) => {
    setLoadingCases(true);
    setError(null);
    try {
      const [response, providerResponse] = await Promise.all([
        request("/cases", { signal }),
        request("/provider-status", { signal }),
      ]);
      const [data, providerData]: unknown[] = await Promise.all([
        response.json().catch(() => ({})),
        providerResponse.json().catch(() => ({})),
      ]);
      if (!response.ok) throw new Error(errorMessage(data, "Não foi possível carregar as conversas."));
      const nextCases = casesFromResponse(data);
      setCases(nextCases);
      setCoverage(coverageFromResponse(data));
      setProviderStatus(providerStatusFromResponse(providerData));
      setSelectedId((current) => nextCases.some((item) => item.id === current) ? current : nextCases[0]?.id || "");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as conversas.");
    } finally {
      if (!signal?.aborted) setLoadingCases(false);
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCases(controller.signal);
    return () => controller.abort();
  }, [loadCases]);

  useEffect(() => {
    if (!selectedCase) return;
    const controller = new AbortController();
    setLoadingTranscript(true);
    setResult(null);
    setError(null);
    void request(`/${encodeURIComponent(selectedCase.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessage(data, "Não foi possível abrir a conversa completa."));
        const normalized = normalizeReplay(data);
        setResult(normalized);
        setSelectedTurn(normalized.turns[0]?.index ?? 1);
        setViewMode(normalized.executed ? "ai" : "human");
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível abrir a conversa completa.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTranscript(false);
      });
    return () => controller.abort();
  }, [request, selectedCase]);

  function selectCase(id: string) {
    setSelectedId(id);
    setResult(null);
    setError(null);
    setExternalConsent(false);
    setViewMode("human");
    setSelectedTurn(1);
  }

  async function runReplay() {
    if (!selectedCase || running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await request(`/${encodeURIComponent(selectedCase.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_to_external_ai: externalConsent }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, "Não foi possível executar o replay."));
      const normalized = normalizeReplay(data);
      setResult(normalized);
      setSelectedTurn(normalized.turns[0]?.index ?? 1);
      setViewMode("ai");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Não foi possível executar o replay.");
    } finally {
      setRunning(false);
    }
  }

  if (loadingCases) {
    return (
      <div className={cn("flex min-h-56 items-center justify-center rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900", className)}>
        <Loader2 size={24} className="animate-spin text-gold-500" aria-label="Carregando conversas" />
      </div>
    );
  }

  const activeTurn = result?.turns.find((turn) => turn.index === selectedTurn) || result?.turns[0] || null;

  return (
    <div className={cn("space-y-4", className)}>
      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-extrabold tracking-tight text-gray-950 dark:text-white">Treino com conversas que venderam</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck size={11} /> sinal confirmado
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Leia como uma conversa normal. Clique em qualquer mensagem para entender a decisão daquele momento.
          </p>
        </div>
        {coverage.strictSales > 0 && (
          <div className="flex flex-shrink-0 items-center gap-3 text-center">
            <div><strong className="block text-lg text-gray-950 dark:text-white">{coverage.strictSales}</strong><span className="text-[10px] text-gray-400">vendas</span></div>
            <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />
            <div><strong className="block text-lg text-gray-950 dark:text-white">{coverage.eligibleEpisodes}</strong><span className="text-[10px] text-gray-400">conversas</span></div>
          </div>
        )}
      </section>

      {providerStatus && !providerStatus.available && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div><p className="font-bold">{providerStatus.modelLabel} ainda não está disponível</p><p className="mt-0.5 text-xs">{providerStatus.message}</p></div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-bold">Não foi possível concluir</p><p className="mt-0.5 break-words">{error}</p></div>
        </div>
      )}

      {cases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
          <MessagesSquare size={28} className="mx-auto text-gray-300" />
          <h3 className="mt-3 text-base font-bold text-gray-800 dark:text-gray-100">Nenhuma conversa disponível</h3>
        </div>
      ) : selectedCase && (
        <>
          <label className="block rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 lg:hidden">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wide text-gray-400">Conversa escolhida</span>
            <select value={selectedCase.id} onChange={(event) => selectCase(event.target.value)} className="w-full bg-transparent text-sm font-bold text-gray-900 outline-none dark:text-white">
              {cases.map((item, index) => <option key={item.id} value={item.id}>Caso {index + 1} · {formatNiche(item.niche)} · {item.messageCount} mensagens</option>)}
            </select>
          </label>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 lg:grid lg:h-[760px] lg:grid-cols-[250px_minmax(0,1fr)_310px]">
            <ReplayConversationList cases={cases} selectedId={selectedCase.id} onSelect={selectCase} />
            {loadingTranscript ? (
              <div className="flex min-h-[620px] items-center justify-center gap-2 bg-[#efeae2] text-sm font-semibold text-gray-500 dark:bg-gray-950 dark:text-gray-300 lg:min-h-0">
                <Loader2 size={17} className="animate-spin text-[#00a884]" /> Abrindo a conversa…
              </div>
            ) : result ? (
              <ReplayChat
                selectedCase={selectedCase}
                result={result}
                mode={viewMode}
                onModeChange={setViewMode}
                selectedTurn={selectedTurn}
                onSelectTurn={setSelectedTurn}
                onExplain={() => document.getElementById("replay-explanation")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            ) : (
              <div className="flex min-h-[620px] items-center justify-center bg-[#efeae2] text-sm text-gray-500 dark:bg-gray-950 lg:min-h-0">Conversa indisponível.</div>
            )}
            {result && (
              <ReplayInspector
                turn={activeTurn}
                result={result}
                providerStatus={providerStatus}
                consent={externalConsent}
                onConsentChange={setExternalConsent}
                running={running}
                onRun={() => void runReplay()}
              />
            )}
          </div>
          {running && <LoadingReplay />}
        </>
      )}
    </div>
  );
}
