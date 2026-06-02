import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Edit2, Plus, Trash2, Target, DollarSign, Save, Loader2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { OpportunityRule } from "../../types";

const JOB_TYPES = ["Gestante", "Newborn", "Acompanhamento", "Smash the Cake", "Aniversário", "Família", "Outros"];

// ─── Valor mínimo por tipo de ensaio ─────────────────────────────────────
// O usuário cadastra o preço do pacote base de cada tipo. Esses valores são
// usados como fallback no cálculo de "potencial de venda" das oportunidades
// que não têm valor preenchido individualmente.
function ValoresPorTipoSection() {
  const [precos, setPrecos] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    authFetch('/api/tipo-ensaio-precos')
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => {
        const m: Record<string, number> = {};
        // Pre-popula com os tipos hardcoded zerados
        JOB_TYPES.forEach(t => { m[t] = 0; });
        // Sobrescreve com o que já foi salvo (preserva nomes que não estão no hardcoded)
        rows.forEach(r => { m[r.tipo_nome] = Number(r.preco_minimo) || 0; });
        setPrecos(m);
      })
      .catch(() => setPrecos(Object.fromEntries(JOB_TYPES.map(t => [t, 0]))))
      .finally(() => setLoading(false));
  }, []);

  const setPreco = (tipo: string, valor: number) => {
    setPrecos(prev => ({ ...prev, [tipo]: valor }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const items = (Object.entries(precos) as [string, number][])
        .filter(([, v]) => Number.isFinite(v) && v >= 0)
        .map(([tipo_nome, preco_minimo]) => ({ tipo_nome, preco_minimo }));
      await authFetch('/api/tipo-ensaio-precos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <DollarSign size={16} /> Valor mínimo por tipo de ensaio
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Cadastre o valor do pacote base de cada tipo. É usado pra calcular o potencial de venda das oportunidades.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(precos).map(([tipo, valor]) => (
            <div key={tipo} className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">
                {tipo}
              </span>
              <div className="relative flex-shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={valor || ''}
                  onChange={e => setPreco(tipo, Number(e.target.value) || 0)}
                  placeholder="0,00"
                  className="w-32 pl-9 pr-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 outline-none focus:border-gold-400"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {savedAt && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3">
          ✓ Salvo. O painel de oportunidades usa esses valores no próximo carregamento.
        </p>
      )}
    </div>
  );
}

export function RuleModal({ rule, onClose, onSave }: { rule: OpportunityRule | null; onClose: () => void; onSave: () => void }) {
  const [formData, setFormData] = useState({
    trigger_job_type: rule?.trigger_job_type || "Gestante",
    target_job_type:  rule?.target_job_type  || "Newborn",
    days_offset:      rule?.days_offset      ?? 30,
    is_active:        rule ? Boolean(rule.is_active) : true,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = rule ? "PUT" : "POST";
    const url = rule ? `/api/opportunity-rules/${rule.id}` : "/api/opportunity-rules";
    await authFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, is_active: formData.is_active ? 1 : 0 }),
    });
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{rule ? "Editar regra" : "Nova regra de oportunidade"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Plus className="rotate-45" size={22} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo de ensaio (gatilho)</label>
            <select value={formData.trigger_job_type} onChange={e => setFormData({ ...formData, trigger_job_type: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">
              {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Oportunidade gerada</label>
            <input required value={formData.target_job_type} onChange={e => setFormData({ ...formData, target_job_type: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Dias após o ensaio</label>
            <input required type="number" value={formData.days_offset} onChange={e => setFormData({ ...formData, days_offset: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-gold-600 focus:ring-gold-500" />
            Regra ativa
          </label>
          <div className="flex justify-end gap-2 pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancelar</button>
            <button type="submit" className="px-5 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-lg">Salvar</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default function AutomacoesTab() {
  const [rules, setRules] = useState<OpportunityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OpportunityRule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: number }>({ open: false, id: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/opportunity-rules");
      setRules(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const remove = async () => {
    await authFetch(`/api/opportunity-rules/${confirmDelete.id}`, { method: "DELETE" });
    setConfirmDelete({ open: false, id: 0 });
    load();
  };

  return (
    <div className="max-w-4xl">
      <ValoresPorTipoSection />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Target size={18} /> Regras de oportunidade
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Regras que geram oportunidades automaticamente após um ensaio (ex.: Gestante {'→'} Newborn após 30 dias).
          </p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-lg">
          <Plus size={15} /> Nova regra
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-gold-600" /></div>
      ) : rules.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center">
          <Target size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Nenhuma regra cadastrada ainda.</p>
          <button onClick={() => { setEditing(null); setModalOpen(true); }}
            className="px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-lg">
            Criar primeira regra
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Gatilho</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Gera</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Dias</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{r.trigger_job_type}</td>
                  <td className="px-5 py-3 text-gold-600 dark:text-gold-400">{r.target_job_type}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{r.days_offset} dias</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                      r.is_active
                        ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500")}>
                      {r.is_active ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setEditing(r); setModalOpen(true); }}
                        className="p-1.5 text-gray-400 hover:text-gold-600 hover:bg-gold-50 dark:hover:bg-gold-900/10 rounded">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setConfirmDelete({ open: true, id: r.id })}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <RuleModal
          rule={editing}
          onClose={() => setModalOpen(false)}
          onSave={() => { setModalOpen(false); load(); }}
        />
      )}

      <ConfirmModal
        open={confirmDelete.open}
        title="Excluir regra"
        message="Deseja excluir esta regra de oportunidade?"
        confirmText="Excluir"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmDelete({ open: false, id: 0 })}
      />
    </div>
  );
}
