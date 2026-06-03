import { useEffect, useState, type ReactNode } from "react";
import { Check, Plus, Save, Trash2, X } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

type Plan = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  limits: Record<string, any>;
  is_active: boolean;
  sort_order: number;
};

type LimitMeta = {
  label: string;
  type: "number" | "bool";
  help: string;
};

// Dicionário centralizado dos limites conhecidos. Pra adicionar um limite novo,
// só inserir aqui que a UI passa a mostrar texto legível em vez de chave crua.
const LIMIT_META: Record<string, LimitMeta> = {
  max_jobs:         { label: "Trabalhos",       type: "number", help: "Quantidade máxima de trabalhos (jobs) que o usuário pode criar." },
  max_clients:      { label: "Clientes",         type: "number", help: "Quantidade máxima de clientes cadastrados." },
  max_team_members: { label: "Membros da equipe", type: "number", help: "Quantos colaboradores o titular pode convidar." },
  whatsapp:         { label: "WhatsApp",         type: "bool",   help: "Se o módulo de WhatsApp está liberado no plano." },
  contracts:        { label: "Contratos",        type: "bool",   help: "Se a geração e assinatura de contratos está liberada." },
};

// Ordem em que os limites aparecem nos cards (não-listados vão pro fim).
const LIMIT_ORDER = ["max_jobs", "max_clients", "max_team_members", "whatsapp", "contracts"];

const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function renderLimitValue(key: string, raw: any): { text: string; icon?: "check" | "x" } {
  const meta = LIMIT_META[key];
  // Boolean conhecido → "Incluído" / "Não incluído"
  if (meta?.type === "bool" || typeof raw === "boolean") {
    return raw ? { text: "Incluído", icon: "check" } : { text: "Não incluído", icon: "x" };
  }
  // Numérico
  if (typeof raw === "number") {
    return { text: raw === -1 ? "Ilimitado" : raw.toLocaleString("pt-BR") };
  }
  // Outros tipos
  return { text: String(raw) };
}

function fmtLabel(key: string): string {
  return LIMIT_META[key]?.label ?? key.replace(/_/g, " ");
}

function orderedLimitKeys(limits: Record<string, any>): string[] {
  const known = LIMIT_ORDER.filter((k) => k in limits);
  const extras = Object.keys(limits).filter((k) => !LIMIT_ORDER.includes(k));
  return [...known, ...extras];
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await authFetch("/api/platform/plans");
    setPlans(await r.json());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    const isNew = !editing.id;
    const url = isNew ? "/api/platform/plans" : `/api/platform/plans/${editing.id}`;
    const method = isNew ? "POST" : "PATCH";
    const r = await authFetch(url, { method, body: JSON.stringify(editing) });
    if (!r.ok) { alert((await r.json()).error ?? "Falha"); return; }
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este plano? Empresas associadas ficarão sem plano.")) return;
    const r = await authFetch(`/api/platform/plans/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Falha ao excluir"); return; }
    await load();
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Planos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Estrutura comercial do SaaS</p>
        </div>
        <button
          onClick={() => setEditing({ slug: "", name: "", price_cents: 0, limits: {}, is_active: true, sort_order: plans.length })}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold"
        >
          <Plus size={16} /> Novo plano
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-sm text-gray-500">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-xs text-gray-500 uppercase font-semibold">{p.slug}</div>
                  <div className="text-lg font-bold">{p.name}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.is_active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-gray-200 text-gray-600"}`}>
                  {p.is_active ? "ativo" : "inativo"}
                </span>
              </div>
              <div className="text-2xl font-bold mb-3">
                {p.price_cents === 0 ? "Grátis" : fmtMoney(p.price_cents)}
                {p.price_cents > 0 && <span className="text-xs text-gray-500 font-normal">/mês</span>}
              </div>
              <div className="text-sm space-y-2 mb-4">
                {orderedLimitKeys(p.limits).map((k) => {
                  const val = renderLimitValue(k, p.limits[k]);
                  return (
                    <div key={k} className="flex justify-between items-center gap-3 text-gray-700 dark:text-gray-300" title={LIMIT_META[k]?.help}>
                      <span>{fmtLabel(k)}</span>
                      <span className="flex items-center gap-1.5 font-semibold">
                        {val.icon === "check" && <Check size={14} className="text-green-600" />}
                        {val.icon === "x" && <X size={14} className="text-gray-400" />}
                        <span className={val.icon === "x" ? "text-gray-400" : ""}>{val.text}</span>
                      </span>
                    </div>
                  );
                })}
                {Object.keys(p.limits).length === 0 && (
                  <div className="text-gray-400 text-xs">Nenhum limite ou recurso definido neste plano.</div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(p)} className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-lg text-sm">Editar</button>
                <button onClick={() => remove(p.id)} className="px-3 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PlanModal plan={editing} onChange={setEditing} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function PlanModal({
  plan, onChange, onSave, onClose,
}: { plan: Partial<Plan>; onChange: (p: Partial<Plan>) => void; onSave: () => void; onClose: () => void }) {
  const isNew = !plan.id;
  const limits = plan.limits ?? {};
  const setLimit = (key: string, value: any) => {
    onChange({ ...plan, limits: { ...limits, [key]: value } });
  };
  // Preço em R$ pra edição (não centavos)
  const priceReais = ((plan.price_cents ?? 0) / 100).toFixed(2).replace(".", ",");
  const [priceText, setPriceText] = useState(priceReais);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold">{isNew ? "Novo plano" : `Editar ${plan.name}`}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Identificação */}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Identificador interno (slug)"
              help={isNew ? "Sem espaços, só minúsculas. Ex: pro, business. Não pode mudar depois." : "Não pode ser alterado depois de criado."}
            >
              <input
                value={plan.slug ?? ""}
                onChange={(e) => onChange({ ...plan, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                disabled={!isNew}
                placeholder="pro"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm disabled:opacity-50 font-mono"
              />
            </Field>
            <Field label="Nome exibido" help="Como aparece pro cliente. Ex: Pro, Business.">
              <input
                value={plan.name ?? ""}
                onChange={(e) => onChange({ ...plan, name: e.target.value })}
                placeholder="Pro"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
              />
            </Field>
          </div>

          {/* Preço */}
          <Field label="Preço por mês" help="Use 0 (zero) pra plano gratuito.">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">R$</span>
              <input
                value={priceText}
                onChange={(e) => {
                  const v = e.target.value;
                  setPriceText(v);
                  const cents = Math.round(parseFloat(v.replace(/\./g, "").replace(",", ".") || "0") * 100);
                  if (!Number.isNaN(cents)) onChange({ ...plan, price_cents: cents });
                }}
                placeholder="97,00"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </Field>

          {/* Limites e recursos — campos amigáveis pra cada um conhecido */}
          <div>
            <h4 className="font-semibold text-sm mb-2">O que este plano libera</h4>
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {LIMIT_ORDER.map((key) => {
                const meta = LIMIT_META[key];
                const value = limits[key];
                if (meta.type === "number") {
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{meta.label}</div>
                        <div className="text-xs text-gray-500">{meta.help}</div>
                      </div>
                      <input
                        type="number"
                        value={value === -1 ? "" : (typeof value === "number" ? value : "")}
                        placeholder={value === -1 ? "ilimitado" : "0"}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setLimit(key, v === "" ? -1 : parseInt(v, 10));
                        }}
                        className="w-24 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-right"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={value === -1}
                          onChange={(e) => setLimit(key, e.target.checked ? -1 : 0)}
                        />
                        Ilimitado
                      </label>
                    </div>
                  );
                }
                // boolean
                return (
                  <label key={key} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{meta.label}</div>
                      <div className="text-xs text-gray-500">{meta.help}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!value}
                      onChange={(e) => setLimit(key, e.target.checked)}
                      className="w-4 h-4 accent-purple-600 cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {/* Ativo */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={plan.is_active ?? true}
              onChange={(e) => onChange({ ...plan, is_active: e.target.checked })}
              className="w-4 h-4 accent-purple-600"
            />
            <span><strong>Plano ativo</strong> — visível pros clientes contratarem</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={onSave} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold">
            <Save size={14} /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
      {help && <p className="text-[11px] text-gray-400 mt-1">{help}</p>}
    </div>
  );
}
