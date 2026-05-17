import { useEffect, useState, type ReactNode } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
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

const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
              <div className="text-xs space-y-1 mb-4">
                {Object.entries(p.limits).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>{k}</span>
                    <span className="font-mono">{String(v === -1 ? "∞" : v)}</span>
                  </div>
                ))}
                {Object.keys(p.limits).length === 0 && (
                  <div className="text-gray-400">Sem limites definidos</div>
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
  const limitsJson = JSON.stringify(plan.limits ?? {}, null, 2);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold">{isNew ? "Novo plano" : `Editar ${plan.name}`}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Slug (único)">
            <input
              value={plan.slug ?? ""}
              onChange={(e) => onChange({ ...plan, slug: e.target.value })}
              disabled={!isNew}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm disabled:opacity-50"
            />
          </Field>
          <Field label="Nome">
            <input
              value={plan.name ?? ""}
              onChange={(e) => onChange({ ...plan, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
            />
          </Field>
          <Field label="Preço (centavos)">
            <input
              type="number"
              value={plan.price_cents ?? 0}
              onChange={(e) => onChange({ ...plan, price_cents: parseInt(e.target.value || "0", 10) })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
            />
          </Field>
          <Field label="Limites (JSON)">
            <textarea
              rows={6}
              defaultValue={limitsJson}
              onBlur={(e) => {
                try { onChange({ ...plan, limits: JSON.parse(e.target.value || "{}") }); }
                catch { alert("JSON inválido"); }
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs font-mono"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={plan.is_active ?? true}
              onChange={(e) => onChange({ ...plan, is_active: e.target.checked })}
            />
            Ativo
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100">Cancelar</button>
          <button onClick={onSave} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold">
            <Save size={14} /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}
