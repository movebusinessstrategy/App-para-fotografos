import React, { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search, X, ChevronRight, ChevronLeft, Briefcase, FilePlus2, Settings as SettingsIcon, FileCheck2, FileClock, FileCog, Save, Loader2, Eye, Trash2, AlertCircle, CheckCheck, RefreshCw, Check } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { authFetch } from "../utils/authFetch";
import { useApi } from "../utils/useApi";
import { parseDate } from "../utils/date";
import { ContractGenerator } from "../components/contracts/ContractGenerator";
import { TemplatesManager } from "../components/contracts/TemplatesManager";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { Client, ContractTemplate, Job } from "../types";
import { cn } from "../utils/cn";
import { parseBRL, formatBRL, SUNDAY_SURCHARGE } from "../utils/contractTemplate";
import { normalizeText } from "../utils/normalizeText";

type ToastKind = 'success' | 'error' | 'info';
interface ToastState { kind: ToastKind; message: string }

type ClientWithJobs = Client & { jobs?: Job[] };

interface ContractListItem {
  id: number;
  client_id: number;
  client_name: string | null;
  job_id: number | null;
  status: 'draft' | 'pending_signature' | 'signed' | 'cancelled';
  signers: Array<{ status: 'pending' | 'signed' }>;
  autentique_id: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  contract_data?: { serviceType?: string; serviceDate?: string };
}

type Tab = 'pending' | 'signed' | 'templates' | 'settings';

export default function ContractsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const { data: contractsData, isLoading: contractsLoading, mutate: mutateContracts } =
    useApi<ContractListItem[]>("/api/contracts");
  const contracts = useMemo(() => Array.isArray(contractsData) ? contractsData : [], [contractsData]);
  const loading = contractsLoading && !contractsData;
  const [searchQuery, setSearchQuery] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openContractId, setOpenContractId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ContractListItem | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (kind: ToastKind, message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4000);
  };

  const reload = () => mutateContracts();

  const doDelete = async (c: ContractListItem) => {
    const res = await authFetch(`/api/contracts/${c.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('error', 'Erro ao excluir: ' + (err.error || res.statusText));
      return;
    }
    showToast('success', 'Contrato excluído.');
    reload();
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const refreshPending = async () => {
    const eligible = contracts.filter(c => c.status === 'pending_signature' && c.autentique_id);
    if (eligible.length === 0) {
      showToast('info', 'Nenhum contrato aguardando assinatura.');
      return;
    }
    setRefreshingAll(true);
    let signedNow = 0; let errors = 0;
    for (const c of eligible) {
      try {
        const r = await authFetch(`/api/contracts/${c.id}/autentique-refresh`, { method: 'POST' });
        if (!r.ok) { errors++; continue; }
        const data = await r.json();
        if (data.all_signed) signedNow++;
      } catch { errors++; }
    }
    setRefreshingAll(false);
    await reload();
    if (errors > 0) {
      showToast('error', `${errors} contrato(s) com erro ao consultar Autentique. Veja o console do servidor.`);
    } else if (signedNow > 0) {
      showToast('success', `${signedNow} contrato(s) finalizado(s) e movido(s) para Assinados.`);
    } else {
      showToast('info', 'Status sincronizado. Nenhuma mudança.');
    }
  };

  const pending = contracts.filter(c => c.status === 'draft' || c.status === 'pending_signature');
  const signed = contracts.filter(c => c.status === 'signed');

  const visible = useMemo(() => {
    const list = tab === 'pending' ? pending : tab === 'signed' ? signed : [];
    const q = normalizeText(searchQuery);
    if (!q) return list;
    return list.filter(c => normalizeText(c.client_name || '').includes(q));
  }, [tab, contracts, searchQuery]);

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Contratos</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Crie, envie e arquive contratos com integração Autentique.
            </p>
          </div>
          {tab !== 'settings' && tab !== 'templates' && (
            <div className="flex items-center gap-2">
              {tab === 'pending' && (
                <button
                  onClick={refreshPending}
                  disabled={refreshingAll}
                  title="Consultar Autentique e atualizar status de todos os contratos pendentes"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                >
                  {refreshingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Atualizar status
                </button>
              )}
              <button
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
              >
                <Plus size={14} />
                Novo contrato
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
          <TabButton
            active={tab === 'pending'}
            onClick={() => setTab('pending')}
            icon={<FileClock size={14} />}
            label="A assinar"
            count={pending.length}
          />
          <TabButton
            active={tab === 'signed'}
            onClick={() => setTab('signed')}
            icon={<FileCheck2 size={14} />}
            label="Assinados"
            count={signed.length}
          />
          <TabButton
            active={tab === 'templates'}
            onClick={() => setTab('templates')}
            icon={<FileCog size={14} />}
            label="Modelos"
          />
          <TabButton
            active={tab === 'settings'}
            onClick={() => setTab('settings')}
            icon={<SettingsIcon size={14} />}
            label="Configurações"
          />
        </div>

        {/* Search (only on list tabs) */}
        {tab !== 'settings' && tab !== 'templates' && (
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por cliente..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        {tab === 'settings' ? (
          <SettingsForm onNotify={showToast} />
        ) : tab === 'templates' ? (
          <TemplatesManager onNotify={showToast} />
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
          </div>
        ) : (
          <ContractsList
            contracts={visible}
            tab={tab as 'pending' | 'signed'}
            onOpen={(id) => setOpenContractId(id)}
            onAskDelete={(c) => setConfirmDelete(c)}
          />
        )}
      </div>

      {pickerOpen && (
        <NewContractPicker
          onClose={() => setPickerOpen(false)}
          onCreated={(id) => {
            setPickerOpen(false);
            setOpenContractId(id);
            reload();
          }}
          onError={(msg) => showToast('error', msg)}
        />
      )}

      {openContractId !== null && (
        <ContractGenerator
          contractId={openContractId}
          onClose={() => { setOpenContractId(null); reload(); }}
          onSaved={() => reload()}
          onDeleted={() => { setOpenContractId(null); reload(); }}
        />
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir contrato"
        message={confirmDelete
          ? `Excluir o contrato de ${confirmDelete.client_name || 'cliente sem nome'}? Esta ação não pode ser desfeita.`
          : ''}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) doDelete(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

// ─── Toast component ──────────────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className="fixed top-5 right-5 z-[110] animate-in slide-in-from-top-2 fade-in duration-200">
      <div className={cn(
        'flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl backdrop-blur border max-w-md',
        toast.kind === 'success' && 'bg-emerald-50/95 dark:bg-emerald-900/80 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-100',
        toast.kind === 'error' && 'bg-red-50/95 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-800 dark:text-red-100',
        toast.kind === 'info' && 'bg-gray-50/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100',
      )}>
        {toast.kind === 'success' && <CheckCheck size={16} className="flex-shrink-0" />}
        {toast.kind === 'error' && <AlertCircle size={16} className="flex-shrink-0" />}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px',
        active
          ? 'border-gold-500 text-gold-700 dark:text-gold-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      )}
    >
      {icon}
      {label}
      {typeof count === 'number' && (
        <span className={cn(
          'inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold',
          active ? 'bg-gold-100 dark:bg-gold-900/40 text-gold-700 dark:text-gold-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Contracts list ────────────────────────────────────────────────────────────

function ContractsList({ contracts, tab, onOpen, onAskDelete }: { contracts: ContractListItem[]; tab: 'pending' | 'signed'; onOpen: (id: number) => void; onAskDelete: (c: ContractListItem) => void }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-6 py-3 font-semibold">Cliente</th>
            <th className="px-6 py-3 font-semibold">Tipo / Data</th>
            <th className="px-6 py-3 font-semibold">Signatários</th>
            <th className="px-6 py-3 font-semibold">{tab === 'signed' ? 'Assinado em' : 'Status'}</th>
            <th className="px-6 py-3 font-semibold text-right">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {contracts.map(c => {
            const signedCount = (c.signers || []).filter(s => s.status === 'signed').length;
            const total = (c.signers || []).length;
            return (
              <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="px-6 py-4">
                  <p className="font-medium text-gray-900 dark:text-white text-sm">{c.client_name || 'Sem cliente'}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    Criado em {format(new Date(c.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </p>
                </td>
                <td className="px-6 py-4 text-gray-600 dark:text-gray-300 text-sm">
                  {c.contract_data?.serviceType || '-'}
                  {c.contract_data?.serviceDate && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{c.contract_data.serviceDate}</p>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                  {total > 0 ? `${signedCount} de ${total}` : '-'}
                </td>
                <td className="px-6 py-4">
                  {tab === 'signed' ? (
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {c.signed_at ? format(new Date(c.signed_at), "dd/MM/yyyy", { locale: ptBR }) : '-'}
                    </span>
                  ) : (
                    <ListStatusBadge status={c.status} />
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      onClick={() => onOpen(c.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Eye size={12} />
                      {tab === 'signed' ? 'Visualizar' : 'Abrir'}
                    </button>
                    <button
                      onClick={() => onAskDelete(c)}
                      title="Excluir contrato"
                      className="inline-flex items-center justify-center p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 rounded-lg transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {contracts.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                {tab === 'signed' ? 'Nenhum contrato assinado ainda.' : 'Nenhum contrato pendente. Crie um novo ou envie um trabalho da Produção.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ListStatusBadge({ status }: { status: ContractListItem['status'] }) {
  const map = {
    draft: { label: 'Rascunho', cls: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
    pending_signature: { label: 'Aguardando', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' },
    signed: { label: 'Assinado', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' },
  } as const;
  const it = map[status];
  return <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold', it.cls)}>{it.label}</span>;
}

// ─── New contract: template + client picker ───────────────────────────────────

type PickerStep = 'template' | 'client' | 'job';

function NewContractPicker({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (id: number) => void; onError: (msg: string) => void }) {
  const [clients, setClients] = useState<ClientWithJobs[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [step, setStep] = useState<PickerStep>('template');
  const [selectedClient, setSelectedClient] = useState<ClientWithJobs | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sundaySession, setSundaySession] = useState(false);

  useEffect(() => {
    Promise.all([
      authFetch('/api/clients').then(r => r.ok ? r.json() : []),
      authFetch('/api/contract-templates').then(r => r.ok ? r.json() : []),
    ]).then(([cs, ts]) => {
      setClients(Array.isArray(cs) ? cs : []);
      setTemplates(Array.isArray(ts) ? ts : []);
    }).catch(console.error)
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

  const filteredClients = useMemo(() => {
    const q = normalizeText(searchQuery);
    if (!q) return clients;
    return clients.filter(c =>
      normalizeText(c.name || '').includes(q) ||
      normalizeText(c.phone || '').includes(q) ||
      normalizeText(c.email || '').includes(q)
    );
  }, [clients, searchQuery]);

  const filteredTemplates = useMemo(() => {
    if (!activeCategory) return [];
    return templates
      .filter(t => t.category === activeCategory)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates, activeCategory]);

  const buildContractData = (client: ClientWithJobs | null, job: Job | null, template: ContractTemplate | null) => {
    const cd: any = {};

    if (client) {
      cd.clientName = client.name || '';
      cd.clientCPF = (client as any).cpf || '';
      cd.clientPhone = (client as any).phone || '';
      cd.clientEmail = (client as any).email || '';
      cd.clientCEP = (client as any).cep || '';
      const addr = (client as any).address || '';
      const city = (client as any).city || '';
      const state = (client as any).state || '';
      cd.clientAddress = [addr, [city, state].filter(Boolean).join('/')].filter(Boolean).join(' - ');
    }

    if (job) {
      cd.serviceType = job.job_type || '';
      cd.serviceDate = job.job_date || '';
      cd.serviceTime = job.job_time || '';
    }

    // Template defaults: valor + prazo + nome do tipo de serviço
    if (template) {
      const defs = template.default_data || {};
      if (template.name && !cd.serviceType) {
        cd.serviceType = template.name;
      }
      let baseValue = 0;
      if (defs.valor_total) {
        baseValue = parseBRL(defs.valor_total as string);
      } else if (job?.amount) {
        baseValue = job.amount;
      }
      if (sundaySession) baseValue += SUNDAY_SURCHARGE;
      if (baseValue > 0) cd.serviceValue = formatBRL(baseValue);
      if (defs.valor_extenso && !sundaySession) cd.serviceValueWords = String(defs.valor_extenso);
      if (defs.prazo_entrega_dias) cd.deliveryDays = Number(defs.prazo_entrega_dias);
    } else if (job?.amount) {
      cd.serviceValue = formatBRL(job.amount);
    }

    cd.imageAuthorization = 'autoriza';
    return cd;
  };

  const createContract = async (client: ClientWithJobs, job: Job | null) => {
    setCreating(true);
    try {
      const payload: any = {
        client_id: client.id,
        job_id: job?.id ?? null,
        status: 'draft',
        contract_data: buildContractData(client, job, selectedTemplate),
      };
      if (selectedTemplate) payload.template_id = selectedTemplate.id;

      const res = await authFetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError('Erro ao criar contrato: ' + (err.error || res.statusText));
        return;
      }
      const created = await res.json();
      onCreated(created.id);
    } finally {
      setCreating(false);
    }
  };

  const onPickClient = (client: ClientWithJobs) => {
    if (client.jobs && client.jobs.length > 0) {
      setSelectedClient(client);
      setStep('job');
    } else {
      createContract(client, null);
    }
  };

  const stepTitle = step === 'template'
    ? (activeCategory ? `${activeCategory}` : 'Escolha o tipo de contrato')
    : step === 'client' ? 'Escolha o cliente' : 'Vincular a um trabalho?';
  const stepHint = step === 'template'
    ? (activeCategory ? 'Qual modelo usar?' : 'Cada modelo tem cláusulas e valor padrão próprios')
    : step === 'client' ? `Modelo: ${selectedTemplate?.name || 'sem modelo'}` : selectedClient?.name || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            {step !== 'template' && (
              <button
                onClick={() => {
                  if (step === 'job') { setStep('client'); setSelectedClient(null); }
                  else if (step === 'client') { setStep('template'); }
                }}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Voltar"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {step === 'template' && activeCategory && (
              <button
                onClick={() => setActiveCategory(null)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Voltar"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">{stepTitle}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{stepHint}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {step === 'template' && (
            loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={18} className="animate-spin text-gray-400" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-sm text-gray-700 dark:text-gray-200 font-semibold mb-1">Nenhum modelo cadastrado</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Importe os 24 modelos do estúdio em Contratos → Modelos primeiro.
                </p>
                <button
                  onClick={() => { setSelectedTemplate(null); setStep('client'); }}
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
                      <span className="text-[11px] text-gray-400">{count} {count === 1 ? 'modelo' : 'modelos'} <ChevronRight size={11} className="inline ml-1" /></span>
                    </button>
                  );
                })}
                <button
                  onClick={() => { setSelectedTemplate(null); setStep('client'); }}
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
                  {filteredTemplates.map(t => {
                    const valor = (t.default_data?.valor_total as string) || '';
                    const prazo = t.default_data?.prazo_entrega_dias;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTemplate(t); setStep('client'); }}
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
                {/* Domingo checkbox */}
                <label className="mt-4 flex items-center gap-2 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={sundaySession}
                    onChange={e => setSundaySession(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <div className="flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Sessão no domingo</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Acrescenta R$ {SUNDAY_SURCHARGE.toFixed(2).replace('.', ',')} ao valor do modelo</p>
                  </div>
                </label>
              </>
            )
          )}

          {step === 'client' && (
            <>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-gold-400 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                {filteredClients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onPickClient(c)}
                    disabled={creating}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 dark:border-gray-700 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 rounded-xl text-left disabled:opacity-60 transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{c.name || 'Sem nome'}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {c.phone || c.email || '-'}
                        {c.jobs && c.jobs.length > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-gray-400">
                            <Briefcase size={9} /> {c.jobs.length}
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                  </button>
                ))}
                {filteredClients.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-6">Nenhum cliente encontrado.</p>
                )}
              </div>
            </>
          )}

          {step === 'job' && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Vincular um trabalho preenche o contrato automaticamente. Você ainda pode editar tudo depois.
              </p>
              <div className="space-y-1.5">
                {(selectedClient?.jobs || []).map(job => {
                  const date = job.job_date ? parseDate(job.job_date) : null;
                  return (
                    <button
                      key={job.id}
                      onClick={() => createContract(selectedClient!, job)}
                      disabled={creating}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 dark:border-gray-700 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 rounded-xl text-left disabled:opacity-60 transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{job.job_type || job.job_name || 'Trabalho'}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          {date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : 'Sem data'} · R$ {(job.amount ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                    </button>
                  );
                })}

                <button
                  onClick={() => createContract(selectedClient!, null)}
                  disabled={creating}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border border-dashed border-gray-300 dark:border-gray-600 hover:border-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 rounded-xl text-left disabled:opacity-60 transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <FilePlus2 size={14} className="text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-700 dark:text-gray-200 text-sm">Sem trabalho vinculado</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Preencher serviço e valores manualmente</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                </button>
              </div>
              {creating && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Settings form ────────────────────────────────────────────────────────────

interface StudioSettingsForm {
  studio_name: string;
  studio_cnpj: string;
  studio_address: string;
  studio_responsible: string;
  studio_responsible_cpf: string;
  studio_city: string;
  down_payment_percent: number;
  installments: number;
  extra_photo_price: string;
  delivery_days_selection: number;
  selection_deadline_days: number;
  delivery_days: number;
  signing_city: string;
  autentique_api_key: string;
  autentique_sandbox: boolean;
  autentique_api_key_set?: boolean;
}

const EMPTY_SETTINGS: StudioSettingsForm = {
  studio_name: '', studio_cnpj: '', studio_address: '',
  studio_responsible: '', studio_responsible_cpf: '', studio_city: '',
  down_payment_percent: 30, installments: 6, extra_photo_price: '35,00',
  delivery_days_selection: 2, selection_deadline_days: 5, delivery_days: 30,
  signing_city: '', autentique_api_key: '', autentique_sandbox: false,
};

function SettingsForm({ onNotify }: { onNotify: (kind: ToastKind, message: string) => void }) {
  const [data, setData] = useState<StudioSettingsForm>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    authFetch('/api/studio-settings')
      .then(r => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setData({
            ...EMPTY_SETTINGS,
            ...d,
            autentique_api_key: '', // never pre-fill - user re-enters if changing
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof StudioSettingsForm>(key: K, value: StudioSettingsForm[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = { ...data };
      if (!payload.autentique_api_key) delete payload.autentique_api_key; // don't overwrite existing
      const res = await authFetch('/api/studio-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify('error', 'Erro ao salvar: ' + (err.error || res.statusText));
        return;
      }
      setSavedAt(new Date());
      onNotify('success', 'Configurações salvas.');
      // Reload to refresh autentique_api_key_set flag
      const r2 = await authFetch('/api/studio-settings');
      if (r2.ok) {
        const d = await r2.json();
        setData(prev => ({ ...prev, autentique_api_key: '', autentique_api_key_set: d?.autentique_api_key_set }));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-gold-400 outline-none transition-colors";
  const labelCls = "block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5";

  return (
    <div className="max-w-3xl space-y-6">
      {/* Company section */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h4 className="text-base font-bold text-gray-800 dark:text-white mb-1">Dados da empresa</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Esses dados aparecem como <strong>CONTRATADA</strong> em todos os contratos.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Nome do estúdio / razão social</label>
            <input className={inputCls} value={data.studio_name} onChange={e => set('studio_name', e.target.value)} placeholder="Stúdio Pitori Ltda" />
          </div>
          <div>
            <label className={labelCls}>CNPJ</label>
            <input className={inputCls} value={data.studio_cnpj} onChange={e => set('studio_cnpj', e.target.value)} placeholder="00.000.000/0001-00" />
          </div>
          <div>
            <label className={labelCls}>Cidade do foro</label>
            <input className={inputCls} value={data.studio_city} onChange={e => { set('studio_city', e.target.value); set('signing_city', e.target.value); }} placeholder="Cambé/PR" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Endereço completo</label>
            <input className={inputCls} value={data.studio_address} onChange={e => set('studio_address', e.target.value)} placeholder="Rua Exemplo, 123, Centro, Cambé/PR, CEP 00000-000" />
          </div>
          <div>
            <label className={labelCls}>Nome do responsável</label>
            <input className={inputCls} value={data.studio_responsible} onChange={e => set('studio_responsible', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>CPF do responsável</label>
            <input className={inputCls} value={data.studio_responsible_cpf} onChange={e => set('studio_responsible_cpf', e.target.value)} placeholder="000.000.000-00" />
          </div>
        </div>
      </section>

      {/* Default values */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h4 className="text-base font-bold text-gray-800 dark:text-white mb-1">Padrões dos contratos</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Valores que aparecem pré-preenchidos. Você pode editar caso a caso.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Sinal padrão (%)</label>
            <input type="number" className={inputCls} value={data.down_payment_percent} onChange={e => set('down_payment_percent', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Parcelamento máximo</label>
            <input type="number" className={inputCls} value={data.installments} onChange={e => set('installments', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Preço foto extra (R$)</label>
            <input className={inputCls} value={data.extra_photo_price} onChange={e => set('extra_photo_price', e.target.value)} placeholder="35,00" />
          </div>
          <div>
            <label className={labelCls}>Envio para seleção (dias úteis)</label>
            <input type="number" className={inputCls} value={data.delivery_days_selection} onChange={e => set('delivery_days_selection', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Prazo seleção do cliente (dias)</label>
            <input type="number" className={inputCls} value={data.selection_deadline_days} onChange={e => set('selection_deadline_days', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Entrega final (dias úteis)</label>
            <input type="number" className={inputCls} value={data.delivery_days} onChange={e => set('delivery_days', Number(e.target.value))} />
          </div>
        </div>
      </section>

      {/* Autentique */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h4 className="text-base font-bold text-gray-800 dark:text-white mb-1">Integração Autentique</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Conecte sua conta Autentique para enviar contratos para assinatura digital.
              Crie uma chave em{' '}
              <a href="https://app.autentique.com.br/api" target="_blank" rel="noopener noreferrer" className="text-gold-600 hover:text-gold-700 font-semibold">
                app.autentique.com.br/api
              </a>.
            </p>
          </div>
          {data.autentique_api_key_set && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold flex-shrink-0">
              <FileCheck2 size={10} /> Conectado
            </span>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>
              {data.autentique_api_key_set ? 'Substituir chave (deixe em branco para manter)' : 'Chave da API Autentique'}
            </label>
            <input
              type="password"
              className={inputCls}
              value={data.autentique_api_key}
              onChange={e => set('autentique_api_key', e.target.value)}
              placeholder={data.autentique_api_key_set ? '••••••••••••' : 'eyJ...'}
              autoComplete="off"
            />
            <p className="text-[10px] text-gray-400 mt-1">A chave é armazenada com segurança e nunca exibida após salvar.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={data.autentique_sandbox}
              onChange={e => set('autentique_sandbox', e.target.checked)}
              className="rounded border-gray-300 text-gold-600 focus:ring-gold-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Usar modo sandbox (testes - não envia e-mails reais)</span>
          </label>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        {savedAt && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Salvo às {format(savedAt, 'HH:mm')}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar configurações
        </button>
      </div>
    </div>
  );
}
