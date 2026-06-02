import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, ArrowRight, X, Loader2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { OpportunityRule } from "../../types";
import { RuleModal } from "../../pages/configuracoes/AutomacoesTab";

/**
 * Modal de gerenciamento das regras de oportunidade, acessível direto da
 * janela Oportunidades. Reaproveita a RuleModal (mesma usada em Configurações)
 * e os endpoints /api/opportunity-rules — não há mudança de backend.
 */
export default function OpportunityRulesModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<OpportunityRule[]>([]);
  const [loading, setLoading] = useState(true);
  // undefined = formulário fechado · null = nova regra · objeto = editar
  const [formRule, setFormRule] = useState<OpportunityRule | null | undefined>(undefined);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/opportunity-rules");
      setRules(res.ok ? await res.json() : []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRules(); }, []);

  const handleDelete = async (id: number) => {
    if (!window.confirm("Excluir esta regra? As oportunidades já geradas continuam.")) return;
    await authFetch(`/api/opportunity-rules/${id}`, { method: "DELETE" });
    fetchRules();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white rounded-[1.5rem] shadow-2xl shadow-black/10 border border-black/5 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-black/5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight">Regras de oportunidade</h3>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                Geram oportunidades automaticamente após um ensaio. Ex.: Gestante → Newborn após 30 dias.
              </p>
            </div>
            <button onClick={onClose} className="flex-shrink-0 text-gray-400 hover:text-luxury-black transition-colors mt-0.5">
              <X size={20} />
            </button>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-gray-500 mb-4">Nenhuma regra cadastrada ainda.</p>
                <button
                  onClick={() => setFormRule(null)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold transition-colors"
                >
                  <Plus size={15} /> Criar primeira regra
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-3 p-3 rounded-2xl border border-black/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-black/[0.05] text-gray-700">{rule.trigger_job_type}</span>
                        <ArrowRight size={14} className="text-gold-500 flex-shrink-0" />
                        <span className="px-2 py-0.5 rounded-md bg-gold-50 text-gold-700">{rule.target_job_type}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        após {rule.days_offset} dias
                        {" · "}
                        <span className={rule.is_active ? "text-emerald-600" : "text-gray-400"}>
                          {rule.is_active ? "ativa" : "inativa"}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => setFormRule(rule)}
                      className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-gold-600 hover:bg-gold-50 transition-colors"
                      title="Editar"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {rules.length > 0 && (
            <div className="px-4 py-4 border-t border-black/5">
              <button
                onClick={() => setFormRule(null)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold transition-colors"
              >
                <Plus size={15} /> Nova regra
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Formulário (reaproveita a RuleModal de Configurações) */}
      {formRule !== undefined && (
        <RuleModal
          rule={formRule}
          onClose={() => setFormRule(undefined)}
          onSave={() => { setFormRule(undefined); fetchRules(); }}
        />
      )}
    </>
  );
}
