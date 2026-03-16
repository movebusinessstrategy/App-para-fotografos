import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import { AlertCircle, Camera, Check, CheckCircle2, Copy, Download, Edit2, FileText, Filter, MessageSquare, Plus, RefreshCw, Search, Sparkles, Trash2, Upload } from "lucide-react";

import ImportProgressModal, { ImportSummary } from "../components/ImportProgressModal";
import JobFormModal from "../components/shared/JobFormModal";
import ConfirmModal from "../components/shared/ConfirmModal";
import { LayoutOutletContext } from "../components/layout/AppLayout";
import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { parseDate } from "../utils/date";
import { cleanPhone, parseCSV, parseDateBR, parseValueBR } from "../utils/csvParser";
import { supabase } from "../integrations/supabase/client";
import { Client, Job, Opportunity } from "../types";

export default function ClientsPage() {
  const { openContactModal } = useOutletContext<LayoutOutletContext>();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/clients');
      setClients(await res.json());
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleContactOpp = (opp: Opportunity, client: Client | null) => {
    openContactModal({ opportunity: opp, client, onUpdate: fetchClients });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <Clients clients={clients} onUpdate={fetchClients} onContactOpp={handleContactOpp} />;
}

// --- Clients Component ---
function Clients({ clients, onUpdate, onContactOpp }: { clients: Client[], onUpdate: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [lastContactFilter, setLastContactFilter] = useState<string>('all');
  const [customMonth, setCustomMonth] = useState<string>('');
  const [customYear, setCustomYear] = useState<string>('');
  const [customDay, setCustomDay] = useState<string>('');
  const [searchName, setSearchName] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedClientIds, setSelectedClientIds] = useState<number[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTotal, setImportTotal] = useState(0);
  const [importProcessed, setImportProcessed] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const handleCloseImportModal = () => {
    setImportModalOpen(false);
    setImportSummary(null);
    setImportError(null);
    setImportProcessed(0);
    setImportDone(false);
  };

  const handleDelete = async (id: number) => {
    await authFetch(`/api/clients/${id}`, { method: 'DELETE' });
    onUpdate();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const toggleClientSelection = (clientId: number) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = paginatedClients.map((client) => client.id);
    const allVisibleSelected = visibleIds.every((id) => selectedClientIds.includes(id));

    if (allVisibleSelected) {
      setSelectedClientIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedClientIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedClientIds.length === 0) {
      alert('Selecione pelo menos um cliente.');
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const confirmBulkDelete = async () => {
    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .in('id', selectedClientIds);

      if (error) {
        console.error('Erro ao excluir clientes selecionados:', error);
        alert('Ocorreu um erro ao excluir os clientes selecionados.');
      } else {
        setSelectedClientIds([]);
        onUpdate();
      }
    } catch (error) {
      console.error('Erro ao excluir clientes selecionados:', error);
      alert('Ocorreu um erro ao excluir os clientes selecionados.');
    } finally {
      setConfirmDeleteOpen(false);
    }
  };

  const handleExportSelectedCSV = () => {
    if (selectedClientIds.length === 0) {
      alert('Selecione pelo menos um cliente.');
      return;
    }

    const selectedClients = clients.filter((client) => selectedClientIds.includes(client.id));

    const headers = ['id', 'name', 'phone', 'email', 'instagram', 'status', 'tier', 'total_invested'];

    const csvRows = [
      headers.join(','),
      ...selectedClients.map((client) =>
        [
          client.id,
          `"${client.name || ''}"`,
          `"${client.phone || ''}"`,
          `"${client.email || ''}"`,
          `"${client.instagram || ''}"`,
          `"${client.status || ''}"`,
          `"${client.tier || ''}"`,
          client.total_invested ?? 0
        ].join(',')
      )
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'clientes_selecionados.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const getActivityDates = (client: Client) => {
    const dates: Date[] = [];
    const contactDate = parseDate(client.last_contact_date);
    if (contactDate) dates.push(contactDate);
    
    if (client.jobs) {
      client.jobs.forEach(j => {
        const jobDate = parseDate(j.job_date);
        if (jobDate) dates.push(jobDate);
      });
    }
    return dates;
  };

  const getLatestActivityDate = (client: Client) => {
    const dates = getActivityDates(client);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates.map(d => d.getTime())));
  };

  const filteredClients = clients.filter(client => {
    const activityDates = getActivityDates(client);

    const matchesSearchName = client.name
      ?.toLowerCase()
      .includes(searchName.trim().toLowerCase());

    if (!matchesSearchName) return false;

    if (jobTypeFilter !== 'all') {
      const hasMatchingJobType = client.jobs?.some(job => job.job_type === jobTypeFilter);
      if (!hasMatchingJobType) return false;
    }

    if (customMonth || customYear || customDay) {
      if (activityDates.length === 0) return false;
      return activityDates.some(date => {
        const monthMatch = customMonth ? (date.getMonth() + 1).toString() === customMonth : true;
        const yearMatch = customYear ? date.getFullYear().toString() === customYear : true;
        const dayMatch = customDay ? date.getDate().toString() === customDay : true;
        return monthMatch && yearMatch && dayMatch;
      });
    }

    if (lastContactFilter === 'all') return true;

    const latestDate = getLatestActivityDate(client);
    if (!latestDate) return false;

    const now = new Date();
    const diffDays = Math.floor((now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

    if (lastContactFilter === '7days') return diffDays <= 7;
    if (lastContactFilter === '30days') return diffDays <= 30;
    if (lastContactFilter === '90days') return diffDays <= 90;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedClients = filteredClients.slice(startIndex, startIndex + itemsPerPage);
  const visibleClientIds = paginatedClients.map((client) => client.id);
  const allVisibleSelected =
    visibleClientIds.length > 0 &&
    visibleClientIds.every((id) => selectedClientIds.includes(id));

  const jobTypeOptions = [
    'Gestante',
    'Newborn',
    'Acompanhamento',
    'Smash the Cake',
    'Aniversário',
    'Batizado',
    'Família',
    'Marca Pessoal',
    'Natal',
    'Evento Externo',
    'Outros'
  ];

  useEffect(() => {
    setCurrentPage(1);
  }, [searchName, jobTypeFilter, lastContactFilter, customMonth, customYear, customDay, itemsPerPage]);

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'Diamond': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Platinum': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Gold': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Silver': return 'bg-slate-200 text-slate-700 border-slate-300';
      default: return 'bg-orange-100 text-orange-700 border-orange-200';
    }
  };

  const handleExportCSV = () => {
    window.open('/api/clients/export/csv', '_blank');
  };

  // ============================================
  // 🔄 NOVA FUNÇÃO DE IMPORTAÇÃO RESILIENTE
  // ============================================
  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvData = event.target?.result;
      if (typeof csvData !== 'string') return;

      let rows: Awaited<ReturnType<typeof parseCSV>> = [];
      try {
        rows = await parseCSV(csvData);
      } catch (err) {
        console.error('Erro ao ler CSV:', err);
        setImportError('Não foi possível ler o CSV. Verifique o formato.');
        setImportModalOpen(true);
        setImportDone(true);
        return;
      }

      const totalRows = Math.max(1, rows.length);
      setImportTotal(totalRows);
      setImportProcessed(0);
      setImportDone(false);
      setImportSummary(null);
      setImportError(null);
      setImportModalOpen(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        setImportError('Usuário não autenticado');
        setImportDone(true);
        return;
      }

      const todayIso = new Date().toISOString().split('T')[0];
      const getVal = (row: Record<string, any>, key: string) => {
        const found = Object.keys(row).find((k) => k.trim().toLowerCase() === key.trim().toLowerCase());
        return found ? row[found] : undefined;
      };
      const parseTimeBR = (timeStr?: string | null) => {
        if (!timeStr) return null;
        const clean = timeStr.trim().toLowerCase();
        if (!clean) return null;
        const normalized = clean.replace('h', ':');
        const [h = '00', m = '00'] = normalized.split(':');
        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
      };

      // Função para validar data
      const isValidDate = (dateStr: string | null | undefined): boolean => {
        if (!dateStr) return true; // null/undefined é ok, vai usar data padrão
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
      };

      let importedClientsCount = 0;
      let updatedClientsCount = 0;
      let importedJobsCount = 0;
      let updatedJobsCount = 0;
      let opportunitiesCreated = 0;
      const errors: ImportSummary['errors'] = [];

      for (let idx = 0; idx < rows.length; idx++) {
        const rowNumber = idx + 2; // cabeçalho conta como linha 1
        const row = rows[idx];

        try {
          const name = (row['NOME'] || '').trim();
          if (!name) {
            setImportProcessed(idx + 1);
            continue;
          }

          const phone = cleanPhone(getVal(row, 'Telefone'));
          const cpf = (getVal(row, 'CPF') || '').trim() || null;
          const email = (getVal(row, 'E-MAIL') || '').trim() || null;
          const ageVal = getVal(row, 'IDADE');
          const age = ageVal !== undefined && ageVal !== null ? Number(String(ageVal).replace(/\D/g, '')) || null : null;

          // Validar datas antes de processar
          const birthDateRaw = parseDateBR(getVal(row, 'NASCIMENTO'));
          const closingDateRaw = parseDateBR(getVal(row, 'Data de Fechamento'));
          const dataEnsaioRaw = parseDateBR(getVal(row, 'DATA DO ENSAIO'));

          if (birthDateRaw && !isValidDate(birthDateRaw)) {
            throw new Error(`Data de nascimento inválida: "${getVal(row, 'NASCIMENTO')}"`);
          }
          if (closingDateRaw && !isValidDate(closingDateRaw)) {
            throw new Error(`Data de fechamento inválida: "${getVal(row, 'Data de Fechamento')}"`);
          }
          if (dataEnsaioRaw && !isValidDate(dataEnsaioRaw)) {
            throw new Error(`Data do ensaio inválida: "${getVal(row, 'DATA DO ENSAIO')}"`);
          }

          let clientId: number | null = null;

          const findExisting = async (field: string, value: string | null) => {
            if (!value) return null;
            const { data, error } = await supabase
              .from('clients')
              .select('id')
              .eq(field, value)
              .eq('user_id', userId)
              .maybeSingle();
            if (error) {
              throw new Error(`Erro ao buscar cliente: ${error.message}`);
            }
            return data?.id || null;
          };

          clientId = await findExisting('cpf', cpf);
          if (!clientId && phone) clientId = await findExisting('phone', phone);
          if (!clientId) clientId = await findExisting('name', name);

          const clientData = {
            name,
            phone: phone || '',
            email: email || '',
            birth_date: birthDateRaw,
            cpf: cpf || '',
            cep: (getVal(row, 'CEP') || '').trim() || '',
            address: (getVal(row, 'Endereco') || '').trim() || '',
            neighborhood: (getVal(row, 'Bairro') || '').trim() || '',
            city: (getVal(row, 'Cidade') || '').trim() || '',
            state: (getVal(row, 'UF') || '').trim() || '',
            age: age,
            child_name: (getVal(row, 'Filho(a)') || '').trim() || '',
            instagram: (getVal(row, 'Instagram') || '').trim() || '',
            closing_date: closingDateRaw,
            lead_source: (getVal(row, 'Como Conheceu') || '').trim() || '',
            status: 'active',
            notes: '',
            user_id: userId,
          };

          if (clientId) {
            const { error: updateError } = await supabase.from('clients').update(clientData).eq('id', clientId);
            if (updateError) {
              throw new Error(`Erro ao atualizar cliente: ${updateError.message}`);
            }
            updatedClientsCount++;
          } else {
            const { data: newClient, error: insertError } = await supabase
              .from('clients')
              .insert(clientData)
              .select()
              .maybeSingle();
            if (insertError || !newClient?.id) {
              throw new Error(`Erro ao criar cliente: ${insertError?.message || 'resposta vazia'}`);
            }
            clientId = newClient.id;
            importedClientsCount++;
          }

          const ensaio = (getVal(row, 'ENSAIO') || '').trim();
          const pacote = (getVal(row, 'PACOTE') || '').trim();
          const dataEnsaio = dataEnsaioRaw || todayIso;
          const horario = parseTimeBR(getVal(row, 'HORÁRIO'));
          const valor = parseValueBR(getVal(row, 'VALOR'));
          const hasVideo = ((getVal(row, 'VIDEO') || '') as string).toString().toLowerCase().includes('sim');

          if (ensaio || dataEnsaio || valor > 0 || pacote || hasVideo) {
            const pagoField = ((row as any)['PAGO'] || '').toString().toLowerCase();
            const pago = pagoField.includes('sim') || pagoField.includes('pago');

            const jobData: any = {
              client_id: clientId,
              job_name: pacote ? `${ensaio || 'Ensaio'} - ${pacote}` : (ensaio || 'Ensaio'),
              job_type: ensaio || 'Outros',
              job_date: dataEnsaio,
              job_time: horario,
              amount: valor || 0,
              payment_status: pago ? 'paid' : 'pending',
              status: dataEnsaio && dataEnsaio < todayIso ? 'completed' : 'scheduled',
              user_id: userId,
              payment_method: 'Pix',
              job_end_time: null,
              notes: hasVideo ? `${pacote ? `${pacote} · ` : ''}Vídeo incluso` : (pacote || ''),
            };

            const { data: existingJob, error: selectJobError } = await supabase
              .from('jobs')
              .select('id')
              .eq('client_id', clientId)
              .eq('job_type', jobData.job_type)
              .eq('job_date', dataEnsaio || '')
              .eq('user_id', userId)
              .maybeSingle();

            if (selectJobError) {
              throw new Error(`Erro ao buscar trabalho: ${selectJobError.message}`);
            }

            if (existingJob?.id) {
              const { error: jobUpdateError } = await supabase.from('jobs').update(jobData).eq('id', existingJob.id);
              if (jobUpdateError) {
                throw new Error(`Erro ao atualizar trabalho: ${jobUpdateError.message}`);
              }
              updatedJobsCount++;
            } else {
              const { data: newJob, error: jobInsertError } = await supabase
                .from('jobs')
                .insert(jobData)
                .select('id, job_date, job_type')
                .maybeSingle();

              if (jobInsertError) {
                throw new Error(`Erro ao criar trabalho: ${jobInsertError.message}`);
              }

              importedJobsCount++;
              const insertedJob = newJob;

              // Geração de oportunidades
              if (insertedJob && insertedJob.job_type && insertedJob.job_date) {
                console.log('🔎 BUSCANDO REGRAS PARA:', insertedJob.job_type, 'USER:', userId);
                const { data: rules } = await supabase
                  .from('opportunity_rules')
                  .select('*')
                  .eq('trigger_job_type', insertedJob.job_type)
                  .eq('is_active', true)
                  .eq('user_id', userId);

                if (rules && rules.length > 0) {
                  console.log('🔥 REGRAS ENCONTRADAS:', rules);
                  console.log('🔥 JOB INSERIDO:', insertedJob);

                  for (const rule of rules) {
                    const baseDate = new Date(insertedJob.job_date);
                    baseDate.setDate(baseDate.getDate() + rule.days_offset);
                    const suggestedDate = baseDate.toISOString().split('T')[0];

                    const { data: existing } = await supabase
                      .from('opportunities')
                      .select('id')
                      .eq('client_id', clientId)
                      .eq('type', rule.target_job_type)
                      .eq('suggested_date', suggestedDate)
                      .maybeSingle();

                    if (!existing) {
                      const { error: oppError } = await supabase
                        .from('opportunities')
                        .insert({
                          client_id: clientId,
                          type: rule.target_job_type,
                          suggested_date: suggestedDate,
                          status: 'future',
                          notes: `Gerada automaticamente: ${insertedJob.job_type} → ${rule.target_job_type}`,
                          estimated_value: 0,
                          user_id: userId,
                          trigger_job_id: insertedJob.id ?? null,
                        });

                      if (!oppError) {
                        opportunitiesCreated++;
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (error: any) {
          // ⚠️ CAPTURA O ERRO, SALVA E CONTINUA!
          console.error(`❌ Erro na linha ${rowNumber}:`, error);
          errors.push({
            row: rowNumber,
            message: error?.message || 'Erro desconhecido',
          });
        }

        setImportProcessed(idx + 1);
      }

      // ✅ Finaliza com sucesso (mesmo com alguns erros)
      setImportProcessed(totalRows);
      setImportDone(true);
      setImportSummary({
        importedClientsCount,
        updatedClientsCount,
        importedJobsCount,
        updatedJobsCount,
        errors,
        totalProcessed: totalRows - errors.length,
        totalRows,
      });
      onUpdate();
    };

    reader.readAsText(file);
    e.target.value = '';
  };
  // ============================================
  // FIM DA FUNÇÃO DE IMPORTAÇÃO
  // ============================================

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Clientes</h3>
          <p className="text-gray-500 mt-1">Gerencie sua base de contatos e histórico.</p>
          <p className="text-sm text-gray-500 mt-2">
            <span className="font-semibold text-gray-700">{paginatedClients.length}</span> contatos exibidos de <span className="font-semibold text-gray-700">{clients.length}</span> na base
            {filteredClients.length !== clients.length && (
              <span> · <span className="font-semibold text-gray-700">{filteredClients.length}</span> encontrados com os filtros</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Buscar por nome do cliente..."
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl shadow-sm outline-none text-sm text-gray-700 w-72"
            />
          </div>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <FileText size={16} className="text-gray-400" />
            <select
              value={jobTypeFilter}
              onChange={(e) => setJobTypeFilter(e.target.value)}
              className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
            >
              <option value="all">Todos os ensaios</option>
              {jobTypeOptions.map((jobType) => (
                <option key={jobType} value={jobType}>{jobType}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <Filter size={16} className="text-gray-400" />
            <select 
              value={lastContactFilter}
              onChange={(e) => {
                setLastContactFilter(e.target.value);
                setCustomMonth('');
                setCustomYear('');
                setCustomDay('');
              }}
              className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
            >
              <option value="all">Último Contato: Todos</option>
              <option value="7days">Últimos 7 dias</option>
              <option value="30days">Últimos 30 dias</option>
              <option value="90days">Últimos 90 dias</option>
              <option value="custom">Personalizado...</option>
            </select>
          </div>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <span className="text-sm text-gray-500 font-medium">Por página</span>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="text-sm bg-transparent border-none outline-none text-gray-600 font-medium"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <button
            onClick={() => {
              setSearchName('');
              setJobTypeFilter('all');
              setLastContactFilter('all');
              setCustomMonth('');
              setCustomYear('');
              setCustomDay('');
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-sm text-indigo-600 font-bold hover:bg-indigo-50 rounded-xl transition-colors"
          >
            Limpar filtros
          </button>

          {lastContactFilter === 'custom' && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2"
            >
              <select 
                value={customMonth}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Mês (Todos)</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{format(new Date(2024, i, 1), 'MMMM', { locale: ptBR })}</option>
                ))}
              </select>
              <select 
                value={customYear}
                onChange={(e) => setCustomYear(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Ano (Todos)</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
                <option value="2022">2022</option>
              </select>
              <select 
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm outline-none text-gray-600 font-medium"
              >
                <option value="">Dia (Todos)</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
              {(customMonth || customYear || customDay) && (
                <button 
                  onClick={() => {
                    setCustomMonth('');
                    setCustomYear('');
                    setCustomDay('');
                  }}
                  className="text-xs text-indigo-600 font-bold hover:underline px-2"
                >
                  Limpar
                </button>
              )}
            </motion.div>
          )}

          <button 
            onClick={onUpdate}
            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
            title="Atualizar lista"
          >
            <RefreshCw size={20} />
          </button>
          
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <button 
                onClick={handleExportCSV}
                className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border-r border-gray-100"
                title="Exportar todos os clientes (CSV)"
              >
                <Download size={20} />
              </button>

              <button 
                onClick={handleExportSelectedCSV}
                className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border-r border-gray-100"
                title="Exportar clientes selecionados"
              >
                <FileText size={20} />
              </button>

              <label className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer" title="Importar Clientes (CSV)">
                <Upload size={20} />
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleImportCSV} 
                  className="hidden" 
                />
              </label>
            </div>

            <button
              onClick={handleDeleteSelected}
              disabled={selectedClientIds.length === 0}
              className="px-3 py-2 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Excluir selecionados
            </button>
          </div>

          <button 
            onClick={() => { setSelectedClient(null); setShowModal(true); }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} />
            Novo Cliente
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {selectedClientIds.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-indigo-50">
            <div className="text-sm font-semibold text-indigo-700">
              {selectedClientIds.length} cliente(s) selecionado(s)
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportSelectedCSV}
                className="px-3 py-2 text-sm font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50"
              >
                Exportar selecionados
              </button>

              <button
                onClick={() => setSelectedClientIds([])}
                className="px-3 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                Limpar seleção
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-4 font-medium w-12">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="px-6 py-4 font-medium">Nome / Nível</th>
                <th className="px-6 py-4 font-medium">Contato</th>
                <th className="px-6 py-4 font-medium">Investimento</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedClients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedClientIds.includes(client.id)}
                      onChange={() => toggleClientSelection(client.id)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900">{client.name}</div>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded border uppercase",
                        getTierColor(client.tier || 'Bronze')
                      )}>
                        {client.tier}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <div className="text-xs text-gray-500">Desde {format(parseDate(client.created_at) || new Date(), 'MMM yyyy', { locale: ptBR })}</div>
                      
                      {/* Show matching jobs if filtering */}
                      {(customMonth || customYear || customDay) && client.jobs?.filter(j => {
                        const date = parseDate(j.job_date);
                        if (!date) return false;
                        const monthMatch = customMonth ? (date.getMonth() + 1).toString() === customMonth : true;
                        const yearMatch = customYear ? date.getFullYear().toString() === customYear : true;
                        const dayMatch = customDay ? date.getDate().toString() === customDay : true;
                        return monthMatch && yearMatch && dayMatch;
                      }).map(job => (
                        <div key={job.id} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-100">
                          <CheckCircle2 size={10} />
                          {job.job_type} ({format(parseDate(job.job_date)!, 'dd/MM/yy')})
                        </div>
                      ))}

                      {client.opportunities?.map((opp) => (
                        <button 
                          key={opp.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onContactOpp(opp, client);
                          }}
                          className={cn(
                            "flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all animate-pulse shadow-md",
                            opp.priority === 'urgent' ? "bg-red-600 text-white border-red-700" : 
                            opp.priority === 'active' ? "bg-amber-600 text-white border-amber-700" :
                            "bg-indigo-600 text-white border-indigo-700"
                          )}
                          title={`Sugerido para: ${format(new Date(opp.suggested_date), 'dd/MM/yyyy')}`}
                        >
                          <Sparkles size={12} />
                          <span className="uppercase tracking-wider">Oportunidade: {opp.type}</span>
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 group/phone">
                      <div className="text-sm text-gray-700">{client.phone}</div>
                      <button 
                        onClick={() => copyToClipboard(client.phone)}
                        className="p-1 text-gray-400 hover:text-indigo-600 opacity-0 group-hover/phone:opacity-100 transition-opacity"
                        title="Copiar WhatsApp"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500">{client.email}</div>
                    {getLatestActivityDate(client) && (
                      <div className="text-[10px] text-indigo-500 font-medium mt-1">
                        Última atividade: {format(getLatestActivityDate(client)!, 'dd/MM/yyyy')}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900">R$ {(client.total_invested ?? 0).toLocaleString('pt-BR')}</div>
                    <div className="text-xs text-gray-500">{client.jobs?.length || 0} trabalhos realizados</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      client.status === 'active' ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                    )}>
                      {client.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => { setSelectedClient(client); setShowModal(true); }}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                        title="Editar Perfil"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Excluir Cliente"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <div className="text-sm text-gray-500">
            <span className="font-bold text-gray-700">{paginatedClients.length}</span> contatos exibidos de <span className="font-bold text-gray-700">{clients.length}</span> na base
            {filteredClients.length !== clients.length && (
              <span> · <span className="font-bold text-gray-700">{filteredClients.length}</span> encontrados com os filtros</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={safeCurrentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white disabled:opacity-40"
            >
              Anterior
            </button>

            <div className="px-3 py-2 text-sm font-bold text-gray-700">
              Página {safeCurrentPage} de {totalPages}
            </div>

            <button
              disabled={safeCurrentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 bg-white disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <ClientModal 
          client={selectedClient} 
          onClose={() => setShowModal(false)} 
          onSave={() => { setShowModal(false); onUpdate(); }} 
          onContactOpp={onContactOpp}
        />
      )}

      <ImportProgressModal
        open={importModalOpen}
        total={importTotal}
        processed={importProcessed}
        done={importDone}
        summary={importSummary}
        error={importError}
        onClose={handleCloseImportModal}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Excluir clientes"
        message={`Deseja excluir ${selectedClientIds.length} cliente(s)? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}

function ClientModal({ client: initialClient, onClose, onSave, onContactOpp }: { client: Client | null, onClose: () => void, onSave: () => void, onContactOpp: (opp: Opportunity, client: Client | null) => void }) {
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'opportunities'>('info');
  const [client, setClient] = useState<Client | null>(initialClient);
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [formData, setFormData] = useState({
    name: initialClient?.name || '',
    phone: initialClient?.phone || '',
    email: initialClient?.email || '',
    birth_date: initialClient?.birth_date || '',
    cpf: initialClient?.cpf || '',
    cep: initialClient?.cep || '',
    address: initialClient?.address || '',
    neighborhood: initialClient?.neighborhood || '',
    city: initialClient?.city || '',
    state: initialClient?.state || '',
    age: initialClient?.age ?? '',
    child_name: initialClient?.child_name || '',
    instagram: initialClient?.instagram || '',
    closing_date: initialClient?.closing_date || '',
    first_contact_date: initialClient?.first_contact_date || '',
    last_contact_date: initialClient?.last_contact_date || '',
    notes: initialClient?.notes || '',
    lead_source: initialClient?.lead_source || 'Instagram',
    status: initialClient?.status || 'active'
  });

  useEffect(() => {
    if (initialClient) {
      fetchClientDetails();
    }
  }, [initialClient]);

  useEffect(() => {
    if (formData.birth_date) {
      const birthDate = new Date(formData.birth_date);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age >= 0 && age !== formData.age) {
        setFormData(prev => ({ ...prev, age }));
      }
    }
  }, [formData.birth_date]);

  useEffect(() => {
    const cep = formData.cep.replace(/\D/g, '');
    if (cep.length === 8) {
      const fetchAddress = async () => {
        try {
          const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          const data = await res.json();
          if (!data.erro) {
            setFormData(prev => ({
              ...prev,
              address: data.logradouro,
              neighborhood: data.bairro,
              city: data.localidade,
              state: data.uf
            }));
          }
        } catch (error) {
          console.error("Erro ao buscar CEP:", error);
        }
      };
      fetchAddress();
    }
  }, [formData.cep]);

  const fetchClientDetails = async () => {
    if (!initialClient) return;
    const res = await authFetch(`/api/clients/${initialClient.id}`);
    setClient(await res.json());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = initialClient ? 'PUT' : 'POST';
    const url = initialClient ? `/api/clients/${initialClient.id}` : '/api/clients';
    
    try {
      const response = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      if (!response.ok) {
        throw new Error('Erro ao salvar cliente');
      }
      
      onSave();
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Ocorreu um erro ao salvar o cliente. Por favor, tente novamente.');
    }
  };

  const handleJobSaved = async () => {
    setShowJobModal(false);
    setEditingJob(null);
    await fetchClientDetails();
    onSave();
  };

  const handleEditJob = (job: Job) => {
    setEditingJob(job);
    setShowJobModal(true);
  };

  const handleDeleteJob = async (jobId: number) => {
    await authFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    await fetchClientDetails();
    onSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'submit') {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const elements = Array.from(form.elements).filter(el => 
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && 
        !el.disabled && el.type !== 'hidden'
      ) as HTMLElement[];
      
      const index = elements.indexOf(e.target as any);
      if (index > -1 && index < elements.length - 1) {
        elements[index + 1].focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-bold">{initialClient ? 'Perfil do Cliente' : 'Novo Cliente'}</h3>
            {client?.tier && (
              <span className="text-xs font-bold px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 uppercase">
                Nível {client.tier}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        {initialClient && (
          <div className="flex border-b border-gray-100 px-6 bg-white">
            <button 
              onClick={() => setActiveTab('info')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'info' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Dados Pessoais
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'history' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Histórico de Trabalhos
            </button>
            <button 
              onClick={() => setActiveTab('opportunities')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'opportunities' ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400"
              )}
            >
              Oportunidades
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'info' ? (
            <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo</label>
                  <input 
                    required
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CPF</label>
                  <input 
                    type="text" 
                    value={formData.cpf}
                    onChange={e => setFormData({...formData, cpf: e.target.value})}
                    placeholder="000.000.000-00"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label>
                  <input 
                    type="text" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-mail</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Instagram</label>
                  <input 
                    type="text" 
                    value={formData.instagram}
                    onChange={e => setFormData({...formData, instagram: e.target.value})}
                    placeholder="@usuario"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data de Nascimento</label>
                  <input 
                    type="date" 
                    value={formData.birth_date}
                    onChange={e => setFormData({...formData, birth_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Idade</label>
                  <input 
                    type="number" 
                    value={formData.age}
                    onChange={e => setFormData({...formData, age: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Filho(a)</label>
                  <input 
                    type="text" 
                    value={formData.child_name}
                    onChange={e => setFormData({...formData, child_name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                  <input 
                    type="text" 
                    value={formData.cep}
                    onChange={e => setFormData({...formData, cep: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Endereço</label>
                  <input 
                    type="text" 
                    value={formData.address}
                    onChange={e => setFormData({...formData, address: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label>
                  <input 
                    type="text" 
                    value={formData.neighborhood}
                    onChange={e => setFormData({...formData, neighborhood: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label>
                  <input 
                    type="text" 
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">UF</label>
                  <input 
                    type="text" 
                    value={formData.state}
                    onChange={e => setFormData({...formData, state: e.target.value})}
                    maxLength={2}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data de Fechamento</label>
                  <input 
                    type="date" 
                    value={formData.closing_date}
                    onChange={e => setFormData({...formData, closing_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Origem do Lead</label>
                  <select 
                    value={formData.lead_source}
                    onChange={e => setFormData({...formData, lead_source: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option>Instagram</option>
                    <option>WhatsApp</option>
                    <option>Patrocinado</option>
                    <option>Indicação</option>
                    <option>Google</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                  <select 
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações</label>
                <textarea 
                  rows={3}
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose} className="px-6 py-2 text-gray-600 font-medium">Cancelar</button>
                <button type="submit" className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
                  {initialClient ? 'Salvar Alterações' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          ) : activeTab === 'history' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800">Trabalhos Realizados</h4>
                <button 
                  onClick={() => { setEditingJob(null); setShowJobModal(true); }}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={16} /> Registrar Novo Trabalho
                </button>
              </div>

              <div className="space-y-3">
                {client?.jobs?.map(job => (
                  <div key={job.id} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-indigo-200 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
                        <Camera size={20} />
                      </div>
                      <div>
                        <div className="font-bold text-gray-900">{job.job_name}</div>
                        <div className="text-xs text-gray-500">{job.job_type} • {job.job_date && !isNaN(new Date(job.job_date).getTime())
                          ? format(new Date(job.job_date), 'dd/MM/yyyy')
                          : '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold text-gray-900">R$ {(job.amount ?? 0).toLocaleString('pt-BR')}</div>
                        <div className="flex items-center gap-2 justify-end">
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                            job.status === 'completed' ? "bg-emerald-100 text-emerald-700" : 
                            job.status === 'cancelled' ? "bg-red-100 text-red-700" : 
                            "bg-blue-100 text-blue-700"
                          )}>
                            {job.status === 'completed' ? 'Concluído' : job.status === 'cancelled' ? 'Cancelado' : 'Agendado'}
                          </span>
                          <div className="text-[10px] font-bold uppercase text-gray-400">{job.payment_method} • {job.payment_status === 'paid' ? 'Pago' : 'Pendente'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.status === 'scheduled' && (
                          <button 
                            onClick={async () => {
                              await authFetch(`/api/jobs/${job.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ...job, status: 'completed' })
                              });
                              fetchClientDetails();
                              onSave();
                            }}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Marcar como Concluído"
                          >
                            <Check size={16} />
                          </button>
                        )}
                        <button 
                          onClick={() => handleEditJob(job)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.jobs || client.jobs.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 italic">
                    Nenhum trabalho registrado ainda.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800">Oportunidades de Venda</h4>
                <div className="text-xs text-gray-500 italic">Geradas automaticamente com base no histórico</div>
              </div>

              <div className="space-y-3">
                {client?.opportunities?.map(opp => (
                  <div key={opp.id} className={cn(
                    "p-4 rounded-xl border transition-all",
                    opp.priority === 'urgent' ? "bg-red-50/30 border-red-100" : 
                    opp.priority === 'active' ? "bg-amber-50/30 border-amber-100" :
                    "bg-white border-gray-100"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          opp.priority === 'urgent' ? "bg-red-100 text-red-600" : 
                          opp.priority === 'active' ? "bg-amber-100 text-amber-600" :
                          "bg-indigo-50 text-indigo-600"
                        )}>
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{opp.type}</div>
                          <div className="text-xs text-gray-500">
                            Sugerido para: {format(new Date(opp.suggested_date), 'dd/MM/yyyy')}
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                        opp.priority === 'urgent' ? "bg-red-100 text-red-700" : 
                        opp.priority === 'active' ? "bg-amber-100 text-amber-700" :
                        "bg-indigo-100 text-indigo-700"
                      )}>
                        {opp.priority === 'urgent' ? 'Urgente' : opp.priority === 'active' ? 'Ativo' : 'Futuro'}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100/50">
                      <div className="text-xs font-bold text-gray-400 uppercase">Status: {opp.status}</div>
                      <div className="flex gap-2">
                        <button 
                          onClick={async () => {
                            await authFetch(`/api/opportunities/${opp.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'dismissed' })
                            });
                            fetchClientDetails();
                            onSave();
                          }}
                          className="text-xs font-bold text-gray-400 hover:text-red-600 px-3 py-1 rounded-lg hover:bg-red-50 transition-all"
                        >
                          Ignorar
                        </button>
                        <button 
                          onClick={() => {
                            if (client) {
                              onContactOpp(opp, client);
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                        >
                          <MessageSquare size={12} />
                          Contatar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.opportunities || client.opportunities.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 italic">
                    Nenhuma oportunidade gerada para este cliente ainda.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {showJobModal && client && (
        <JobFormModal 
          clientId={client.id} 
          job={editingJob} 
          onClose={() => { setShowJobModal(false); setEditingJob(null); }} 
          onSave={handleJobSaved} 
        />
      )}
    </div>
  );
}
