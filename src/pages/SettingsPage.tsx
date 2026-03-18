import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Calendar, CheckCircle2, Edit2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { ConfirmModal } from "../components/ui/ConfirmModal";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { OpportunityRule } from "../types";

export default function SettingsPage() {
  const [rules, setRules] = useState<OpportunityRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/opportunity-rules');
      setRules(await res.json());
    } catch (error) {
      console.error('Erro ao carregar regras:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400" />
      </div>
    );
  }

  return <SettingsPageContent rules={rules} onUpdate={fetchRules} />;
}

// --- Settings Page Component ---
function SettingsPageContent({ rules, onUpdate }: { rules: OpportunityRule[], onUpdate: () => void }) {
  const [editingRule, setEditingRule] = useState<OpportunityRule | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
    title: string;
    message: string;
    variant?: "danger" | "warning";
  }>({ open: false, onConfirm: () => {}, title: "", message: "" });
  const [googleConfig, setGoogleConfig] = useState<{
    hasClientId: boolean;
    hasClientSecret: boolean;
    clientIdPreview: string;
    clientIdLength: number;
    currentRedirectUri: string;
    envAppUrl: string;
  } | null>(null);

  const fetchGoogleConfig = async () => {
    try {
      const res = await authFetch('/api/auth/google/config-check');
      const data = await res.json();
      setGoogleConfig(data);
    } catch (error) {
      console.error('Error fetching Google config:', error);
    }
  };

  const checkGoogleStatus = async () => {
    try {
      const res = await authFetch('/api/auth/google/status');
      const data = await res.json();
      setGoogleConnected(data.connected);
    } catch (error) {
      console.error('Error checking Google status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkGoogleStatus();
    fetchGoogleConfig();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        checkGoogleStatus();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectGoogle = async () => {
    try {
      const res = await authFetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth_popup', 'width=600,height=700');
    } catch (error) {
      console.error('Error getting Google auth URL:', error);
    }
  };

  const handleDisconnectGoogle = () => {
    setConfirmModal({
      open: true,
      title: "Desconectar Google",
      message: "Deseja desconectar sua conta do Google Calendar?",
      variant: "warning",
      onConfirm: async () => {
        await authFetch('/api/auth/google/disconnect', { method: 'POST' });
        checkGoogleStatus();
      },
    });
  };

  const handleSyncAll = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/auth/google/sync-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`${data.pushed} trabalhos enviados e ${data.pulled} eventos importados do Google Calendar!`);
      } else {
        alert('Erro ao sincronizar trabalhos.');
      }
    } catch (error) {
      console.error('Error syncing all jobs:', error);
      alert('Erro ao conectar com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    setConfirmModal({
      open: true,
      title: "Excluir regra",
      message: "Deseja excluir esta regra?",
      variant: "danger",
      onConfirm: async () => {
        await authFetch(`/api/opportunity-rules/${id}`, { method: 'DELETE' });
        onUpdate();
      },
    });
  };

  return (
    <>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Configurações</h3>
            <p className="text-gray-500 dark:text-gray-400">Gerencie as regras de automação e integrações.</p>
          </div>
        <button 
          onClick={() => { setEditingRule(null); setShowModal(true); }}
          className="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
        >
          <Plus size={20} /> Nova Regra
        </button>
      </div>

      {/* Google Calendar Integration */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm dark:shadow-lg dark:shadow-black/10 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Calendar size={24} />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 dark:text-white">Google Calendar</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">Sincronize seus agendamentos automaticamente com o Google Calendar.</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                Certifique-se de adicionar a URL de callback no Google Cloud Console: <br/>
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-gray-600 dark:text-gray-300">{window.location.origin}/api/auth/google/callback</code>
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 italic">
                Dica: O Google exige que a URL seja exatamente igual, incluindo o protocolo (https://).
              </p>
              {googleConfig && googleConfig.hasClientId && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300">
                    <span className="font-bold">ID do Cliente (Início...Fim):</span> {googleConfig.clientIdPreview}
                  </p>
                  <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300">
                    <span className="font-bold">Tamanho:</span> {googleConfig.clientIdLength} caracteres
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 italic">
                    Verifique se o ID acima corresponde exatamente ao do seu Google Cloud Console.
                  </p>
                </div>
              )}
              {googleConfig && (!googleConfig.hasClientId || !googleConfig.hasClientSecret) && (
                <p className="text-[10px] text-red-500 dark:text-red-400 font-bold mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> Credenciais (Client ID/Secret) não configuradas no ambiente!
                </p>
              )}
            </div>
          </div>
          {loading ? (
            <div className="animate-spin text-indigo-600 dark:text-indigo-400">
              <RefreshCw size={20} />
            </div>
          ) : googleConnected ? (
            <div className="flex items-center gap-4">
              <button 
                onClick={handleSyncAll}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/30 transition-colors text-sm"
              >
                <RefreshCw size={16} /> Sincronizar Tudo
              </button>
              <div className="flex items-center gap-3 border-l border-gray-100 dark:border-gray-700 pl-4">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm font-bold bg-emerald-50 dark:bg-emerald-500/20 px-3 py-1 rounded-full">
                  <CheckCircle2 size={16} /> Conectado
                </span>
                <button 
                  onClick={handleDisconnectGoogle}
                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-bold transition-colors"
                >
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={handleConnectGoogle}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              Conectar Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm dark:shadow-lg dark:shadow-black/10 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Gatilho (Tipo de Ensaio)</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Oportunidade Gerada</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Tempo (Dias)</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {rules.map(rule => (
              <tr key={rule.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="px-6 py-4">
                  <span className="font-bold text-gray-900 dark:text-white">{rule.trigger_job_type}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium">{rule.target_job_type}</span>
                </td>
                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{rule.days_offset} dias</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                    rule.is_active 
                      ? "bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                      : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                  )}>
                    {rule.is_active ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => { setEditingRule(rule); setShowModal(true); }}
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RuleModal 
          rule={editingRule} 
          onClose={() => setShowModal(false)} 
          onSave={() => { setShowModal(false); onUpdate(); }} 
        />
      )}
      </div>

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirmar"
        variant={confirmModal.variant || "danger"}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}

function RuleModal({ rule, onClose, onSave }: { rule: OpportunityRule | null, onClose: () => void, onSave: () => void }) {
  const [formData, setFormData] = useState({
    trigger_job_type: rule?.trigger_job_type || 'Gestante',
    target_job_type: rule?.target_job_type || 'Newborn',
    days_offset: rule?.days_offset || 30,
    is_active: rule ? Boolean(rule.is_active) : true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = rule ? 'PUT' : 'POST';
    const url = rule ? `/api/opportunity-rules/${rule.id}` : '/api/opportunity-rules';
    
    await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        is_active: formData.is_active ? 1 : 0
      })
    });
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-black/30 w-full max-md overflow-hidden border border-transparent dark:border-gray-800"
      >
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            {rule ? 'Editar Regra' : 'Nova Regra de Oportunidade'}
          </h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Tipo de Ensaio (Gatilho)</label>
            <select 
              value={formData.trigger_job_type}
              onChange={e => setFormData({...formData, trigger_job_type: e.target.value})}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            >
              <option value="Gestante">Gestante</option>
              <option value="Newborn">Newborn</option>
              <option value="Acompanhamento">Acompanhamento</option>
              <option value="Smash the Cake">Smash the Cake</option>
              <option value="Aniversário">Aniversário</option>
              <option value="Família">Família</option>
              <option value="Outros">Outros</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Oportunidade a Gerar</label>
            <input 
              required
              type="text" 
              value={formData.target_job_type}
              onChange={e => setFormData({...formData, target_job_type: e.target.value})}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Dias após o ensaio</label>
            <input 
              required
              type="number" 
              value={formData.days_offset}
              onChange={e => setFormData({...formData, days_offset: Number(e.target.value)})}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="is_active"
              checked={formData.is_active}
              onChange={e => setFormData({...formData, is_active: e.target.checked})}
              className="w-4 h-4 text-indigo-600 dark:text-indigo-400 border-gray-300 dark:border-gray-600 rounded focus:ring-indigo-500 dark:focus:ring-indigo-400 bg-white dark:bg-gray-800"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700 dark:text-gray-300">Regra Ativa</label>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-2 text-gray-500 dark:text-gray-400 font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors">Cancelar</button>
            <button type="submit" className="px-8 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors">
              Salvar Regra
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
