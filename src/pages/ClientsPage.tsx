import React, { useEffect, useState, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import { 
  AlertTriangle,
  Camera, 
  Check, 
  CheckCircle2, 
  ChevronDown,
  Copy, 
  Download, 
  Edit2, 
  MessageSquare, 
  Plus, 
  RefreshCw, 
  Search, 
  Sparkles, 
  Trash2, 
  Upload, 
  X,
  Calendar,
  Award,
  SlidersHorizontal
} from "lucide-react";

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

import * as Select from '@radix-ui/react-select';

// ============================================
// COMPONENTE DE FILTRO DROPDOWN PREMIUM (RADIX UI)
// ============================================
interface FilterDropdownProps {
  label: string;
  value: string;
  options: { value: string; label: string; icon?: React.ReactNode }[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  activeColor?: string;
}

function FilterDropdown({ label, value, options, onChange, icon, activeColor = "indigo" }: FilterDropdownProps) {
  const selectedOption = options.find(opt => opt.value === value);
  const isActive = value !== 'all' && value !== '';

  const colorClasses: Record<string, { bg: string; text: string; border: string; hover: string }> = {
    indigo: { 
      bg: 'bg-indigo-50 dark:bg-indigo-500/20', 
      text: 'text-indigo-700 dark:text-indigo-400', 
      border: 'border-indigo-200 dark:border-indigo-500/30', 
      hover: 'hover:bg-indigo-100 dark:hover:bg-indigo-500/30' 
    },
    amber: { 
      bg: 'bg-amber-50 dark:bg-amber-500/20', 
      text: 'text-amber-700 dark:text-amber-400', 
      border: 'border-amber-200 dark:border-amber-500/30', 
      hover: 'hover:bg-amber-100 dark:hover:bg-amber-500/30' 
    },
    violet: { 
      bg: 'bg-violet-50 dark:bg-violet-500/20', 
      text: 'text-violet-700 dark:text-violet-400', 
      border: 'border-violet-200 dark:border-violet-500/30', 
      hover: 'hover:bg-violet-100 dark:hover:bg-violet-500/30' 
    },
    emerald: { 
      bg: 'bg-emerald-50 dark:bg-emerald-500/20', 
      text: 'text-emerald-700 dark:text-emerald-400', 
      border: 'border-emerald-200 dark:border-emerald-500/30', 
      hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-500/30' 
    },
    rose: { 
      bg: 'bg-rose-50 dark:bg-rose-500/20', 
      text: 'text-rose-700 dark:text-rose-400', 
      border: 'border-rose-200 dark:border-rose-500/30', 
      hover: 'hover:bg-rose-100 dark:hover:bg-rose-500/30' 
    },
    cyan: { 
      bg: 'bg-cyan-50 dark:bg-cyan-500/20', 
      text: 'text-cyan-700 dark:text-cyan-400', 
      border: 'border-cyan-200 dark:border-cyan-500/30', 
      hover: 'hover:bg-cyan-100 dark:hover:bg-cyan-500/30' 
    },
  };

  const colors = colorClasses[activeColor] || colorClasses.indigo;

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border cursor-pointer outline-none",
          "data-[state=open]:ring-2 data-[state=open]:ring-offset-1 dark:data-[state=open]:ring-offset-gray-900",
          isActive 
            ? `${colors.bg} ${colors.text} ${colors.border} shadow-sm data-[state=open]:ring-indigo-300 dark:data-[state=open]:ring-indigo-500/50` 
            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 data-[state=open]:ring-gray-300 dark:data-[state=open]:ring-gray-600"
        )}
      >
        {icon && (
          <span className={cn("transition-colors", isActive ? colors.text : "text-gray-400 dark:text-gray-500")}>
            {icon}
          </span>
        )}
        <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500 font-normal">{label}:</span>
        <Select.Value>
          <span className={cn("font-semibold", isActive ? colors.text : "text-gray-700 dark:text-gray-200")}>
            {selectedOption?.label || 'Todos'}
          </span>
        </Select.Value>
        <Select.Icon>
          <ChevronDown size={16} className="text-gray-400 dark:text-gray-500 transition-transform duration-200 data-[state=open]:rotate-180" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className="z-[9999] min-w-[220px] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
          position="popper"
          sideOffset={8}
          align="start"
        >
          <Select.Viewport className="p-1.5">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 pr-8 rounded-lg text-sm cursor-pointer outline-none transition-all duration-150",
                  "data-[highlighted]:bg-gray-50 dark:data-[highlighted]:bg-gray-700",
                  value === option.value
                    ? `${colors.bg} ${colors.text} font-semibold`
                    : "text-gray-600 dark:text-gray-300"
                )}
              >
                {option.icon && (
                  <span className="text-gray-400 dark:text-gray-500">{option.icon}</span>
                )}
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-3">
                  <Check size={16} className={colors.text} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}


// ============================================
// COMPONENTE PRINCIPAL
// ============================================
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400" />
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
  const [dateRangeStart, setDateRangeStart] = useState<string>('');
  const [dateRangeEnd, setDateRangeEnd] = useState<string>('');
  const [searchName, setSearchName] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [opportunityFilter, setOpportunityFilter] = useState<string>('all');
  const [opportunityTypeFilter, setOpportunityTypeFilter] = useState<string>('all');
  const [opportunityUrgencyFilter, setOpportunityUrgencyFilter] = useState<string>('all');
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
  const [showFilters, setShowFilters] = useState(true);

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

        const searchTerm = searchName.trim().toLowerCase();
    
    const matchesSearchName = client.name
      ?.toLowerCase()
      .includes(searchTerm);
    
    const matchesPhone = client.phone
      ?.toLowerCase()
      .includes(searchTerm);

    if (!matchesSearchName && !matchesPhone) return false;

    if (tierFilter !== 'all') {
      if (client.tier !== tierFilter) return false;
    }

    if (opportunityFilter === 'with') {
      if (!client.opportunities || client.opportunities.length === 0) return false;
    } else if (opportunityFilter === 'without') {
      if (client.opportunities && client.opportunities.length > 0) return false;
    }

    if (opportunityTypeFilter !== 'all') {
      const hasMatchingOppType = client.opportunities?.some(
        opp => opp.type === opportunityTypeFilter
      );
      if (!hasMatchingOppType) return false;
    }

    if (opportunityUrgencyFilter !== 'all') {
      const hasMatchingUrgency = client.opportunities?.some(
        opp => opp.priority === opportunityUrgencyFilter
      );
      if (!hasMatchingUrgency) return false;
    }

    if (jobTypeFilter !== 'all') {
      const hasMatchingJobType = client.jobs?.some(job => job.job_type === jobTypeFilter);
      if (!hasMatchingJobType) return false;
    }

    if (lastContactFilter === 'all') return true;

    // Filtra apenas por datas de ensaio (job_date)
    const jobDates = (client.jobs || [])
      .map(j => parseDate(j.job_date))
      .filter((d): d is Date => d !== null);

    if (jobDates.length === 0) return false;

    if (lastContactFilter === 'custom') {
      if (!dateRangeStart && !dateRangeEnd) return true;
      const start = dateRangeStart ? new Date(dateRangeStart + 'T00:00:00') : null;
      const end = dateRangeEnd ? new Date(dateRangeEnd + 'T23:59:59') : null;
      return jobDates.some(d => (!start || d >= start) && (!end || d <= end));
    }

    const now = new Date();
    const days = lastContactFilter === '7days' ? 7 : lastContactFilter === '30days' ? 30 : 90;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return jobDates.some(d => d >= cutoff);
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
    { value: 'all', label: 'Todos os ensaios' },
    { value: 'Gestante', label: 'Gestante' },
    { value: 'Newborn', label: 'Newborn' },
    { value: 'Acompanhamento', label: 'Acompanhamento' },
    { value: 'Smash the Cake', label: 'Smash the Cake' },
    { value: 'Aniversário', label: 'Aniversário' },
    { value: 'Batizado', label: 'Batizado' },
    { value: 'Família', label: 'Família' },
    { value: 'Marca Pessoal', label: 'Marca Pessoal' },
    { value: 'Natal', label: 'Natal' },
    { value: 'Evento Externo', label: 'Evento Externo' },
    { value: 'Outros', label: 'Outros' },
  ];

  const tierOptions = [
    { value: 'all', label: 'Todos os níveis' },
    { value: 'Bronze', label: 'Bronze' },
    { value: 'Silver', label: 'Silver' },
    { value: 'Gold', label: 'Gold' },
    { value: 'Platinum', label: 'Platinum' },
    { value: 'Diamond', label: 'Diamond' },
  ];

  const opportunityOptions = [
    { value: 'all', label: 'Todas' },
    { value: 'with', label: 'Com oportunidades' },
    { value: 'without', label: 'Sem oportunidades' },
  ];

  const opportunityTypeOptions = [
    { value: 'all', label: 'Todos os tipos' },
    { value: 'Newborn', label: 'Newborn' },
    { value: 'Acompanhamento', label: 'Acompanhamento' },
    { value: 'Smash the Cake', label: 'Smash the Cake' },
    { value: 'Aniversário', label: 'Aniversário' },
    { value: 'Família', label: 'Família' },
    { value: 'Gestante', label: 'Gestante' },
    { value: 'Batizado', label: 'Batizado' },
  ];

  const opportunityUrgencyOptions = [
    { value: 'all', label: 'Todas' },
    { value: 'urgent', label: '🔴 Urgente' },
    { value: 'active', label: '🟡 Ativo' },
    { value: 'future', label: '🟢 Futuro' },
  ];

  const contactOptions = [
    { value: 'all', label: 'Qualquer período' },
    { value: '7days', label: 'Últimos 7 dias' },
    { value: '30days', label: 'Últimos 30 dias' },
    { value: '90days', label: 'Últimos 90 dias' },
    { value: 'custom', label: 'Personalizado...' },
  ];

  useEffect(() => {
    setCurrentPage(1);
  }, [searchName, jobTypeFilter, lastContactFilter, customMonth, customYear, customDay, dateRangeStart, dateRangeEnd, itemsPerPage, tierFilter, opportunityFilter, opportunityTypeFilter, opportunityUrgencyFilter]);

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'Diamond': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30';
      case 'Platinum': return 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/30';
      case 'Gold': return 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30';
      case 'Silver': return 'bg-slate-200 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-300 dark:border-slate-500/30';
      default: return 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30';
    }
  };

  const handleExportCSV = async () => {
    try {
      const res = await authFetch('/api/clients/export/csv');
      if (!res.ok) throw new Error('Falha ao exportar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clientes.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar CSV:', err);
    }
  };

  const activeFiltersCount = [
    jobTypeFilter !== 'all',
    tierFilter !== 'all',
    opportunityFilter !== 'all',
    opportunityTypeFilter !== 'all',
    opportunityUrgencyFilter !== 'all',
    lastContactFilter !== 'all',
    searchName !== '',
    (lastContactFilter === 'custom' && (!!dateRangeStart || !!dateRangeEnd)),
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchName('');
    setJobTypeFilter('all');
    setLastContactFilter('all');
    setCustomMonth('');
    setCustomYear('');
    setCustomDay('');
    setDateRangeStart('');
    setDateRangeEnd('');
    setTierFilter('all');
    setOpportunityFilter('all');
    setOpportunityTypeFilter('all');
    setOpportunityUrgencyFilter('all');
    setCurrentPage(1);
  };

  // ============================================
  // FUNÇÃO DE IMPORTAÇÃO
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

      const isValidDate = (dateStr: string | null | undefined): boolean => {
        if (!dateStr) return true;
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
        const rowNumber = idx + 2;
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

              if (insertedJob && insertedJob.job_type && insertedJob.job_date) {
                const { data: rules } = await supabase
                  .from('opportunity_rules')
                  .select('*')
                  .eq('trigger_job_type', insertedJob.job_type)
                  .eq('is_active', true)
                  .eq('user_id', userId);

                if (rules && rules.length > 0) {
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
          console.error(`❌ Erro na linha ${rowNumber}:`, error);
          errors.push({
            row: rowNumber,
            message: error?.message || 'Erro desconhecido',
          });
        }

        setImportProcessed(idx + 1);
      }

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

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Clientes</h3>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie sua base de contatos e histórico</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            <button 
              type="button"
              onClick={onUpdate}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all"
              title="Atualizar lista"
            >
              <RefreshCw size={18} />
            </button>
            <button 
              type="button"
              onClick={handleExportCSV}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all"
              title="Exportar CSV"
            >
              <Download size={18} />
            </button>
            <label className="p-2 text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all cursor-pointer" title="Importar CSV">
              <Upload size={18} />
              <input type="file" accept=".csv" onChange={handleImportCSV} className="hidden" />
            </label>
          </div>

          <button 
            type="button"
            onClick={() => { setSelectedClient(null); setShowModal(true); }}
            className="bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-500/20"
          >
            <Plus size={20} />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
                <input
                  type="text"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="Buscar cliente..."
                  className="pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none text-sm text-gray-700 dark:text-gray-200 w-64 focus:border-indigo-300 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/20 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
                {searchName && (
                  <button 
                    type="button"
                    onClick={() => setSearchName('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border",
                  showFilters || activeFiltersCount > 0
                    ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                )}
              >
                <SlidersHorizontal size={16} />
                Filtros
                {activeFiltersCount > 0 && (
                  <span className="bg-indigo-600 dark:bg-indigo-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredClients.length}</span>
                {filteredClients.length !== clients.length && (
                  <span> de {clients.length}</span>
                )} clientes
              </div>

                          {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
                >
                  <X size={16} />
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-3">
                  <FilterDropdown
                    label="Ensaio"
                    value={jobTypeFilter}
                    options={jobTypeOptions}
                    onChange={setJobTypeFilter}
                    icon={<Camera size={16} />}
                    activeColor="indigo"
                  />

                  <FilterDropdown
                    label="Nível"
                    value={tierFilter}
                    options={tierOptions}
                    onChange={setTierFilter}
                    icon={<Award size={16} />}
                    activeColor="violet"
                  />

                  <FilterDropdown
                    label="Oportunidades"
                    value={opportunityFilter}
                    options={opportunityOptions}
                    onChange={setOpportunityFilter}
                    icon={<Sparkles size={16} />}
                    activeColor="amber"
                  />

                  <FilterDropdown
                    label="Tipo Oport."
                    value={opportunityTypeFilter}
                    options={opportunityTypeOptions}
                    onChange={setOpportunityTypeFilter}
                    icon={<Camera size={16} />}
                    activeColor="cyan"
                  />

                  <FilterDropdown
                    label="Urgência"
                    value={opportunityUrgencyFilter}
                    options={opportunityUrgencyOptions}
                    onChange={setOpportunityUrgencyFilter}
                    icon={<AlertTriangle size={16} />}
                    activeColor="rose"
                  />

                  <FilterDropdown
                    label="Data de ensaio"
                    value={lastContactFilter}
                    options={contactOptions}
                    onChange={(val) => {
                      setLastContactFilter(val);
                      if (val !== 'custom') { setDateRangeStart(''); setDateRangeEnd(''); }
                    }}
                    icon={<Calendar size={16} />}
                    activeColor="emerald"
                  />

                  {lastContactFilter === 'custom' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">De</span>
                      <input
                        type="date"
                        value={dateRangeStart}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateRangeStart(e.target.value)}
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">até</span>
                      <input
                        type="date"
                        value={dateRangeEnd}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateRangeEnd(e.target.value)}
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
                      />
                    </div>
                  )}

                  <div className="ml-auto flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>Exibir</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                    <span>por página</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {selectedClientIds.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3 bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/20">
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-400">
              <CheckCircle2 size={16} />
              {selectedClientIds.length} cliente(s) selecionado(s)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportSelectedCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all"
              >
                <Download size={14} />
                Exportar
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
              >
                <Trash2 size={14} />
                Excluir
              </button>
              <button
                type="button"
                onClick={() => setSelectedClientIds([])}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* TABELA */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-4 font-medium w-12">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 dark:bg-gray-700"
                  />
                </th>
                <th className="px-6 py-4 font-medium">Nome / Nível</th>
                <th className="px-6 py-4 font-medium">Oportunidades</th>
                <th className="px-6 py-4 font-medium">Contato</th>
                <th className="px-6 py-4 font-medium">Investimento</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {paginatedClients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedClientIds.includes(client.id)}
                      onChange={() => toggleClientSelection(client.id)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 dark:bg-gray-700"
                    />
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900 dark:text-white">{client.name}</div>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded border uppercase",
                        getTierColor(client.tier || 'Bronze')
                      )}>
                        {client.tier}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Desde {format(parseDate(client.created_at) || new Date(), 'MMM yyyy', { locale: ptBR })}</div>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    {client.opportunities && client.opportunities.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {client.opportunities.map((opp) => (
                          <button 
                            key={opp.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onContactOpp(opp, client);
                            }}
                            className={cn(
                              "flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all shadow-sm w-fit",
                              opp.priority === 'urgent' ? "bg-red-500 text-white border-red-600 hover:bg-red-600" : 
                              opp.priority === 'active' ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600" :
                              "bg-indigo-500 text-white border-indigo-600 hover:bg-indigo-600"
                            )}
                            title={`Sugerido para: ${format(new Date(opp.suggested_date), 'dd/MM/yyyy')}`}
                          >
                            <Sparkles size={12} />
                            <span className="uppercase tracking-wider">{opp.type}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 italic">—</span>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 group/phone">
                      <div className="text-sm text-gray-700 dark:text-gray-300">{client.phone}</div>
                      <button 
                        type="button"
                        onClick={() => copyToClipboard(client.phone)}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 opacity-0 group-hover/phone:opacity-100 transition-opacity"
                        title="Copiar WhatsApp"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{client.email}</div>
                    {getLatestActivityDate(client) && (
                      <div className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium mt-1">
                        Última atividade: {format(getLatestActivityDate(client)!, 'dd/MM/yyyy')}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900 dark:text-white">R$ {(client.total_invested ?? 0).toLocaleString('pt-BR')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{client.jobs?.length || 0} trabalhos realizados</div>
                  </td>

                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      client.status === 'active' 
                        ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                    )}>
                      {client.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        type="button"
                        onClick={() => { setSelectedClient(client); setShowModal(true); }}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg"
                        title="Editar Perfil"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleDelete(client.id)}
                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
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

        {/* PAGINAÇÃO */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Mostrando <span className="font-semibold text-gray-700 dark:text-gray-200">{startIndex + 1}</span> a <span className="font-semibold text-gray-700 dark:text-gray-200">{Math.min(startIndex + itemsPerPage, filteredClients.length)}</span> de <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredClients.length}</span> clientes
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safeCurrentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
            >
              Anterior
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (safeCurrentPage <= 3) {
                  page = i + 1;
                } else if (safeCurrentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = safeCurrentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "w-10 h-10 text-sm font-medium rounded-xl transition-all",
                      safeCurrentPage === page
                        ? "bg-indigo-600 dark:bg-indigo-500 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-500/20"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                    )}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={safeCurrentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
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

// ============================================
// CLIENT MODAL
// ============================================
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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{initialClient ? 'Perfil do Cliente' : 'Novo Cliente'}</h3>
            {client?.tier && (
              <span className="text-xs font-bold px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 uppercase">
                Nível {client.tier}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={24} />
          </button>
        </div>

        {initialClient && (
          <div className="flex border-b border-gray-100 dark:border-gray-800 px-6 bg-white dark:bg-gray-900">
            <button 
              type="button"
              onClick={() => setActiveTab('info')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'info' 
                  ? "border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-gray-400 dark:text-gray-500"
              )}
            >
              Dados Pessoais
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'history' 
                  ? "border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-gray-400 dark:text-gray-500"
              )}
            >
              Histórico de Trabalhos
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab('opportunities')}
              className={cn(
                "px-4 py-3 text-sm font-semibold transition-colors border-b-2",
                activeTab === 'opportunities' 
                  ? "border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-gray-400 dark:text-gray-500"
              )}
            >
              Oportunidades
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'info' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Nome Completo</label>
                  <input 
                    required
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">CPF</label>
                  <input 
                    type="text" 
                    value={formData.cpf}
                    onChange={e => setFormData({...formData, cpf: e.target.value})}
                    placeholder="000.000.000-00"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Telefone</label>
                  <input 
                    type="text" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">E-mail</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Instagram</label>
                  <input 
                    type="text" 
                    value={formData.instagram}
                    onChange={e => setFormData({...formData, instagram: e.target.value})}
                    placeholder="@usuario"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Data de Nascimento</label>
                  <input 
                    type="date" 
                    value={formData.birth_date}
                    onChange={e => setFormData({...formData, birth_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Idade</label>
                  <input 
                    type="number" 
                    value={formData.age}
                    onChange={e => setFormData({...formData, age: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Nome do Filho(a)</label>
                  <input 
                    type="text" 
                    value={formData.child_name}
                    onChange={e => setFormData({...formData, child_name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">CEP</label>
                  <input 
                    type="text" 
                    value={formData.cep}
                    onChange={e => setFormData({...formData, cep: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Endereço</label>
                  <input 
                    type="text" 
                    value={formData.address}
                    onChange={e => setFormData({...formData, address: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Bairro</label>
                  <input 
                    type="text" 
                    value={formData.neighborhood}
                    onChange={e => setFormData({...formData, neighborhood: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Cidade</label>
                  <input 
                    type="text" 
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">UF</label>
                  <input 
                    type="text" 
                    value={formData.state}
                    onChange={e => setFormData({...formData, state: e.target.value})}
                    maxLength={2}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Data de Fechamento</label>
                  <input 
                    type="date" 
                    value={formData.closing_date}
                    onChange={e => setFormData({...formData, closing_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Origem do Lead</label>
                  <select 
                    value={formData.lead_source}
                    onChange={e => setFormData({...formData, lead_source: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
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
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Status</label>
                  <select 
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Observações</label>
                <textarea 
                  rows={3}
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 outline-none resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={onClose} className="px-6 py-2 text-gray-600 dark:text-gray-400 font-medium hover:text-gray-800 dark:hover:text-gray-200">Cancelar</button>
                <button type="submit" className="px-8 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors">
                  {initialClient ? 'Salvar Alterações' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          ) : activeTab === 'history' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800 dark:text-white">Trabalhos Realizados</h4>
                <button 
                  type="button"
                  onClick={() => { setEditingJob(null); setShowJobModal(true); }}
                  className="text-sm bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                >
                  <Plus size={16} /> Registrar Novo Trabalho
                </button>
              </div>

              <div className="space-y-3">
                {client?.jobs?.map(job => (
                  <div key={job.id} className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-sm hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <Camera size={20} />
                      </div>
                      <div>
                        <div className="font-bold text-gray-900 dark:text-white">{job.job_name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{job.job_type} • {job.job_date && !isNaN(new Date(job.job_date).getTime())
                          ? format(new Date(job.job_date), 'dd/MM/yyyy')
                          : '-'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold text-gray-900 dark:text-white">R$ {(job.amount ?? 0).toLocaleString('pt-BR')}</div>
                        <div className="flex items-center gap-2 justify-end">
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                            job.status === 'completed' 
                              ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                              : job.status === 'cancelled' 
                                ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400" 
                                : "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400"
                          )}>
                            {job.status === 'completed' ? 'Concluído' : job.status === 'cancelled' ? 'Cancelado' : 'Agendado'}
                          </span>
                          <div className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">{job.payment_method} • {job.payment_status === 'paid' ? 'Pago' : 'Pendente'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.status === 'scheduled' && (
                          <button 
                            type="button"
                            onClick={async () => {
                              await authFetch(`/api/jobs/${job.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ...job, status: 'completed' })
                              });
                              fetchClientDetails();
                              onSave();
                            }}
                            className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors"
                            title="Marcar como Concluído"
                          >
                            <Check size={16} />
                          </button>
                        )}
                        <button 
                          type="button"
                          onClick={() => handleEditJob(job)}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          type="button"
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.jobs || client.jobs.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 italic">
                    Nenhum trabalho registrado ainda.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-800 dark:text-white">Oportunidades de Venda</h4>
                <div className="text-xs text-gray-500 dark:text-gray-400 italic">Geradas automaticamente com base no histórico</div>
              </div>

              <div className="space-y-3">
                {client?.opportunities?.map(opp => (
                  <div key={opp.id} className={cn(
                    "p-4 rounded-xl border transition-all",
                    opp.priority === 'urgent' 
                      ? "bg-red-50/30 dark:bg-red-500/10 border-red-100 dark:border-red-500/20" 
                      : opp.priority === 'active' 
                        ? "bg-amber-50/30 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20" 
                        : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          opp.priority === 'urgent' 
                            ? "bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400" 
                            : opp.priority === 'active' 
                              ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400" 
                              : "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
                        )}>
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <div className="font-bold text-gray-900 dark:text-white">{opp.type}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Sugerido para: {format(new Date(opp.suggested_date), 'dd/MM/yyyy')}
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                        opp.priority === 'urgent' 
                          ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400" 
                          : opp.priority === 'active' 
                            ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400" 
                            : "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400"
                      )}>
                        {opp.priority === 'urgent' ? 'Urgente' : opp.priority === 'active' ? 'Ativo' : 'Futuro'}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100/50 dark:border-gray-700/50">
                      <div className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">Status: {opp.status}</div>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={async () => {
                            await authFetch(`/api/opportunities/${opp.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'dismissed' })
                            });
                            fetchClientDetails();
                            onSave();
                          }}
                          className="text-xs font-bold text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 px-3 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                        >
                          Ignorar
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            if (client) {
                              onContactOpp(opp, client);
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 dark:bg-indigo-500 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all shadow-sm"
                        >
                          <MessageSquare size={12} />
                          Contatar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!client?.opportunities || client.opportunities.length === 0) && (
                  <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 italic">
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

