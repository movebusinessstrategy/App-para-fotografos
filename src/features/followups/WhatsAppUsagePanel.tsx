import { useState } from 'react';
import useSWR from 'swr';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { fetchJson } from './api';

interface Usage {
  sent: number | null; delivered: number | null; charged: number | null; free: number | null;
  unclassified: number | null; cost: number | null; currency: string | null; partial: boolean;
  fetched_at: string; latest_data_start: number | null;
  account: { name: string | null; phone: string; waba_id: string };
  categories: Array<{ category: string; messages: number; cost: number; charged_messages: number; charged_cost: number }>;
}

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return 'Indisponível';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 4 }).format(value);
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 py-2">
    <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
    <p className="mt-1 text-xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</p>
    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{detail}</p>
  </div>;
}

function Simulation({ data, dailyCap }: { data: Usage; dailyCap: number }) {
  const [volume, setVolume] = useState(dailyCap);
  const marketing = data.categories.find(c => c.category === 'MARKETING');
  if (!marketing?.charged_messages || !marketing.charged_cost || !data.currency) return null;
  const average = marketing.charged_cost / marketing.charged_messages;
  return <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-700">
    <label className="flex items-center gap-2">Simular envios por dia
      <input aria-label="Simular envios por dia" type="number" min="1" max="10000" value={volume}
        onChange={e => setVolume(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
        className="w-20 rounded-lg border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600" />
    </label>
    <span className="font-semibold">≈ {money(volume * average, data.currency)} / dia</span>
    <p className="w-full text-[11px] text-gray-500 dark:text-gray-400">
      Simulação com todos os envios tarifados pela média de marketing deste período. Tarifas futuras podem mudar. Simular não altera seu limite.
    </p>
  </div>;
}

export function WhatsAppUsagePanel({ dailyCap, onConfigure }: { dailyCap: number; onConfigure: () => void }) {
  const [period, setPeriod] = useState('month');
  const { data, error, isValidating, mutate } = useSWR<Usage>(`/api/followups/whatsapp-usage?period=${period}`, fetchJson,
    { refreshInterval: 300000, dedupingInterval: 30000, revalidateOnMount: true, shouldRetryOnError: false });
  const count = (value: number | null) => value === null ? 'Indisponível' : value.toLocaleString('pt-BR');
  return <section aria-label="Consumo da API do WhatsApp" className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-[13px] font-bold text-gray-900 dark:text-white">Consumo da API do WhatsApp</h3>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{data ? `${data.account.name || 'WhatsApp Business'} · +${data.account.phone}` : 'Valores e mensagens informados pela Meta'}</p>
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="Período do consumo" value={period} onChange={e => setPeriod(e.target.value)}
          className="rounded-lg border border-gray-200 bg-transparent px-2 py-1.5 text-xs dark:border-gray-600">
          <option value="today">Hoje</option><option value="7days">Últimos 7 dias</option><option value="month">Este mês</option>
        </select>
        <button type="button" aria-label="Atualizar consumo" onClick={() => void mutate()} className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
          <RefreshCw size={14} className={isValidating ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
    {error && <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">Não foi possível atualizar o consumo. {data ? 'Os valores abaixo são da última consulta.' : 'Tente novamente ou confira a conexão com a Meta.'}</p>}
    {!data && !error && <p className="py-6 text-xs text-gray-500" role="status">Consultando a Meta…</p>}
    {data && <>
      {data.partial && <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">A Meta retornou apenas parte dos dados. Valores indisponíveis não significam consumo zero.</p>}
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 lg:grid-cols-4">
        <Metric label="Custo informado pela Meta" value={money(data.cost, data.currency)} detail={`Moeda da conta: ${data.currency || 'indisponível'}`} />
        <Metric label="Enviadas pela API" value={count(data.sent)} detail={`${count(data.delivered)} entregues`} />
        <Metric label="Mensagens tarifadas" value={count(data.charged)} detail="Classificadas como regulares pela Meta" />
        <Metric label="Mensagens gratuitas" value={count(data.free)} detail="Gratuidade confirmada pela Meta" />
      </div>
      {!!data.unclassified && <p className="text-[11px] text-gray-500">{data.unclassified} mensagens com classificação ainda não reconhecida.</p>}
      <Simulation key={period} data={data} dailyCap={dailyCap} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <p>Consulta: {new Date(data.fetched_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Dados podem chegar com atraso.</p>
        <a href={`https://business.facebook.com/wa/manage/home/?waba_id=${encodeURIComponent(data.account.waba_id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Faturas e pagamentos na Meta <ExternalLink size={11} /></a>
      </div>
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Inclui todos os envios da API deste número. Não inclui mensagens enviadas pelo aplicativo ou QR. O custo de uso não confirma o valor pago da fatura.</p>
    </>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-700">
      <span>Limite atual do CRM: <strong>{dailyCap} follow-ups por dia</strong></span>
      <button type="button" onClick={onConfigure} className="rounded-lg border border-gray-300 px-3 py-2 font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700">Ajustar limite diário</button>
    </div>
  </section>;
}
