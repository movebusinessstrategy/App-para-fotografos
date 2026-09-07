import { useState } from "react";
import { Check, CheckCircle2, Loader2, ThumbsUp, Wrench } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

export interface LearningFeedbackMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LearningFeedbackContext {
  caseId?: string | number;
  sourceType?: "lab_case" | "playground";
  sourceRef?: string;
  messages?: LearningFeedbackMessage[];
  simulationId?: string | number | null;
  assistantResult?: string;
}

interface AgentLearningFeedbackProps {
  context: LearningFeedbackContext;
  demoMode?: boolean;
  onSaved?: (decision: "approve" | "correct", approveRule: boolean) => void;
}

const CATEGORY_OPTIONS = [
  { value: "tom_de_voz", label: "Tom de voz" },
  { value: "informacao", label: "Informação incorreta ou incompleta" },
  { value: "fluxo", label: "Ordem do atendimento" },
  { value: "vendas", label: "Condução da venda" },
  { value: "handoff", label: "Momento de chamar uma pessoa" },
  { value: "outro", label: "Outro aprendizado" },
];

function responseMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  return typeof record.message === "string" ? record.message : "";
}

function correctionError(category: string, correctedReply: string, lesson: string): string | null {
  if (!category) return "Escolha a categoria do ajuste.";
  if (!correctedReply.trim()) return "Escreva a resposta ideal para este caso.";
  if (!lesson.trim()) return "Explique o que a Lia deve aprender.";
  return null;
}

export default function AgentLearningFeedback({
  context,
  demoMode = false,
  onSaved,
}: AgentLearningFeedbackProps) {
  const queryDemo = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("learning-demo") === "1";
  const isDemo = import.meta.env.DEV && (demoMode || queryDemo);
  const endpoint = isDemo ? "/api/dev/agent-learning/feedback" : "/api/agent/learning/feedback";
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [category, setCategory] = useState("outro");
  const [correctedReply, setCorrectedReply] = useState("");
  const [lesson, setLesson] = useState("");
  const [approveRule, setApproveRule] = useState(true);
  const [busy, setBusy] = useState<"approve" | "correct" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function payload(decision: "approve" | "correct") {
    return {
      case_id: context.caseId,
      source_type: context.sourceType ?? (context.caseId ? "lab_case" : "playground"),
      source_ref: context.sourceRef,
      messages: context.messages,
      simulation_id: context.simulationId,
      assistant_result: context.assistantResult,
      decision,
      category,
      corrected_reply: decision === "correct" ? correctedReply.trim() : undefined,
      proposed_rule: decision === "correct" ? lesson.trim() : undefined,
      approve_rule: decision === "correct" ? approveRule : false,
    };
  }

  async function submit(decision: "approve" | "correct") {
    const validation = decision === "correct"
      ? correctionError(category, correctedReply, lesson)
      : null;
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(decision);
    setError(null);
    setSuccess(null);
    try {
      const options: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(decision)),
      };
      const response = isDemo ? await fetch(endpoint, options) : await authFetch(endpoint, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(data) || "Não foi possível salvar sua avaliação.");
      setSuccess(
        decision === "approve"
          ? "Resposta aprovada. Ela agora serve como uma boa referência."
          : approveRule
            ? "Correção salva e aprendizado ativado para as próximas conversas."
            : "Correção salva para revisão, sem mudar as próximas conversas.",
      );
      setCorrectionOpen(false);
      setSaved(true);
      onSaved?.(decision, approveRule);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível salvar sua avaliação.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-3">
        <h5 className="text-sm font-bold text-gray-900 dark:text-white">Sua avaliação</h5>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Seu olhar é a confirmação final. A simulação, sozinha, não muda o atendimento.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void submit("approve")}
          disabled={Boolean(busy) || saved}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <ThumbsUp size={16} />}
          Está certo
        </button>
        <button
          type="button"
          onClick={() => {
            setCorrectionOpen(true);
            setSuccess(null);
            setError(null);
          }}
          disabled={Boolean(busy) || saved}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Wrench size={16} /> Precisa melhorar
        </button>
      </div>

      {correctionOpen && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-200">Categoria do ajuste</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gold-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-200">Resposta ideal</span>
            <textarea
              value={correctedReply}
              onChange={(event) => setCorrectedReply(event.target.value)}
              rows={4}
              placeholder="Escreva como a Lia deveria responder neste caso…"
              className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gold-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700 dark:text-gray-200">O que a Lia deve aprender</span>
            <textarea
              value={lesson}
              onChange={(event) => setLesson(event.target.value)}
              rows={3}
              placeholder="Ex.: quando perguntarem sobre data, chamar uma pessoa antes de prometer disponibilidade."
              className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gold-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-950/50">
            <input
              type="checkbox"
              checked={approveRule}
              onChange={(event) => setApproveRule(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gold-500 focus:ring-gold-500"
            />
            <span>
              <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Aplicar nas próximas conversas</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                Desmarque se quiser apenas guardar a correção para revisar depois.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setCorrectionOpen(false)}
              disabled={Boolean(busy)}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit("correct")}
              disabled={Boolean(busy)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900"
            >
              {busy === "correct" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Salvar correção
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}
      {success && (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /> {success}
        </p>
      )}
    </div>
  );
}
