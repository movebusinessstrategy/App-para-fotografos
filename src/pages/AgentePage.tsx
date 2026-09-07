import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  BookOpen,
  BrainCircuit,
  Check,
  FileText,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { handoffReasonLabel } from "../features/chat/utils/agentHandoff";
import AgenteMateriais from "../components/agente/AgenteMateriais";
import AgenteAudios from "../components/agente/AgenteAudios";
import AgentLearningLab from "../features/agent/AgentLearningLab";
import AgentLearningFeedback, {
  type LearningFeedbackMessage,
} from "../features/agent/AgentLearningFeedback";
import { AgentPortfolioLinksEditor } from "../features/agent/AgentPortfolioLinksEditor";
import {
  portfolioLinksValidationMessage,
  type PortfolioLink,
} from "../../agent-portfolio";

type Tab = "config" | "test" | "learning" | "atendimentos";
// Item do painel "Atendimentos da Lia".
interface Atendimento {
  phone: string;
  contact_name: string | null;
  last_message: string;
  last_message_at: string | null;
  unread_count: number;
  stage_name: string | null;
  followup_status: "pending" | "sent" | null;
  followup_at: string | null;
  bucket: "precisa_humano" | "humano" | "orcamento" | "conversando";
  agent_status?: "idle" | "lia_active" | "quote_sent" | "needs_human" | "human_active" | null;
  handoff_reason?: string | null;
  handoff_at?: string | null;
  human_assumed_at?: string | null;
}
// O que a Lia FARIA naquele turno (reproduz o fluxo autônomo no teste).
interface ChatAction {
  type: "handoff" | "orcamento";
  reason?: string | null;
  nicho?: string;
  pdfFound?: boolean;
  fileName?: string | null;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  action?: ChatAction | null;
  /** Balões já "digitados". O teste espelha o envio real: um balão por vez. */
  revealed?: number;
}

// Mesma regra do servidor (envio autônomo): linha em branco separa balões e a
// pausa entre eles imita o tempo de digitação.
function splitBubbles(text: string): string[] {
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}
function typingDelayMs(text: string): number {
  return Math.min(1200 + text.length * 35, 6000);
}
function bubblesDone(m: ChatMsg): boolean {
  return m.revealed === undefined || m.revealed >= splitBubbles(m.content).length;
}

interface PlaygroundFeedbackContext {
  key: string;
  messages: LearningFeedbackMessage[];
  assistantResult: string;
}

interface AtendimentoCounts {
  precisa_humano: number;
  humano: number;
  orcamento: number;
  conversando: number;
  total: number;
}

const EMPTY_ATENDIMENTO_COUNTS: AtendimentoCounts = {
  precisa_humano: 0,
  humano: 0,
  orcamento: 0,
  conversando: 0,
  total: 0,
};

// Atalhos pra começar o teste já num nicho (a Lia ainda identifica pela conversa).
const NICHOS_TESTE: { label: string; abre: string }[] = [
  { label: "Gestante", abre: "Oi! Queria saber sobre o ensaio gestante 🥰" },
  { label: "Newborn", abre: "Olá! Tenho interesse no ensaio newborn" },
  { label: "Smash the Cake", abre: "Oi, queria saber do Smash the Cake, meu bebê vai fazer 1 aninho" },
  { label: "Família", abre: "Oi! Vocês fazem ensaio de família?" },
  { label: "Infantil", abre: "Oi! Queria saber sobre um ensaio infantil" },
  { label: "Casal", abre: "Olá! Queria um ensaio de casal" },
  { label: "Feminino", abre: "Oi, tenho interesse num ensaio feminino" },
  { label: "Marca Pessoal", abre: "Olá! Preciso de fotos pra minha marca pessoal" },
  { label: "Revelação", abre: "Oi! Queria saber do ensaio de revelação" },
  { label: "Anunciação", abre: "Oi! Queria saber sobre o ensaio de anunciação da gravidez" },
  { label: "Bebê 2-11 meses", abre: "Oi! Queria fotos do meu bebê, ele tem 6 meses" },
  { label: "Batizado", abre: "Olá! Vocês fotografam batizado?" },
  { label: "Aniversário", abre: "Oi! Queria um orçamento para fotos de aniversário" },
  { label: "Chá Revelação", abre: "Oi! Queria saber sobre fotos para chá revelação" },
];
const NICHO_LABEL: Record<string, string> = {
  gestante: "Gestante", newborn: "Newborn", smash_the_cake: "Smash the Cake",
  familia: "Família", infantil: "Infantil", casal: "Casal", feminino: "Feminino",
  marca_pessoal: "Marca Pessoal", revelacao: "Revelação", anunciacao: "Anunciação",
  batizado: "Batizado", aniversario: "Aniversário",
  cha_revelacao: "Chá Revelação", produtos: "Produtos",
};

function anonymizePlaygroundText(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link oculto]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail oculto]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]*\d{4}\b/g, "[telefone oculto]");
}

function playgroundFeedbackContext(chat: ChatMsg[]): PlaygroundFeedbackContext | null {
  let assistantIndex = -1;
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (chat[index].role === "assistant") {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;
  const messages = chat
    .slice(0, assistantIndex)
    .filter((message) => message.content.trim())
    .slice(-20)
    .map((message): LearningFeedbackMessage => ({
      role: message.role,
      content: anonymizePlaygroundText(message.content.trim()),
    }));
  if (messages.length === 0) return null;
  return {
    key: `${assistantIndex}-${chat.length}`,
    messages,
    assistantResult: anonymizePlaygroundText(chat[assistantIndex].content.trim()),
  };
}

// Bloco de configuração reutilizável (ícone + título + ajuda + textarea).
function ConfigSection({
  icon: Icon,
  title,
  help,
  value,
  onChange,
  rows,
  mono,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  mono?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={17} className="text-gold-600 dark:text-gold-400" />
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{help}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={cn(
          "w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500/40 resize-y",
          mono && "font-mono",
        )}
      />
    </div>
  );
}

export default function AgentePage() {
  const initialTab: Tab = import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("learning-demo") === "1"
    ? "learning"
    : "config";
  const [tab, setTab] = useState<Tab>(initialTab);

  // ── Configuração ──────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [useClientHistory, setUseClientHistory] = useState(false);
  const [persona, setPersona] = useState("");
  const [objective, setObjective] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [rules, setRules] = useState("");
  const [salesStrategy, setSalesStrategy] = useState("");
  const [attendantName, setAttendantName] = useState("");
  const [learnedPlaybook, setLearnedPlaybook] = useState("");
  const [portfolioLinks, setPortfolioLinks] = useState<PortfolioLink[]>([]);
  const [playbookSourceCount, setPlaybookSourceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Playground de teste ───────────────────────────────────────
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Atendimentos da Lia ───────────────────────────────────────
  const navigate = useNavigate();
  const [atend, setAtend] = useState<Atendimento[]>([]);
  const [atendCounts, setAtendCounts] = useState<AtendimentoCounts>(EMPTY_ATENDIMENTO_COUNTS);
  const [loadingAtend, setLoadingAtend] = useState(false);
  const [devolvendo, setDevolvendo] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    loadAtendimentos(); // popula o badge "precisa de você" já na entrada
  }, []);

  // Carrega os atendimentos ao abrir a aba + atualiza a cada 30s enquanto nela.
  useEffect(() => {
    if (tab !== "atendimentos") return;
    loadAtendimentos();
    const id = setInterval(loadAtendimentos, 30000);
    return () => clearInterval(id);
  }, [tab]);

  async function loadAtendimentos() {
    setLoadingAtend(true);
    try {
      const res = await authFetch("/api/agent/atendimentos");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAtend(Array.isArray(data.items) ? data.items : []);
        setAtendCounts({ ...EMPTY_ATENDIMENTO_COUNTS, ...(data.counts || {}) });
      }
    } catch { /* silencioso */ } finally {
      setLoadingAtend(false);
    }
  }

  async function devolverParaLia(phone: string) {
    setDevolvendo(phone);
    try {
      const res = await authFetch(`/api/agent/atendimentos/${encodeURIComponent(phone.replace(/\D/g, ""))}/devolver`, { method: "POST" });
      if (res.ok) await loadAtendimentos();
    } catch { /* silencioso */ } finally {
      setDevolvendo(null);
    }
  }

  function abrirConversa(phone: string) {
    navigate(`/whatsapp?phone=${encodeURIComponent(phone)}`);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, sending]);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/agent/config");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEnabled(!!data.enabled);
        setAutoSend(!!data.auto_send);
        setUseClientHistory(!!data.use_client_history);
        setPersona(data.persona || "");
        setObjective(data.objective || "");
        setKnowledge(data.knowledge || "");
        setRules(data.rules || "");
        setSalesStrategy(data.sales_strategy || "");
        setAttendantName(data.attendant_name || "");
        setLearnedPlaybook(data.learned_playbook || "");
        setPortfolioLinks(Array.isArray(data.portfolio_links) ? data.portfolio_links : []);
        setPlaybookSourceCount(Number(data.playbook_source_count) || 0);
        setTableMissing(!!data.table_missing);
      } else {
        setError(data.error || "Erro ao carregar a configuração.");
      }
    } catch {
      setError("Erro de conexão ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const portfolioError = portfolioLinksValidationMessage(portfolioLinks);
    if (portfolioError) {
      setSaved(false);
      setError(portfolioError);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await authFetch("/api/agent/config", {
        method: "PUT",
        body: JSON.stringify({ enabled, auto_send: autoSend, use_client_history: useClientHistory, persona, objective, knowledge, rules, sales_strategy: salesStrategy, attendant_name: attendantName, portfolio_links: portfolioLinks }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        setTableMissing(false);
        setTimeout(() => setSaved(false), 2500);
      } else {
        setError(data.error || "Erro ao salvar.");
      }
    } catch {
      setError("Erro de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function toggleAutonomousService() {
    const isActive = enabled && autoSend;
    setSaved(false);
    if (isActive) {
      // Pausa apenas o envio autônomo. O modo de sugestão continua disponível.
      setAutoSend(false);
      return;
    }
    // O autônomo depende do motor do agente: um único controle liga os dois.
    setEnabled(true);
    setAutoSend(true);
  }

  async function sendMessage(raw: string) {
    const text = raw.trim();
    if (!text || sending) return;
    const portfolioError = portfolioLinksValidationMessage(portfolioLinks);
    if (portfolioError) {
      setTestError(portfolioError);
      return;
    }
    // A API só manda pro modelo o body limpo (role/content), sem a action.
    const next: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setInput("");
    setSending(true);
    setTestError(null);
    try {
      const res = await authFetch("/api/agent/test", {
        method: "POST",
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          persona,
          objective,
          knowledge,
          rules,
          sales_strategy: salesStrategy,
          attendant_name: attendantName,
          learned_playbook: learnedPlaybook,
          portfolio_links: portfolioLinks,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.reply || data.action)) {
        const reply: string = data.reply || "";
        setChat((c) => [
          ...c,
          { role: "assistant", content: reply, action: data.action || null, revealed: 0 },
        ]);
        revealBubbles(next.length, splitBubbles(reply));
      } else {
        setTestError(data.error || "Erro ao gerar a resposta.");
      }
    } catch {
      setTestError("Erro de conexão.");
    } finally {
      setSending(false);
    }
  }
  // Revela os balões da resposta um a um, com "digitando…" e a mesma pausa
  // que o servidor usa entre envios. Assim o teste mostra o ritmo real.
  function revealBubbles(index: number, parts: string[]) {
    let shown = 0;
    const step = () => {
      if (shown >= parts.length) return;
      window.setTimeout(() => {
        shown += 1;
        setChat((c) => c.map((m, i) => (i === index ? { ...m, revealed: shown } : m)));
        step();
      }, typingDelayMs(parts[shown]));
    };
    step();
  }
  function sendTest() {
    sendMessage(input);
  }

  const latestPlaygroundFeedback = playgroundFeedbackContext(chat);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-gold-500/15 flex items-center justify-center flex-shrink-0">
          <Bot size={26} className="text-gold-600 dark:text-gold-400" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Agente IA
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Assistente de atendimento do WhatsApp - configure e teste antes de ativar.
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="mb-6 flex w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-gray-800 sm:w-fit">
        <button
          onClick={() => setTab("config")}
          className={cn(
            "flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-all sm:px-4",
            tab === "config"
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          )}
        >
          <Settings2 size={16} />
          Configuração
        </button>
        <button
          onClick={() => setTab("test")}
          className={cn(
            "flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-all sm:px-4",
            tab === "test"
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          )}
        >
          <MessageCircle size={16} />
          Testar
        </button>
        <button
          onClick={() => setTab("learning")}
          className={cn(
            "flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-all sm:px-4",
            tab === "learning"
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          )}
        >
          <BrainCircuit size={16} />
          Aprendizado
        </button>
        <button
          onClick={() => setTab("atendimentos")}
          className={cn(
            "flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-all sm:px-4",
            tab === "atendimentos"
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          )}
        >
          <Inbox size={16} />
          Atendimentos
          {atendCounts.precisa_humano > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[11px] font-bold">
              {atendCounts.precisa_humano}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : tab === "config" ? (
        <div className="space-y-5">
          {tableMissing && (
            <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <strong>Banco ainda não preparado.</strong> Rode as migrations{" "}
                <code className="font-mono">009</code> e{" "}
                <code className="font-mono">010</code> no Supabase (SQL Editor)
                para conseguir salvar a configuração.
              </div>
            </div>
          )}

          {/* Controle operacional principal */}
          <section
            className={cn(
              "overflow-hidden rounded-2xl border bg-white dark:bg-gray-900",
              enabled && autoSend
                ? "border-emerald-300 dark:border-emerald-800"
                : "border-gray-200 dark:border-gray-800",
            )}
          >
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
                      enabled && autoSend
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", enabled && autoSend ? "bg-emerald-500" : "bg-gray-400")} />
                    {enabled && autoSend ? "IA ativa" : "IA pausada"}
                  </span>
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500">WhatsApp de Atendimento</span>
                </div>
                <h2 className="text-lg font-bold tracking-tight text-gray-950 dark:text-white">
                  Atendimento automático até o orçamento
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  A Lia recebe o contato, entende o ensaio, tira as dúvidas que conhece, qualifica o interesse e envia o PDF certo. Você só entra quando a conversa precisa de decisão humana.
                </p>
              </div>

              <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:flex sm:flex-col sm:items-end">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {enabled && autoSend ? "Atendendo sozinha" : "Atendimento pausado"}
                </span>
                <button
                  type="button"
                  onClick={toggleAutonomousService}
                  role="switch"
                  aria-checked={enabled && autoSend}
                  aria-label={enabled && autoSend ? "Pausar atendimento automático" : "Ligar atendimento automático"}
                  className={cn(
                    "relative h-8 w-14 flex-shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900",
                    enabled && autoSend ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-700",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform",
                      enabled && autoSend && "translate-x-6",
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Aplicar agora
                </button>
              </div>
            </div>

            <div className="grid border-t border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-950/30 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <div className="flex gap-3 p-4">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-extrabold text-white">1</span>
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Conversa e qualifica</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">Responde dúvidas conhecidas e entende o que a pessoa procura.</div>
                </div>
              </div>
              <div className="hidden items-center text-gray-300 dark:text-gray-700 sm:flex">→</div>
              <div className="flex gap-3 border-t border-gray-100 p-4 dark:border-gray-800 sm:border-t-0">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-extrabold text-white">2</span>
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Envia o orçamento</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">Escolhe o material do nicho e registra a etapa no funil.</div>
                </div>
              </div>
              <div className="hidden items-center text-gray-300 dark:text-gray-700 sm:flex">→</div>
              <div className="flex gap-3 border-t border-amber-100 bg-amber-50/60 p-4 dark:border-amber-900/30 dark:bg-amber-950/10 sm:border-t-0">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><UserRound size={14} /></span>
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Chama você</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">Data, fechamento, sinal/Pix, pagamento, objeção, pedido de pessoa ou pergunta sem resposta.</div>
                </div>
              </div>
            </div>
          </section>

          {playbookSourceCount > 0 && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <div className="flex gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check size={17} />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-emerald-950 dark:text-emerald-100">
                    Padrão calibrado com {playbookSourceCount} vendas com sinal confirmado
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-800 dark:text-emerald-200/80">
                    A Lia usa somente padrões anônimos das conversas vencedoras: conversa natural, ritmo e tamanho de mensagem variáveis, uma pergunta por vez, qualificação por nicho, orçamento em PDF e passagem silenciosa para você nos momentos de decisão.
                  </p>
                  <p className="mt-1.5 text-xs text-emerald-700/80 dark:text-emerald-300/70">
                    Nenhuma mensagem, nome, telefone ou comprovante foi copiado para a configuração.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Recurso auxiliar — não interfere no limite do atendimento automático */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">Sugestões manuais da Lia</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Mostra o botão de sugestão no chat e na extensão. Com a IA autônoma ativa, este recurso fica ligado automaticamente.
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setSaved(false); setEnabled((v) => !v); }}
              role="switch"
              aria-checked={enabled}
              aria-label={enabled ? "Desligar sugestões manuais" : "Ligar sugestões manuais"}
              disabled={enabled && autoSend}
              className={cn(
                "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500",
                enabled ? "bg-gold-500" : "bg-gray-300 dark:bg-gray-700",
                enabled && autoSend && "cursor-not-allowed opacity-60",
              )}
            >
              <span className={cn("absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform", enabled && "translate-x-5")} />
            </button>
          </div>

          {/* Reconhecer clientes antigos (cria contexto na conversa) */}
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">
                Reconhecer clientes antigos
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Quando ligado, ao chegar mensagem a Lia cruza o telefone com a sua base de clientes e, se a pessoa já fez ensaio com você, atende com proximidade (puxa o nome, o filho/bebê e os ensaios anteriores) pra criar empatia. Só leitura, nada é alterado. Vale pro atendimento autônomo.
              </div>
            </div>
            <button
              onClick={() => setUseClientHistory((v) => !v)}
              role="switch"
              aria-checked={useClientHistory}
              disabled={!enabled}
              className={cn(
                "relative w-12 h-7 rounded-full transition-colors flex-shrink-0",
                useClientHistory && enabled ? "bg-gold-500" : "bg-gray-300 dark:bg-gray-700",
                !enabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform",
                  useClientHistory && "translate-x-5",
                )}
              />
            </button>
          </div>

          {/* Nome do atendente que a Lia assume */}
          <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            <div className="font-semibold text-gray-900 dark:text-white mb-1">Nome do atendente</div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              É o nome que a Lia usa pra se apresentar na 1ª mensagem ("Meu nome é <strong>{attendantName || "..."}</strong>, faço parte do time do estúdio..."). Deixe em branco pra ela não se apresentar com nome.
            </p>
            <input
              type="text"
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
              placeholder="Ex.: Giovana"
              className={cn(
                "w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500/40",
              )}
            />
          </div>

          <ConfigSection
            icon={Sparkles}
            title="Personalidade e tom de voz"
            help="Como o agente fala - o jeitinho da sua marca. Quanto mais específico, mais parecido com você."
            value={persona}
            onChange={setPersona}
            rows={9}
          />

          <ConfigSection
            icon={Target}
            title="Objetivo e fluxo do atendimento"
            help="O que o agente tem que fazer, em que ordem, e o que conta como atendimento bem fechado."
            value={objective}
            onChange={setObjective}
            rows={11}
          />

          <ConfigSection
            icon={BookOpen}
            title="Base de conhecimento"
            help="Pacotes, preços, horários e políticas. O agente nunca inventa nada fora daqui - preencha os campos entre colchetes."
            value={knowledge}
            onChange={setKnowledge}
            rows={16}
            mono
          />

          <AgentPortfolioLinksEditor
            value={portfolioLinks}
            onChange={setPortfolioLinks}
            disabled={saving}
          />

          <ConfigSection
            icon={Target}
            title="Estratégia de vendas e objeção"
            help="As técnicas de venda da Lia: rapport, perguntas certas (SPIN), valor antes de preço, prova social, escassez honesta, micro-compromissos e como contornar 'tá caro' / 'vou pensar'. Tudo sem pressão e sem fugir das regras. Deixe em branco pra usar o padrão pronto."
            value={salesStrategy}
            onChange={setSalesStrategy}
            rows={16}
          />

          <AgenteMateriais />

          <AgenteAudios />

          <ConfigSection
            icon={ShieldAlert}
            title="Regras e limites"
            help="O que o agente NUNCA pode fazer ou falar. É aqui que você o deixa fechadinho - sem elogio vazio, sem enrolação, sem fugir do assunto."
            value={rules}
            onChange={setRules}
            rows={15}
          />

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-600 text-white font-semibold transition-colors disabled:opacity-60"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              Salvar
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                <Check size={16} />
                Configuração salva
              </span>
            )}
          </div>
        </div>
      ) : tab === "test" ? (
        <div className="space-y-4">
          {/* Aviso de modo teste */}
          <div className="flex gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <Sparkles size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Modo teste — fluxo completo.</strong> Converse como um cliente: o
              teste roda igualzinho ao atendimento autônomo, indo <strong>até o envio do
              orçamento</strong> (mostra qual PDF a Lia mandaria e se está cadastrado) e
              mostrando quando ela passaria pra um humano. Nada é enviado pra ninguém. Usa
              a configuração da aba ao lado (mesmo sem salvar).
            </div>
          </div>

          {/* Conversa */}
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="h-[420px] overflow-y-auto p-4 space-y-3">
              {chat.length === 0 && !sending && (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500 px-2">
                  <Bot size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">
                    Escolha um tipo de ensaio pra começar o teste
                  </p>
                  <p className="text-xs mt-1 mb-4">
                    (ou escreva você mesmo lá embaixo e deixe a Lia identificar)
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-md">
                    {NICHOS_TESTE.map((n) => (
                      <button
                        key={n.label}
                        onClick={() => sendMessage(n.abre)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-gold-500/10 text-gold-700 dark:text-gold-300 border border-gold-500/30 hover:bg-gold-500/20 transition-colors"
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className="space-y-2">
                  {/* Balão de texto (cliente ou Lia). No hand-off não há texto. */}
                  {m.content && m.role === "user" && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap bg-gold-500 text-white rounded-br-sm">
                        {m.content}
                      </div>
                    </div>
                  )}
                  {/* Lia: um balão por parágrafo, revelados no ritmo do envio real. */}
                  {m.content && m.role === "assistant" && (
                    <>
                      {splitBubbles(m.content)
                        .slice(0, m.revealed ?? Infinity)
                        .map((part, j) => (
                          <div key={j} className="flex justify-start">
                            <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm">
                              {part}
                            </div>
                          </div>
                        ))}
                      {!bubblesDone(m) && (
                        <div className="flex justify-start">
                          <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs tracking-widest">
                            digitando…
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Cartão: enviaria o orçamento (PDF do nicho). Só depois do último balão. */}
                  {m.action?.type === "orcamento" && bubblesDone(m) && (
                    <div className="flex justify-start">
                      <div
                        className={cn(
                          "max-w-[85%] flex gap-2.5 px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm border",
                          m.action.pdfFound
                            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                            : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
                        )}
                      >
                        <FileText size={18} className="flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">
                            Enviaria o orçamento — pacote{" "}
                            {NICHO_LABEL[m.action.nicho || ""] || m.action.nicho}
                          </div>
                          {m.action.pdfFound ? (
                            <div className="text-xs mt-0.5 flex items-center gap-1">
                              <Check size={13} /> PDF cadastrado
                              {m.action.fileName ? `: ${m.action.fileName}` : ""} · move
                              pra "Orçamento Enviado"
                            </div>
                          ) : (
                            <div className="text-xs mt-0.5 flex items-center gap-1">
                              <AlertTriangle size={13} /> Nenhum PDF de "pacote" desse
                              nicho em Materiais — suba o arquivo pra a Lia enviar.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cartão: passaria pra um humano */}
                  {m.action?.type === "handoff" && bubblesDone(m) && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] flex gap-2.5 px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300">
                        <UserRound size={18} className="flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">Passaria pra um atendente</div>
                          <div className="text-xs mt-0.5">
                            {m.action.reason ? `${handoffReasonLabel(m.action.reason)}. ` : ""}
                            No atendimento real a Lia <strong>não responde</strong> e te sinaliza, sem o cliente perceber.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {testError && (
              <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 border-t border-gray-100 dark:border-gray-800">
                {testError}
              </div>
            )}

            {/* Entrada */}
            <div className="flex items-center gap-2 p-3 border-t border-gray-200 dark:border-gray-800">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendTest();
                  }
                }}
                placeholder="Escreva como se fosse o cliente…"
                className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500/40"
              />
              <button
                onClick={sendTest}
                disabled={sending || !input.trim()}
                className="flex items-center justify-center w-11 h-11 rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>

          {latestPlaygroundFeedback && !sending && (
            <section className="space-y-3 rounded-2xl border border-gold-200 bg-gold-50/40 p-4 dark:border-gold-900/60 dark:bg-gold-950/10">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold-500/10">
                  <BrainCircuit size={18} className="text-gold-600 dark:text-gold-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">Ensinar com este teste</h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    Avalie a última resposta. O histórico usado como exemplo é compactado e tem telefone, e-mail e links ocultados antes de salvar.
                  </p>
                </div>
              </div>
              <AgentLearningFeedback
                key={latestPlaygroundFeedback.key}
                context={{
                  sourceType: "playground",
                  sourceRef: "agent-test",
                  messages: latestPlaygroundFeedback.messages,
                  assistantResult: latestPlaygroundFeedback.assistantResult,
                }}
              />
            </section>
          )}

          {chat.length > 0 && (
            <button
              onClick={() => {
                setChat([]);
                setTestError(null);
              }}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <Trash2 size={15} />
              Limpar conversa
            </button>
          )}
        </div>
      ) : tab === "atendimentos" ? (
        /* ── Atendimentos da Lia ── */
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3 p-4 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 flex-1">
              <Bot size={20} className="text-violet-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-violet-800 dark:text-violet-300">
                <strong>Atendimentos da Lia.</strong> Quem ela está atendendo sozinha, quem já recebeu o orçamento e quem ela passou pra você assumir. Atualiza sozinho a cada 30s — clique numa pessoa pra abrir a conversa.
              </div>
            </div>
            <button
              onClick={loadAtendimentos}
              disabled={loadingAtend}
              className="flex items-center justify-center w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 flex-shrink-0 disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw size={16} className={cn(loadingAtend && "animate-spin")} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { key: "precisa_humano", label: "Precisa de você", n: atendCounts.precisa_humano, cls: "text-amber-600 dark:text-amber-400" },
              { key: "humano", label: "Você assumiu", n: atendCounts.humano, cls: "text-blue-600 dark:text-blue-400" },
              { key: "orcamento", label: "Orçamento enviado", n: atendCounts.orcamento, cls: "text-gold-600 dark:text-gold-400" },
              { key: "conversando", label: "Lia conversando", n: atendCounts.conversando, cls: "text-emerald-600 dark:text-emerald-400" },
            ].map((s) => (
              <div key={s.key} className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                <div className={cn("text-2xl font-extrabold", s.cls)}>{s.n}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>

          {atendCounts.total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400 dark:text-gray-500">
              <Inbox size={40} className="mb-3 opacity-40" />
              <p className="text-sm">A Lia ainda não atendeu ninguém por aqui.</p>
              <p className="text-xs mt-1">Com o atendimento autônomo ligado, os contatos vão aparecer aqui.</p>
            </div>
          ) : (
            [
              { key: "precisa_humano", title: "🙋 Precisa de você", desc: "A Lia passou pra você assumir (preço, fechamento, objeção ou pedido de pessoa).", border: "border-amber-300 dark:border-amber-800" },
              { key: "humano", title: "👤 Você assumiu", desc: "Conversas em atendimento humano. A Lia fica pausada até você devolver.", border: "border-blue-200 dark:border-blue-900" },
              { key: "orcamento", title: "📄 Orçamento enviado", desc: "A Lia mandou o orçamento e está aguardando a resposta.", border: "border-gray-200 dark:border-gray-800" },
              { key: "conversando", title: "💬 Lia conversando", desc: "Atendimento em andamento com a Lia.", border: "border-gray-200 dark:border-gray-800" },
            ].map((grp) => {
              const list = atend.filter((a) => a.bucket === grp.key);
              if (list.length === 0) return null;
              return (
                <div key={grp.key} className="space-y-2">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                      {grp.title} <span className="text-gray-400 font-normal">({list.length})</span>
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{grp.desc}</p>
                  </div>
                  {list.map((a) => (
                    <div
                      key={a.phone}
                      className={cn("flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-900 border", grp.border)}
                    >
                      <button onClick={() => abrirConversa(a.phone)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 dark:text-white truncate">{a.contact_name || a.phone}</span>
                          {a.unread_count > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[11px] font-bold">{a.unread_count}</span>
                          )}
                          {a.stage_name && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{a.stage_name}</span>
                          )}
                          {a.followup_status === "pending" && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">follow-up agendado</span>
                          )}
                          {a.followup_status === "sent" && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">follow-up enviado</span>
                          )}
                          {a.agent_status === "human_active" && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">atendimento humano</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{a.last_message || "—"}</div>
                        {grp.key === "precisa_humano" && a.handoff_reason && (
                          <div className="mt-0.5 truncate text-xs font-medium text-amber-700 dark:text-amber-300">Motivo: {handoffReasonLabel(a.handoff_reason)}</div>
                        )}
                      </button>
                      {(grp.key === "precisa_humano" || grp.key === "humano") && (
                        <button
                          onClick={() => devolverParaLia(a.phone)}
                          disabled={devolvendo === a.phone}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-violet-600 dark:text-violet-300 border border-violet-200 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-900/20 flex-shrink-0 disabled:opacity-50"
                          title="A Lia volta a responder essa conversa sozinha"
                        >
                          {devolvendo === a.phone ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                          Devolver pra Lia
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <AgentLearningLab />
      )}
    </div>
  );
}
