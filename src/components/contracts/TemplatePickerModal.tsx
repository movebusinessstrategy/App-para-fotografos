import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, FileText, FilePlus2, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { ContractTemplate } from '../../types';
import { SUNDAY_SURCHARGE } from '../../utils/contractTemplate';

interface TemplatePickerModalProps {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  /** Chamado quando o usuário escolhe um modelo (ou pula). */
  onPick: (selection: { template: ContractTemplate | null; sundaySession: boolean }) => void;
}

export function TemplatePickerModal({ title, subtitle, onClose, onPick }: TemplatePickerModalProps) {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sundaySession, setSundaySession] = useState(false);

  useEffect(() => {
    authFetch('/api/contract-templates')
      .then(r => r.ok ? r.json() : [])
      .then(d => setTemplates(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of templates) {
      if (!seen.has(t.category)) {
        seen.add(t.category);
        out.push(t.category);
      }
    }
    return out.sort();
  }, [templates]);

  const filtered = useMemo(() => {
    if (!activeCategory) return [];
    return templates
      .filter(t => t.category === activeCategory)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates, activeCategory]);

  const headerTitle = activeCategory ? activeCategory : (title || 'Escolha o tipo de contrato');
  const headerHint = activeCategory
    ? 'Qual modelo usar?'
    : (subtitle || 'Cada modelo tem cláusulas e valor padrão próprios');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            {activeCategory && (
              <button
                onClick={() => setActiveCategory(null)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Voltar"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">{headerTitle}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{headerHint}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-gray-400" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-gray-700 dark:text-gray-200 font-semibold mb-1">Nenhum modelo cadastrado</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Cadastre modelos em Contratos → Modelos.
              </p>
              <button
                onClick={() => onPick({ template: null, sundaySession })}
                className="text-xs text-gold-600 hover:text-gold-700 font-semibold"
              >
                Continuar sem modelo →
              </button>
            </div>
          ) : !activeCategory ? (
            <div className="space-y-1.5">
              {categories.map(cat => {
                const count = templates.filter(t => t.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 dark:border-gray-700 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 rounded-xl text-left transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center">
                        <FileText size={13} className="text-gold-600 dark:text-gold-400" />
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white text-sm">{cat}</span>
                    </div>
                    <span className="text-[11px] text-gray-400">
                      {count} {count === 1 ? 'modelo' : 'modelos'} <ChevronRight size={11} className="inline ml-1" />
                    </span>
                  </button>
                );
              })}
              <button
                onClick={() => onPick({ template: null, sundaySession: false })}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-dashed border-gray-300 dark:border-gray-600 hover:border-gold-400 rounded-xl text-left transition-all mt-3"
              >
                <div className="flex items-center gap-2.5">
                  <FilePlus2 size={14} className="text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-700 dark:text-gray-200 text-sm">Sem modelo</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Usar contrato em branco (legado)</p>
                  </div>
                </div>
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {filtered.map(t => {
                  const valor = (t.default_data?.valor_total as string) || '';
                  const prazo = t.default_data?.prazo_entrega_dias;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPick({ template: t, sundaySession })}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 dark:border-gray-700 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 rounded-xl text-left transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{t.name}</p>
                        {(valor || prazo) && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                            {valor && <>R$ {valor}</>}
                            {valor && prazo ? ' · ' : ''}
                            {prazo ? `entrega em ${prazo}d` : ''}
                          </p>
                        )}
                      </div>
                      <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
              <label className="mt-4 flex items-center gap-2 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <input
                  type="checkbox"
                  checked={sundaySession}
                  onChange={e => setSundaySession(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <div className="flex-1">
                  <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Sessão no domingo</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Acrescenta R$ {SUNDAY_SURCHARGE.toFixed(2).replace('.', ',')} ao valor do modelo
                  </p>
                </div>
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
