import React, { useMemo, useRef, useState } from "react";
import {
  MessageSquareText, Plus, Trash2, RefreshCw, Send, Loader2, X,
  CheckCircle2, Clock, AlertCircle, Info, Sparkles,
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { cn } from "../../utils/cn";
import { WhatsAppMessageTemplate, WhatsAppTemplateCategory } from "../../types";
import { ConfirmModal } from "../ui/ConfirmModal";

type Notify = (kind: "success" | "error" | "info", message: string) => void;

const CATEGORY_LABELS: Record<WhatsAppTemplateCategory, string> = {
  UTILITY: "Utilidade (lembretes, confirmações)",
  MARKETING: "Marketing (promoções, novidades)",
  AUTHENTICATION: "Autenticação (códigos)",
};

// Conta as variáveis {{N}} distintas no corpo
function countVars(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) || [];
  const nums = matches.map((m) => Number(m.replace(/\D/g, "")));
  return nums.length ? Math.max(...nums) : 0;
}

// Sugestões de variáveis. O Meta só aceita {{1}}, {{2}}… (posicional),
// então o botão insere o próximo número e usa o label como exemplo default.
const VAR_SUGGESTIONS: Array<{ label: string; example: string }> = [
  { label: "Nome do cliente", example: "Maria" },
  { label: "Data do ensaio", example: "15/06/2026" },
  { label: "Horário", example: "14h00" },
  { label: "Local", example: "Estúdio Pitori" },
  { label: "Valor", example: "R$ 1.290,00" },
  { label: "Link", example: "https://g.page/r/..." },
];

// Templates prontos comuns de fotografia — a usuária escolhe e ajusta.
const SEED_TEMPLATES: Array<{
  title: string;
  name: string;
  category: WhatsAppTemplateCategory;
  body_text: string;
  example_values: string[];
}> = [
  {
    title: "Lembrete de ensaio",
    name: "lembrete_ensaio",
    category: "UTILITY",
    body_text: "Olá {{1}}! Passando para lembrar do seu ensaio no dia {{2}} às {{3}}. Qualquer dúvida, é só chamar aqui. 📸",
    example_values: ["Maria", "15/06/2026", "14h00"],
  },
  {
    title: "Fotos prontas para retirada",
    name: "fotos_prontas",
    category: "UTILITY",
    body_text: "Oi {{1}}! Suas fotos já estão prontas para retirada no estúdio. Quando puder, combine um horário com a gente! 😊",
    example_values: ["Maria"],
  },
  {
    title: "Pedido de avaliação",
    name: "pedido_avaliacao",
    category: "MARKETING",
    body_text: "{{1}}, foi um prazer registrar esse momento com você! Se puder, deixe sua avaliação para a gente aqui: {{2}}. Significa muito! 💛",
    example_values: ["Maria", "https://g.page/r/..."],
  },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    APPROVED: { label: "Aprovado", cls: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300", icon: <CheckCircle2 size={11} /> },
    PENDING: { label: "Pendente", cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300", icon: <Clock size={11} /> },
    REJECTED: { label: "Rejeitado", cls: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300", icon: <AlertCircle size={11} /> },
  };
  const it = map[status] || map.PENDING;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold", it.cls)}>
      {it.icon}
      {it.label}
    </span>
  );
}

interface Props {
  onNotify: Notify;
}

export function WhatsAppTemplatesManager({ onNotify }: Props) {
  const { data, isLoading, mutate } = useApi<WhatsAppMessageTemplate[]>("/api/meta/whatsapp/templates");
  const templates = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WhatsAppMessageTemplate | null>(null);
  const [testTarget, setTestTarget] = useState<WhatsAppMessageTemplate | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await authFetch("/api/meta/whatsapp/templates/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        onNotify("error", json.error || "Erro ao sincronizar");
        return;
      }
      onNotify("success", `${json.updated} template(s) atualizado(s).`);
      mutate();
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (tpl: WhatsAppMessageTemplate) => {
    const res = await authFetch(`/api/meta/whatsapp/templates/${tpl.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      onNotify("error", json.error || "Erro ao excluir");
      return;
    }
    onNotify("success", "Template excluído.");
    mutate();
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm dark:shadow-lg dark:shadow-black/10 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center">
            <MessageSquareText size={24} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h4 className="font-bold text-gray-800 dark:text-white">Templates de Mensagem</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Modelos aprovados pelo Meta para enviar mensagens proativas (lembretes, follow-ups).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Consulta o Meta e atualiza o status dos templates"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            <Plus size={15} />
            Novo template
          </button>
        </div>
      </div>

      {/* Aviso sobre janela 24h */}
      <div className="flex gap-2 mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
        <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          O WhatsApp só permite mensagem livre nas primeiras 24h após o cliente te escrever.
          Para enviar fora desse período (lembretes, follow-ups), é obrigatório usar um template aprovado.
          A aprovação do Meta costuma levar de minutos a algumas horas.
        </p>
      </div>

      {/* Lista */}
      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum template criado ainda.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Crie seu primeiro template para enviar mensagens proativas.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex items-start justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{tpl.name}</span>
                  <StatusBadge status={tpl.status} />
                  <span className="text-[10px] text-gray-400 uppercase">{tpl.category}</span>
                  <span className="text-[10px] text-gray-400">{tpl.language}</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{tpl.body_text}</p>
                {tpl.status === "REJECTED" && tpl.rejection_reason && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                    Motivo: {tpl.rejection_reason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {tpl.status === "APPROVED" && (
                  <button
                    onClick={() => setTestTarget(tpl)}
                    title="Enviar teste"
                    className="p-2 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                  >
                    <Send size={14} />
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(tpl)}
                  title="Excluir"
                  className="p-2 rounded-lg text-gray-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <TemplateForm
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); mutate(); }}
          onNotify={onNotify}
        />
      )}

      {testTarget && (
        <SendTestModal
          template={testTarget}
          onClose={() => setTestTarget(null)}
          onNotify={onNotify}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir template"
        message={confirmDelete ? `Excluir o template "${confirmDelete.name}"? Ele será removido também do Meta.` : ""}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ─── Form de criação ──────────────────────────────────────────────────────────

function TemplateForm({ onClose, onCreated, onNotify }: {
  onClose: () => void;
  onCreated: () => void;
  onNotify: Notify;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<WhatsAppTemplateCategory>("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [exampleValues, setExampleValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const varCount = countVars(bodyText);

  // Mantém o array de exemplos do tamanho certo
  const setExample = (idx: number, value: string) => {
    setExampleValues((prev) => {
      const next = [...prev];
      while (next.length < varCount) next.push("");
      next[idx] = value;
      return next.slice(0, varCount);
    });
  };

  // Insere a próxima variável {{N}} na posição do cursor e pré-preenche
  // o exemplo dela com o valor sugerido daquele rótulo.
  const insertVariable = (suggestion: { label: string; example: string }) => {
    const nextNum = varCount + 1;
    const token = `{{${nextNum}}}`;
    const ta = bodyRef.current;
    let newBody: string;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      newBody = bodyText.slice(0, start) + token + bodyText.slice(end);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      newBody = bodyText + token;
    }
    setBodyText(newBody);
    // Pré-preenche o exemplo da nova variável
    setExampleValues((prev) => {
      const next = [...prev];
      while (next.length < nextNum) next.push("");
      next[nextNum - 1] = suggestion.example;
      return next;
    });
  };

  // Aplica um template pronto no formulário
  const applySeed = (seed: typeof SEED_TEMPLATES[number]) => {
    setName(seed.name);
    setCategory(seed.category);
    setBodyText(seed.body_text);
    setExampleValues([...seed.example_values]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { onNotify("error", "Dê um nome ao template."); return; }
    if (!bodyText.trim()) { onNotify("error", "O corpo do template não pode ficar vazio."); return; }
    for (let i = 0; i < varCount; i++) {
      if (!exampleValues[i]?.trim()) {
        onNotify("error", `Preencha o exemplo da variável {{${i + 1}}}.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/meta/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          language: "pt_BR",
          body_text: bodyText,
          example_values: exampleValues.slice(0, varCount),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify("error", json.error || "Erro ao criar template");
        return;
      }
      onNotify("success", "Template enviado ao Meta para aprovação.");
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Novo template de mensagem</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Modelos prontos */}
          <div>
            <label className="block text-xs font-bold uppercase text-gray-400 mb-1.5 flex items-center gap-1">
              <Sparkles size={12} className="text-emerald-500" />
              Começar de um modelo pronto
            </label>
            <div className="flex flex-wrap gap-2">
              {SEED_TEMPLATES.map((seed) => (
                <button
                  key={seed.name}
                  type="button"
                  onClick={() => applySeed(seed)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                >
                  {seed.title}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Preenche o formulário — você ajusta antes de enviar.</p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-400 mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="lembrete_ensaio"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">Só letras minúsculas, números e _ (underscore).</p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-400 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as WhatsAppTemplateCategory)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400"
            >
              {(Object.keys(CATEGORY_LABELS) as WhatsAppTemplateCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-400 mb-1">Corpo da mensagem</label>
            <textarea
              ref={bodyRef}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={4}
              placeholder={"Olá {{1}}! Passando para lembrar do seu ensaio no dia {{2}}."}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400 resize-none font-mono"
            />
            {/* Botões de inserir variável */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] font-bold uppercase text-gray-400 mr-0.5">Inserir:</span>
              {VAR_SUGGESTIONS.map((v) => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="px-2 py-0.5 text-[11px] rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-400 transition-colors"
                >
                  + {v.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Cada botão insere uma variável (<code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>…) na posição do cursor.
              O Meta usa números; os rótulos acima são só pra te guiar.
            </p>
          </div>

          {varCount > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase text-gray-400 mb-1">
                Exemplos das variáveis
              </label>
              <p className="text-[11px] text-gray-400 mb-2">
                O Meta exige um exemplo de valor real para cada variável (usado só na revisão).
              </p>
              <div className="space-y-2">
                {Array.from({ length: varCount }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500 w-10">{`{{${i + 1}}}`}</span>
                    <input
                      value={exampleValues[i] || ""}
                      onChange={(e) => setExample(i, e.target.value)}
                      placeholder={i === 0 ? "Maria" : "exemplo"}
                      className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Enviar para aprovação
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de envio de teste ──────────────────────────────────────────────────

function SendTestModal({ template, onClose, onNotify }: {
  template: WhatsAppMessageTemplate;
  onClose: () => void;
  onNotify: Notify;
}) {
  const varCount = countVars(template.body_text);
  const [to, setTo] = useState("");
  const [params, setParams] = useState<string[]>(
    () => template.example_values?.slice(0, varCount) || []
  );
  const [sending, setSending] = useState(false);

  const setParam = (idx: number, value: string) => {
    setParams((prev) => {
      const next = [...prev];
      while (next.length < varCount) next.push("");
      next[idx] = value;
      return next.slice(0, varCount);
    });
  };

  const handleSend = async () => {
    if (!to.trim()) { onNotify("error", "Informe o número de destino."); return; }
    setSending(true);
    try {
      const res = await authFetch(`/api/meta/whatsapp/templates/${template.id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, parameters: params.slice(0, varCount) }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify("error", json.error || "Erro ao enviar");
        return;
      }
      onNotify("success", "Mensagem de teste enviada!");
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Enviar teste</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-400 mb-1">Número de destino</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="5543999999999"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">Com código do país e DDD, só números.</p>
          </div>

          {varCount > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Valores das variáveis</label>
              <div className="space-y-2">
                {Array.from({ length: varCount }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500 w-10">{`{{${i + 1}}}`}</span>
                    <input
                      value={params[i] || ""}
                      onChange={(e) => setParam(i, e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-emerald-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
