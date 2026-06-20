import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  BookOpen,
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
import AgenteMateriais from "../components/agente/AgenteMateriais";
import AgenteAudios from "../components/agente/AgenteAudios";

type Tab = "config" | "test" | "atendimentos";
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
  bucket: "precisa_humano" | "orcamento" | "conversando";
}
// O que a Lia FARIA naquele turno (reproduz o fluxo autônomo no teste).
interface ChatAction {
  type: "handoff" | "orcamento";
  nicho?: string;
  pdfFound?: boolean;
  fileName?: string | null;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  action?: ChatAction | null;
}

// Atalhos pra começar o teste já num nicho (a Lia ainda identifica pela conversa).
const NICHOS_TESTE: { label: string; abre: string }[] = [
  { label: "Gestante", abre: "Oi! Queria saber sobre o ensaio gestante 🥰" },
  { label: "Newborn", abre: "Olá! Tenho interesse no ensaio newborn" },
  { label: "Smash the Cake", abre: "Oi, queria saber do Smash the Cake, meu bebê vai fazer 1 aninho" },
  { label: "Família", abre: "Oi! Vocês fazem ensaio de família?" },
  { label: "Casal", abre: "Olá! Queria um ensaio de casal" },
  { label: "Feminino", abre: "Oi, tenho interesse num ensaio feminino" },
  { label: "Marca Pessoal", abre: "Olá! Preciso de fotos pra minha marca pessoal" },
  { label: "Revelação", abre: "Oi! Queria saber do ensaio de revelação" },
];
const NICHO_LABEL: Record<string, string> = {
  gestante: "Gestante", newborn: "Newborn", smash_the_cake: "Smash the Cake",
  familia: "Família", casal: "Casal", feminino: "Feminino",
  marca_pessoal: "Marca Pessoal", revelacao: "Revelação",
};

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
  const [tab, setTab] = useState<Tab>("config");

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
  const [atendCounts, setAtendCounts] = useState({ precisa_humano: 0, orcamento: 0, conversando: 0, total: 0 });
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
        setAtendCounts(data.counts || { precisa_humano: 0, orcamento: 0, conversando: 0, total: 0 });
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
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await authFetch("/api/agent/config", {
        method: "PUT",
        body: JSON.stringify({ enabled, auto_send: autoSend, use_client_history: useClientHistory, persona, objective, knowledge, rules, sales_strategy: salesStrategy, attendant_name: attendantName }),
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

  async function sendMessage(raw: string) {
    const text = raw.trim();
    if (!text || sending) return;
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.reply || data.action)) {
        setChat((c) => [
          ...c,
          { role: "assistant", content: data.reply || "", action: data.action || null },
        ]);
      } else {
        setTestError(data.error || "Erro ao gerar a resposta.");
      }
    } catch {
      setTestError("Erro de conexão.");
    } finally {
      setSending(false);
    }
  }
  function sendTest() {
    sendMessage(input);
  }

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
      <div className="inline-flex p-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl">
        <button
          onClick={() => setTab("config")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
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
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            tab === "test"
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          )}
        >
          <MessageCircle size={16} />
          Testar
        </button>
        <button
          onClick={() => setTab("atendimentos")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
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

          {/* Liga/desliga */}
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">
                Ativar sugestões do agente
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Quando ligado, o agente sugere respostas dentro da extensão do WhatsApp (Fase 2). O teste abaixo funciona mesmo desligado.
              </div>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              role="switch"
              aria-checked={enabled}
              className={cn(
                "relative w-12 h-7 rounded-full transition-colors flex-shrink-0",
                enabled ? "bg-gold-500" : "bg-gray-300 dark:bg-gray-700",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform",
                  enabled && "translate-x-5",
                )}
              />
            </button>
          </div>

          {/* Atendimento autônomo (semi-automático) */}
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">
                Atendimento autônomo (a Lia responde sozinha)
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Quando ligado, a Lia responde os clientes no WhatsApp sem você clicar. Em casos de preço, fechamento, objeção forte ou se o cliente pedir uma pessoa, ela <strong>não responde</strong> e marca a conversa pra equipe assumir — sem avisar o cliente. Precisa do agente ligado acima. Teste antes na aba "Testar".
              </div>
            </div>
            <button
              onClick={() => setAutoSend((v) => !v)}
              role="switch"
              aria-checked={autoSend}
              disabled={!enabled}
              className={cn(
                "relative w-12 h-7 rounded-full transition-colors flex-shrink-0",
                autoSend && enabled ? "bg-gold-500" : "bg-gray-300 dark:bg-gray-700",
                !enabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform",
                  autoSend && "translate-x-5",
                )}
              />
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
                  {m.content && (
                    <div
                      className={cn(
                        "flex",
                        m.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap",
                          m.role === "user"
                            ? "bg-gold-500 text-white rounded-br-sm"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm",
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  )}

                  {/* Cartão: enviaria o orçamento (PDF do nicho) */}
                  {m.action?.type === "orcamento" && (
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
                  {m.action?.type === "handoff" && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] flex gap-2.5 px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300">
                        <UserRound size={18} className="flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">Passaria pra um atendente</div>
                          <div className="text-xs mt-0.5">
                            Preço final, fechamento, pagamento, data do ensaio ou objeção
                            forte. No atendimento real a Lia <strong>não responde</strong>{" "}
                            e te sinaliza, sem o cliente perceber.
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
      ) : (
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: "precisa_humano", label: "Precisa de você", n: atendCounts.precisa_humano, cls: "text-amber-600 dark:text-amber-400" },
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
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{a.last_message || "—"}</div>
                      </button>
                      {grp.key === "precisa_humano" && (
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
      )}
    </div>
  );
}
