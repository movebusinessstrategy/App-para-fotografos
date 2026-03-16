import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "motion/react";
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors, useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, Plus } from "lucide-react";

import { authFetch } from "../utils/authFetch";
import { cn } from "../utils/cn";
import { Client, Deal, DealActivity, DealPriority, DealStage } from "../types";

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dealsRes, clientsRes] = await Promise.all([
        authFetch('/api/deals'),
        authFetch('/api/clients'),
      ]);
      setDeals(await dealsRes.json());
      setClients(await clientsRes.json());
    } catch (error) {
      console.error('Erro ao carregar funil:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <Sales deals={deals} clients={clients} onUpdate={fetchData} />;
}

// --- Sales Component ---
function Sales({ deals, clients, onUpdate }: { deals: Deal[], clients: Client[], onUpdate: () => void }) {
  const [localDeals, setLocalDeals] = useState<Deal[]>(deals);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [newActivity, setNewActivity] = useState({ type: 'note', description: '' });
  const [filters, setFilters] = useState<{ clientId: string; priority: string; dateFrom: string; dateTo: string }>({
    clientId: 'all',
    priority: 'all',
    dateFrom: '',
    dateTo: ''
  });
  const [creating, setCreating] = useState(false);
  const [newDeal, setNewDeal] = useState({
    title: '',
    client_id: '' as number | '',
    value: '',
    expected_close_date: '',
    priority: 'medium' as DealPriority,
    next_follow_up: '',
    notes: ''
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => setLocalDeals(deals), [deals]);

  const stageMeta: { id: DealStage; label: string; color: string }[] = [
    { id: 'lead', label: 'Lead Novo', color: 'bg-slate-100' },
    { id: 'contact', label: 'Contato Feito', color: 'bg-blue-50' },
    { id: 'proposal', label: 'Proposta Enviada', color: 'bg-amber-50' },
    { id: 'negotiation', label: 'Em Negociação', color: 'bg-purple-50' },
    { id: 'won', label: 'Fechado Ganho', color: 'bg-emerald-50' },
    { id: 'lost', label: 'Perdido', color: 'bg-rose-50' },
  ];

  const clientMap = useMemo(() => {
    const map = new Map<number, string>();
    clients.forEach(c => map.set(c.id, c.name));
    return map;
  }, [clients]);

  const filteredDeals = useMemo(() => {
    return localDeals.filter(d => {
      if (filters.clientId !== 'all' && String(d.client_id) !== filters.clientId) return false;
      if (filters.priority !== 'all' && d.priority !== filters.priority) return false;
      if (filters.dateFrom && (!d.expected_close_date || d.expected_close_date < filters.dateFrom)) return false;
      if (filters.dateTo && (!d.expected_close_date || d.expected_close_date > filters.dateTo)) return false;
      return true;
    });
  }, [localDeals, filters]);

  const dealsByStage = useMemo(() => {
    const map: Record<DealStage, Deal[]> = {
      lead: [],
      contact: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: []
    };
    filteredDeals.forEach(d => map[d.stage].push(d));
    return map;
  }, [filteredDeals]);

  const boardStats = useMemo(() => {
    return stageMeta.map(stage => {
      const items = dealsByStage[stage.id];
      const totalValue = items.reduce((sum, d) => sum + (d.value || 0), 0);
      return { stage: stage.id, count: items.length, totalValue };
    });
  }, [dealsByStage, stageMeta]);

  const priorityColor = (priority: string) => {
    if (priority === 'high') return 'bg-red-100 text-red-700';
    if (priority === 'low') return 'bg-green-100 text-green-700';
    return 'bg-amber-100 text-amber-700';
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const dealId = Number(String(active.id).replace('deal-', ''));
    const overData: any = over.data?.current || {};
    let newStage = (overData.stage as DealStage) || (over.id as DealStage);
    if (String(newStage).startsWith('deal-')) {
      const target = localDeals.find(d => `deal-${d.id}` === String(newStage));
      newStage = target?.stage || localDeals.find(d => d.id === dealId)?.stage || 'lead';
    }

    setLocalDeals(prev =>
      prev.map(d => (d.id === dealId ? { ...d, stage: newStage, updated_at: new Date().toISOString() } : d))
    );

    await authFetch(`/api/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage })
    });
    onUpdate();
  };

  const openDeal = async (deal: Deal) => {
    setSelectedDeal(deal);
    setActivityLoading(true);
    setActivities([]);
    try {
      const res = await authFetch(`/api/deals/${deal.id}/activities`);
      setActivities(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setActivityLoading(false);
    }
  };

  const addActivity = async () => {
    if (!selectedDeal || !newActivity.description.trim()) return;
    setActivityLoading(true);
    await authFetch(`/api/deals/${selectedDeal.id}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newActivity)
    });
    setNewActivity({ type: 'note', description: '' });
    await openDeal(selectedDeal);
    onUpdate();
  };

  const updateFollowUp = async (date: string) => {
    if (!selectedDeal) return;
    await authFetch(`/api/deals/${selectedDeal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next_follow_up: date })
    });
    await openDeal({ ...selectedDeal, next_follow_up: date });
    onUpdate();
  };

  const createDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    await authFetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newDeal,
        value: Number(newDeal.value || 0)
      })
    });
    setNewDeal({ title: '', client_id: '', value: '', expected_close_date: '', priority: 'medium', next_follow_up: '', notes: '' });
    setCreating(false);
    onUpdate();
  };

  const isOverdue = (date: string | null) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    return target < today;
  };

  const daysInStage = (deal: Deal) => {
    const updated = new Date(deal.updated_at);
    const diff = Date.now() - updated.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Funil de Vendas</h3>
          <p className="text-gray-500">Organize deals, atividades e follow-ups.</p>
        </div>
        <form onSubmit={createDeal} className="flex flex-wrap gap-2 items-center bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
          <input
            required
            value={newDeal.title}
            onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })}
            placeholder="Novo deal"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none"
          />
          <select
            value={newDeal.client_id}
            onChange={(e) => setNewDeal({ ...newDeal, client_id: e.target.value ? Number(e.target.value) : '' })}
            className="text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none"
          >
            <option value="">Cliente (opcional)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="number"
            value={newDeal.value}
            onChange={(e) => setNewDeal({ ...newDeal, value: e.target.value })}
            placeholder="Valor"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none w-28"
          />
          <select
            value={newDeal.priority}
            onChange={(e) => setNewDeal({ ...newDeal, priority: e.target.value as DealPriority })}
            className="text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none"
          >
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
          </select>
          <button
            type="submit"
            disabled={creating}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={16} /> Criar
          </button>
        </form>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap gap-4">
        {boardStats.map(stat => (
          <div key={stat.stage} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-100 bg-gray-50">
            <div className="text-xs font-bold uppercase text-gray-500 w-28">{stageMeta.find(s => s.id === stat.stage)?.label}</div>
            <div className="text-lg font-bold text-gray-900">{stat.count} deals</div>
            <div className="text-sm text-gray-500">R$ {stat.totalValue.toLocaleString('pt-BR')}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <select
          value={filters.clientId}
          onChange={(e) => setFilters(prev => ({ ...prev, clientId: e.target.value }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
        >
          <option value="all">Todos os clientes</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={filters.priority}
          onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
        >
          <option value="all">Todas prioridades</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 outline-none"
          />
          <span className="text-xs text-gray-400">até</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 outline-none"
          />
        </div>
        <button
          onClick={() => setFilters({ clientId: 'all', priority: 'all', dateFrom: '', dateTo: '' })}
          className="text-sm text-gray-500 hover:text-indigo-600"
        >
          Limpar filtros
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {stageMeta.map(stage => (
            <React.Fragment key={stage.id}>
              <SortableContext items={dealsByStage[stage.id].map(d => `deal-${d.id}`)} strategy={rectSortingStrategy}>
                <StageColumn
                  stage={stage}
                  deals={dealsByStage[stage.id]}
                  onOpen={openDeal}
                  clientMap={clientMap}
                  priorityColor={priorityColor}
                  isOverdue={isOverdue}
                  daysInStage={daysInStage}
                />
              </SortableContext>
            </React.Fragment>
          ))}
        </div>
      </DndContext>

      <DealDetailModal
        deal={selectedDeal}
        activities={activities}
        loading={activityLoading}
        onClose={() => { setSelectedDeal(null); setActivities([]); }}
        onAddActivity={addActivity}
        newActivity={newActivity}
        setNewActivity={setNewActivity}
        onUpdateFollowUp={updateFollowUp}
      />
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  onOpen,
  clientMap,
  priorityColor,
  isOverdue,
  daysInStage
}: {
  stage: { id: DealStage; label: string; color: string };
  deals: Deal[];
  onOpen: (deal: Deal) => void;
  clientMap: Map<number, string>;
  priorityColor: (p: string) => string;
  isOverdue: (d: string | null) => boolean;
  daysInStage: (d: Deal) => number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage: stage.id } });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border border-gray-200 bg-white flex flex-col min-h-[450px] max-h-[70vh]",
        isOver && "ring-2 ring-indigo-200"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", stage.id === 'won' ? 'bg-emerald-500' : stage.id === 'lost' ? 'bg-rose-500' : 'bg-indigo-500')} />
          <h4 className="font-bold text-gray-800">{stage.label}</h4>
        </div>
        <span className="text-xs text-gray-500 font-semibold bg-gray-100 px-2 py-1 rounded-full">{deals.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {deals.map(deal => (
          <React.Fragment key={deal.id}>
            <DealCard
              deal={deal}
              clientName={deal.client_name || (deal.client_id ? clientMap.get(deal.client_id) : '') || 'Cliente não informado'}
              priorityColor={priorityColor}
              isOverdue={isOverdue}
              daysInStage={daysInStage}
              onOpen={() => onOpen(deal)}
            />
          </React.Fragment>
        ))}
        {deals.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-6 border border-dashed border-gray-200 rounded-xl">
            Sem deals nesta coluna
          </div>
        )}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  clientName,
  priorityColor,
  isOverdue,
  daysInStage,
  onOpen
}: {
  deal: Deal;
  clientName: string;
  priorityColor: (p: string) => string;
  isOverdue: (d: string | null) => boolean;
  daysInStage: (d: Deal) => number;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `deal-${deal.id}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const stalled = daysInStage(deal) > 7 && deal.stage !== 'won' && deal.stage !== 'lost';
  const overdue = isOverdue(deal.next_follow_up);

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      {...attributes}
      {...listeners}
      className={cn(
        "bg-white border rounded-xl p-3 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing",
        isDragging && "opacity-70 shadow-lg",
        overdue ? "border-red-300 bg-red-50" : stalled ? "border-amber-200 bg-amber-50" : "border-gray-200"
      )}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-gray-900 flex items-center gap-1">
            {deal.priority === 'high' && <span className="text-red-500">🔥</span>}
            {deal.title}
          </div>
          <p className="text-xs text-gray-500">{clientName}</p>
        </div>
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", priorityColor(deal.priority))}>
          {deal.priority === 'high' ? 'Alta' : deal.priority === 'medium' ? 'Média' : 'Baixa'}
        </span>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-sm font-bold text-gray-800">R$ {(deal.value || 0).toLocaleString('pt-BR')}</div>
        <div className="text-[11px] text-gray-500">
          {deal.expected_close_date ? `Fechamento: ${format(new Date(deal.expected_close_date), 'dd/MM')}` : 'Sem previsão'}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px]">
        <div className="flex items-center gap-1 text-gray-600">
          <Clock size={12} />
          {deal.next_follow_up
            ? `Follow-up: ${format(new Date(deal.next_follow_up), 'dd/MM')}`
            : 'Sem follow-up'}
        </div>
        <div className={cn(
          "px-2 py-0.5 rounded-full font-semibold",
          stalled ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
        )}>
          {daysInStage(deal)} dias na etapa
        </div>
      </div>
    </motion.div>
  );
}

function DealDetailModal({
  deal,
  activities,
  loading,
  onClose,
  onAddActivity,
  newActivity,
  setNewActivity,
  onUpdateFollowUp
}: {
  deal: Deal | null;
  activities: DealActivity[];
  loading: boolean;
  onClose: () => void;
  onAddActivity: () => void;
  newActivity: { type: string; description: string };
  setNewActivity: (v: { type: string; description: string }) => void;
  onUpdateFollowUp: (date: string) => void;
}) {
  if (!deal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-gray-400 font-semibold">{deal.stage}</p>
            <h3 className="text-xl font-bold text-gray-900">{deal.title}</h3>
            <p className="text-sm text-gray-500">Valor: R$ {(deal.value || 0).toLocaleString('pt-BR')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
          <div className="md:col-span-2 space-y-4">
            <div className="border border-gray-100 rounded-xl p-4">
              <h4 className="text-sm font-bold text-gray-700 mb-3">Atividades</h4>
              {loading ? (
                <div className="text-sm text-gray-500">Carregando...</div>
              ) : activities.length === 0 ? (
                <div className="text-sm text-gray-400">Nenhuma atividade registrada.</div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {activities.map(act => (
                    <div key={act.id} className="flex items-start gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 mt-2" />
                      <div>
                        <div className="font-semibold text-gray-800">{act.type}</div>
                        <div className="text-gray-600">{act.description}</div>
                        <div className="text-[11px] text-gray-400">{format(new Date(act.created_at), 'dd/MM/yyyy HH:mm')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-gray-700">Adicionar atividade</h4>
              <div className="flex flex-wrap gap-2">
                <select
                  value={newActivity.type}
                  onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value })}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                >
                  <option value="call">Ligação</option>
                  <option value="email">Email</option>
                  <option value="meeting">Reunião</option>
                  <option value="note">Nota</option>
                </select>
                <input
                  value={newActivity.description}
                  onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                  placeholder="Descrição"
                  className="flex-1 min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                />
                <button
                  onClick={onAddActivity}
                  className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-gray-100 rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-bold text-gray-700">Follow-up</h4>
              <input
                type="date"
                value={deal.next_follow_up || ''}
                onChange={(e) => onUpdateFollowUp(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <p className="text-xs text-gray-500">Cartão ficará vermelho se atrasar.</p>
            </div>
            <div className="border border-gray-100 rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-bold text-gray-700">Notas</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{deal.notes || 'Sem notas.'}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

