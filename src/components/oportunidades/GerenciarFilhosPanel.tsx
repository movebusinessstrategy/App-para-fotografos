import React, { useEffect, useState } from 'react';
import { Baby, Plus, Trash2, Search, ChevronDown, X, Check } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { oportunidadesApi } from '../../services/api/oportunidades';
import { Filho } from '../../types';
import { cn } from '../../utils/cn';

interface Client {
  id: number;
  name: string;
  phone: string;
  birth_date?: string;
}

interface FilhoFormData {
  nome: string;
  data_nascimento: string;
  sexo: string;
}

const emptyForm = (): FilhoFormData => ({ nome: '', data_nascimento: '', sexo: '' });

export function GerenciarFilhosPanel() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [filhos, setFilhos] = useState<Filho[]>([]);
  const [filhosLoading, setFilhosLoading] = useState(false);

  const [form, setForm] = useState<FilhoFormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Edição da data de nascimento da mãe
  const [maeBirthDate, setMaeBirthDate] = useState('');
  const [savingMae, setSavingMae] = useState(false);

  useEffect(() => {
    authFetch('/api/clients')
      .then(r => r.json())
      .then((data: any[]) => setClients(data.map(c => ({ id: c.id, name: c.name, phone: c.phone, birth_date: c.birth_date }))))
      .catch(console.error)
      .finally(() => setClientsLoading(false));
  }, []);

  const loadFilhos = async (clientId: number) => {
    setFilhosLoading(true);
    try {
      const data = await oportunidadesApi.getFilhos(clientId);
      setFilhos(data);
    } catch {
      setFilhos([]);
    } finally {
      setFilhosLoading(false);
    }
  };

  const handleSelectClient = (c: Client) => {
    setSelectedClient(c);
    setSearch('');
    setDropdownOpen(false);
    setMaeBirthDate(c.birth_date || '');
    setForm(emptyForm());
    setError('');
    setSuccess('');
    loadFilhos(c.id);
  };

  const handleAddFilho = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    if (!form.nome.trim() || !form.data_nascimento) {
      setError('Nome e data de nascimento são obrigatórios.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const novo = await oportunidadesApi.createFilho({
        cliente_id: selectedClient.id,
        nome: form.nome.trim(),
        data_nascimento: form.data_nascimento,
        sexo: form.sexo || undefined,
      });
      setFilhos(prev => [...prev, novo]);
      setForm(emptyForm());
      setSuccess(`${novo.nome} cadastrado com sucesso!`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message || 'Erro ao cadastrar filho');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFilho = async (id: string) => {
    if (!confirm('Remover este filho?')) return;
    try {
      await oportunidadesApi.deleteFilho(id);
      setFilhos(prev => prev.filter(f => f.id !== id));
    } catch (e: any) {
      setError(e.message || 'Erro ao remover');
    }
  };

  const handleSaveMae = async () => {
    if (!selectedClient || !maeBirthDate) return;
    setSavingMae(true);
    try {
      await oportunidadesApi.updateMaeNascimento(selectedClient.id, maeBirthDate);
      setSelectedClient(prev => prev ? { ...prev, birth_date: maeBirthDate } : prev);
      setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, birth_date: maeBirthDate } : c));
      setSuccess('Data de nascimento da mãe atualizada!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar');
    } finally {
      setSavingMae(false);
    }
  };

  const calcIdade = (dateStr: string) => {
    const d = new Date(dateStr);
    const hoje = new Date();
    return hoje.getFullYear() - d.getUTCFullYear();
  };

  const calcIdadeMeses = (dateStr: string) => {
    const d = new Date(dateStr);
    const hoje = new Date();
    const meses = (hoje.getFullYear() - d.getUTCFullYear()) * 12 + (hoje.getMonth() - d.getUTCMonth());
    return meses;
  };

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  );

  return (
    <div className="space-y-6">
      {/* Seletor de cliente */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Search size={16} className="text-indigo-500" />
          Selecionar Cliente
        </h3>

        <div className="relative">
          <div
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all',
              dropdownOpen
                ? 'border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-500/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
            )}
            onClick={() => setDropdownOpen(o => !o)}
          >
            <Baby size={16} className="text-gray-400 flex-shrink-0" />
            <span className={cn('flex-1 text-sm', selectedClient ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400')}>
              {selectedClient ? selectedClient.name : 'Selecione um cliente...'}
            </span>
            {selectedClient && (
              <button
                onClick={e => { e.stopPropagation(); setSelectedClient(null); setFilhos([]); setMaeBirthDate(''); }}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
              >
                <X size={14} />
              </button>
            )}
            <ChevronDown size={14} className={cn('text-gray-400 transition-transform', dropdownOpen && 'rotate-180')} />
          </div>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 max-h-64 overflow-hidden flex flex-col">
              <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar cliente..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 outline-none"
                />
              </div>
              <div className="overflow-y-auto flex-1">
                {clientsLoading ? (
                  <div className="p-4 text-center text-sm text-gray-400">Carregando...</div>
                ) : filteredClients.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-400">Nenhum cliente encontrado</div>
                ) : filteredClients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectClient(c)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white flex items-center justify-between"
                  >
                    <span>{c.name}</span>
                    {c.birth_date && <span className="text-xs text-gray-400">{new Date(c.birth_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedClient && (
        <>
          {/* Aniversário da mãe */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="text-pink-500">🎂</span>
              Aniversário da Mãe — {selectedClient.name}
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Data de nascimento</label>
                <input
                  type="date"
                  value={maeBirthDate}
                  onChange={e => setMaeBirthDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
              </div>
              <button
                onClick={handleSaveMae}
                disabled={savingMae || !maeBirthDate}
                className="mt-5 flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Check size={14} />
                {savingMae ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>

          {/* Lista de filhos */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Baby size={16} className="text-indigo-500" />
              Filhos de {selectedClient.name}
              {filhos.length > 0 && (
                <span className="ml-auto text-xs bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                  {filhos.length}
                </span>
              )}
            </h3>

            {filhosLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-50 dark:bg-gray-800 animate-pulse" />)}
              </div>
            ) : filhos.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Nenhum filho cadastrado ainda</p>
            ) : (
              <div className="space-y-2 mb-4">
                {filhos.map(f => {
                  const meses = calcIdadeMeses(f.data_nascimento);
                  const anos = calcIdade(f.data_nascimento);
                  const idadeStr = meses < 24 ? `${meses} meses` : `${anos} anos`;
                  return (
                    <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 flex items-center justify-center">
                          <Baby size={14} className="text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {f.nome}
                            {f.sexo && <span className="ml-1.5 text-xs text-gray-400">({f.sexo === 'M' ? 'Menino' : f.sexo === 'F' ? 'Menina' : f.sexo})</span>}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(f.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR')} · {idadeStr}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteFilho(f.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Formulário novo filho */}
            <form onSubmit={handleAddFilho} className="border-t border-gray-100 dark:border-gray-800 pt-4 mt-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Adicionar filho(a)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Nome *</label>
                  <input
                    type="text"
                    placeholder="Nome do filho(a)"
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Nascimento *</label>
                  <input
                    type="date"
                    value={form.data_nascimento}
                    onChange={e => setForm(f => ({ ...f, data_nascimento: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Sexo</label>
                  <select
                    value={form.sexo}
                    onChange={e => setForm(f => ({ ...f, sexo: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  >
                    <option value="">Não informado</option>
                    <option value="M">Menino</option>
                    <option value="F">Menina</option>
                  </select>
                </div>
              </div>

              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
              {success && <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1"><Check size={12} />{success}</p>}

              <button
                type="submit"
                disabled={saving}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Plus size={15} />
                {saving ? 'Salvando...' : 'Adicionar Filho(a)'}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
