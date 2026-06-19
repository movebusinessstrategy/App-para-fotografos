import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BookOpen,
  Check,
  Loader2,
  MessageCircle,
  Save,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import AgenteMateriais from "../components/agente/AgenteMateriais";
import AgenteAudios from "../components/agente/AgenteAudios";

type Tab = "config" | "test";
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
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
  const [tab, setTab] = useState<Tab>("config");

  // ── Configuração ──────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [persona, setPersona] = useState("");
  const [objective, setObjective] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [rules, setRules] = useState("");
  const [salesStrategy, setSalesStrategy] = useState("");
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

  useEffect(() => {
    loadConfig();
  }, []);

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
        setPersona(data.persona || "");
        setObjective(data.objective || "");
        setKnowledge(data.knowledge || "");
        setRules(data.rules || "");
        setSalesStrategy(data.sales_strategy || "");
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
        body: JSON.stringify({ enabled, auto_send: autoSend, persona, objective, knowledge, rules, sales_strategy: salesStrategy }),
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

  async function sendTest() {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setInput("");
    setSending(true);
    setTestError(null);
    try {
      const res = await authFetch("/api/agent/test", {
        method: "POST",
        body: JSON.stringify({
          messages: next,
          persona,
          objective,
          knowledge,
          rules,
          sales_strategy: salesStrategy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.reply) {
        setChat((c) => [...c, { role: "assistant", content: data.reply }]);
      } else {
        setTestError(data.error || "Erro ao gerar a resposta.");
      }
    } catch {
      setTestError("Erro de conexão.");
    } finally {
      setSending(false);
    }
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
      ) : (
        <div className="space-y-4">
          {/* Aviso de modo teste */}
          <div className="flex gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <Sparkles size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Modo teste.</strong> Converse como se fosse um cliente - nada é
              enviado para ninguém. Usa a configuração da aba ao lado (mesmo sem salvar).
            </div>
          </div>

          {/* Conversa */}
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="h-[420px] overflow-y-auto p-4 space-y-3">
              {chat.length === 0 && !sending && (
                <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500">
                  <Bot size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">
                    Mande a primeira mensagem como se fosse o cliente.
                  </p>
                  <p className="text-xs mt-1">
                    Ex.: "Oi, queria saber sobre ensaio gestante"
                  </p>
                </div>
              )}
              {chat.map((m, i) => (
                <div
                  key={i}
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
      )}
    </div>
  );
}
