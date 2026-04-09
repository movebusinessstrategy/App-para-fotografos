import React, { useEffect, useState } from 'react';
import { Gift, RefreshCw, Cake, Baby, Target, Zap, Users, Sparkles, PartyPopper } from 'lucide-react';
import { DashboardCards } from '../components/oportunidades/DashboardCards';
import { FiltrosPeriodo } from '../components/oportunidades/FiltrosPeriodo';
import { AniversariantesList } from '../components/oportunidades/AniversariantesList';
import { OportunidadesList } from '../components/oportunidades/OportunidadesList';
import { GerarCupomModal } from '../components/oportunidades/GerarCupomModal';
import { EnviarMensagemModal } from '../components/oportunidades/EnviarMensagemModal';
import { GerenciarFilhosPanel } from '../components/oportunidades/GerenciarFilhosPanel';
import { useAniversariantes } from '../hooks/useAniversariantes';
import { useOportunidades } from '../hooks/useOportunidades';
import { oportunidadesApi } from '../services/api/oportunidades';
import { authFetch } from '../utils/authFetch';
import { Aniversariante, Oportunidade } from '../types';
import { cn } from '../utils/cn';

type Tab = 'aniversariantes' | 'newborn' | 'aniversario' | 'smash' | 'acompanhamentos' | 'todas' | 'filhos';

export default function OportunidadesPage() {
  const [tab, setTab] = useState<Tab>('aniversariantes');
  const [periodo, setPeriodo] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [dashboard, setDashboard] = useState({ anivHoje: 0, anivSemana: 0, totalPendentes: 0, taxaConversao: 0 });
  const [dashLoading, setDashLoading] = useState(true);
  const [smash, setSmash] = useState<any[]>([]);
  const [smashLoading, setSmashLoading] = useState(false);
  const [acomp, setAcomp] = useState<any[]>([]);
  const [acompLoading, setAcompLoading] = useState(false);
  const [newborn, setNewborn] = useState<any[]>([]);
  const [newbornLoading, setNewbornLoading] = useState(false);
  const [aniversario, setAniversario] = useState<any[]>([]);
  const [aniversarioLoading, setAniversarioLoading] = useState(false);

  // (no modal needed for "todas" tab)

  const [whatsAppTarget, setWhatsAppTarget] = useState<Aniversariante | null>(null);
  const [cupomTarget, setCupomTarget] = useState<Aniversariante | null>(null);
  const [lastCupom, setLastCupom] = useState<string | undefined>();

  const { data: aniversariantes, loading: anivLoading, refetch: refetchAniv } = useAniversariantes(periodo);
  const { data: oportunidades, loading: opsLoading, refetch: refetchOps, update: updateOp } = useOportunidades();

  useEffect(() => {
    setDashLoading(true);
    oportunidadesApi.getDashboard()
      .then(setDashboard)
      .catch(console.error)
      .finally(() => setDashLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'smash') {
      setSmashLoading(true);
      oportunidadesApi.getSmashTheCake().then(setSmash).catch(console.error).finally(() => setSmashLoading(false));
    }
    if (tab === 'acompanhamentos') {
      setAcompLoading(true);
      oportunidadesApi.getAcompanhamentos().then(setAcomp).catch(console.error).finally(() => setAcompLoading(false));
    }
    if (tab === 'newborn') {
      setNewbornLoading(true);
      oportunidadesApi.getNewborn().then(setNewborn).catch(console.error).finally(() => setNewbornLoading(false));
    }
    if (tab === 'aniversario') {
      setAniversarioLoading(true);
      oportunidadesApi.getAniversario().then(setAniversario).catch(console.error).finally(() => setAniversarioLoading(false));
    }
  }, [tab]);

  const handleCriarOportunidade = async (a: Aniversariante) => {
    try {
      await oportunidadesApi.createOportunidade({
        cliente_id: a.clienteId,
        tipo: a.tipo === 'MAE' ? 'Aniversário Mãe' : `Aniversário Filho - ${a.nome}`,
        data_oportunidade: new Date().toISOString().split('T')[0],
        status: 'future',
        notas: `Aniversário em ${new Date(a.dataNascimento + 'T12:00:00').toLocaleDateString('pt-BR')} — ${a.diasParaAniversario === 0 ? 'hoje!' : `em ${a.diasParaAniversario} dias`}`,
      });
      refetchOps();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendToKanban = async (op: Oportunidade) => {
    await authFetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: op.tipo,
        client_id: op.cliente_id || null,
        value: op.valor_proposta || 0,
        notes: op.notas || `Oportunidade: ${op.tipo}`,
        priority: 'medium',
      }),
    });
    await updateOp(op.id, { status: 'em_kanban' });
  };

  const handleDiscard = async (id: string) => {
    await updateOp(id, { status: 'dismissed' });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'aniversariantes', label: 'Aniversariantes', icon: <Gift size={15} /> },
    { id: 'newborn',         label: 'Newborn',         icon: <Sparkles size={15} /> },
    { id: 'aniversario',     label: 'Aniversário',     icon: <PartyPopper size={15} /> },
    { id: 'smash',           label: 'Smash the Cake',  icon: <Cake size={15} /> },
    { id: 'acompanhamentos', label: 'Acompanhamentos', icon: <Baby size={15} /> },
    { id: 'todas',           label: 'Todas',           icon: <Target size={15} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Oportunidades</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Newborn, Aniversário, Smash the Cake, Acompanhamentos e mais</p>
        </div>
        <button
          onClick={() => { refetchAniv(); refetchOps(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>

      {/* Dashboard Cards */}
      <DashboardCards {...dashboard} loading={dashLoading} />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl w-fit flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.id
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'aniversariantes' && (
        <div className="space-y-6">
          {/* Aviso: esta aba é para cupons/mensagens de aniversário */}
          <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3">
            <Gift size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              <strong>Parabéns para o cliente!</strong> — Esta seção mostra clientes com aniversário próximo para você enviar uma mensagem carinhosa ou um cupom especial de desconto.
            </p>
          </div>
          <div className="space-y-4">
            <FiltrosPeriodo value={periodo} onChange={setPeriodo} />
            <AniversariantesList
              data={aniversariantes}
              loading={anivLoading}
              onWhatsApp={setWhatsAppTarget}
              onCupom={setCupomTarget}
              onCriarOportunidade={handleCriarOportunidade}
            />
          </div>
        </div>
      )}

      {tab === 'newborn' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Sparkles size={15} />
              <span>Bebês nascidos nos últimos 30 dias — janela ideal para ensaio newborn</span>
            </div>
            {newbornLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-20 animate-pulse" />)}
              </div>
            ) : newborn.length === 0 ? (
              <div className="text-center py-10">
                <Sparkles size={28} className="text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum bebê recém-nascido no momento</p>
              </div>
            ) : newborn.map((f: any, i: number) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-50 dark:bg-sky-500/20 rounded-xl flex items-center justify-center">
                      <Sparkles size={18} className="text-sky-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{f.nome}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Filho(a) de {f.clienteNome} · {f.diasDeVida === 0 ? 'nasceu hoje!' : `${f.diasDeVida} dias de vida`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      oportunidadesApi.createOportunidade({
                        cliente_id: f.clienteId,
                        tipo: 'Newborn',
                        data_oportunidade: new Date().toISOString().split('T')[0],
                        status: 'urgent',
                        notas: `${f.nome} nasceu há ${f.diasDeVida} dias — janela newborn`,
                      } as any).then(refetchOps).catch(console.error);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-xs font-medium text-white transition-colors"
                  >
                    <Zap size={12} />
                    Criar Oferta
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Oportunidades Newborn criadas */}
          {oportunidades.some(o => o.tipo === 'Newborn') && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  Oportunidades criadas — Newborn
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
              <OportunidadesList
                data={oportunidades.filter(o => o.tipo === 'Newborn')}
                loading={opsLoading}
                onSendToKanban={handleSendToKanban}
                onDiscard={handleDiscard}
                compact
              />
            </div>
          )}
        </div>
      )}

      {tab === 'aniversario' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <PartyPopper size={15} />
              <span>Filhos completando 2 anos ou mais nos próximos 30 dias</span>
            </div>
            {aniversarioLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-20 animate-pulse" />)}
              </div>
            ) : aniversario.length === 0 ? (
              <div className="text-center py-10">
                <PartyPopper size={28} className="text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum aniversário nos próximos 30 dias</p>
              </div>
            ) : aniversario.map((f: any, i: number) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-rose-50 dark:bg-rose-500/20 rounded-xl flex items-center justify-center">
                      <PartyPopper size={18} className="text-rose-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{f.nome}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Filho(a) de {f.clienteNome} · completa {f.idadeQueCompleta} anos em {f.diasParaAniversario === 0 ? 'hoje!' : `${f.diasParaAniversario} dias`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      oportunidadesApi.createOportunidade({
                        cliente_id: f.clienteId,
                        tipo: 'Aniversário',
                        data_oportunidade: new Date().toISOString().split('T')[0],
                        status: f.diasParaAniversario <= 7 ? 'urgent' : 'active',
                        notas: `${f.nome} completa ${f.idadeQueCompleta} anos em ${f.diasParaAniversario === 0 ? 'hoje' : `${f.diasParaAniversario} dias`}`,
                      } as any).then(refetchOps).catch(console.error);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-medium text-white transition-colors"
                  >
                    <Zap size={12} />
                    Criar Oferta
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Oportunidades Aniversário criadas */}
          {oportunidades.some(o => o.tipo === 'Aniversário') && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  Oportunidades criadas — Aniversário
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
              <OportunidadesList
                data={oportunidades.filter(o => o.tipo === 'Aniversário')}
                loading={opsLoading}
                onSendToKanban={handleSendToKanban}
                onDiscard={handleDiscard}
                compact
              />
            </div>
          )}
        </div>
      )}

      {tab === 'smash' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Cake size={15} />
              <span>Bebês completando 1 ano nos próximos 30 dias</span>
            </div>
            {smashLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-20 animate-pulse" />)}
              </div>
            ) : smash.length === 0 ? (
              <div className="text-center py-10">
                <Cake size={28} className="text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum bebê completando 1 ano nos próximos 30 dias</p>
              </div>
            ) : smash.map((f: any, i: number) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-pink-50 dark:bg-pink-500/20 rounded-xl flex items-center justify-center">
                      <Cake size={18} className="text-pink-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{f.nome}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Filho(a) de {f.clienteNome} · 1 ano em {f.diasParaAniversario === 0 ? 'hoje' : `${f.diasParaAniversario} dias`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      oportunidadesApi.createOportunidade({
                        cliente_id: f.clienteId,
                        tipo: 'Smash the Cake',
                        data_oportunidade: new Date().toISOString().split('T')[0],
                        status: 'future',
                        notas: `${f.nome} completa 1 ano em ${f.diasParaAniversario === 0 ? 'hoje' : `${f.diasParaAniversario} dias`}`,
                      } as any).then(refetchOps).catch(console.error);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs font-medium text-white transition-colors"
                  >
                    <Zap size={12} />
                    Criar Oferta
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Oportunidades Smash criadas */}
          {oportunidades.some(o => o.tipo === 'Smash the Cake') && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  Oportunidades criadas — Smash the Cake
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
              <OportunidadesList
                data={oportunidades.filter(o => o.tipo === 'Smash the Cake')}
                loading={opsLoading}
                onSendToKanban={handleSendToKanban}
                onDiscard={handleDiscard}
                compact
              />
            </div>
          )}
        </div>
      )}

      {tab === 'acompanhamentos' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Baby size={15} />
              <span>Bebês com 3, 6, 9 ou 12 meses de vida</span>
            </div>
            {acompLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 h-20 animate-pulse" />)}
              </div>
            ) : acomp.length === 0 ? (
              <div className="text-center py-10">
                <Baby size={28} className="text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum bebê em marco de acompanhamento no momento</p>
              </div>
            ) : acomp.map((f: any, i: number) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
                      <Baby size={18} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{f.nome}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Filho(a) de {f.clienteNome} · {f.idadeMeses} meses de vida
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      oportunidadesApi.createOportunidade({
                        cliente_id: f.clienteId,
                        tipo: `Acompanhamento ${f.idadeMeses} meses`,
                        data_oportunidade: new Date().toISOString().split('T')[0],
                        status: 'future',
                        notas: `${f.nome} está com ${f.idadeMeses} meses de vida`,
                      } as any).then(refetchOps).catch(console.error);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs font-medium text-white transition-colors"
                  >
                    <Zap size={12} />
                    Criar Oferta
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Oportunidades de acompanhamento criadas */}
          {oportunidades.some(o => o.tipo.startsWith('Acompanhamento')) && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  Oportunidades criadas — Acompanhamentos
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
              <OportunidadesList
                data={oportunidades.filter(o => o.tipo.startsWith('Acompanhamento'))}
                loading={opsLoading}
                onSendToKanban={handleSendToKanban}
                onDiscard={handleDiscard}
                compact
              />
            </div>
          )}
        </div>
      )}

      {tab === 'todas' && (
        <OportunidadesList
          data={oportunidades}
          loading={opsLoading}
          onSendToKanban={handleSendToKanban}
          onDiscard={handleDiscard}
        />
      )}


      {/* Birthday Modals */}
      {whatsAppTarget && (
        <EnviarMensagemModal
          aniversariante={whatsAppTarget}
          cupom={lastCupom}
          onClose={() => setWhatsAppTarget(null)}
        />
      )}
      {cupomTarget && (
        <GerarCupomModal
          aniversariante={cupomTarget}
          onClose={() => setCupomTarget(null)}
          onSuccess={c => setLastCupom(c.codigo)}
        />
      )}
    </div>
  );
}
