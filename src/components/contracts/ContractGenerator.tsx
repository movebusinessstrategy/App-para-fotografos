import React, { useEffect, useRef, useState } from 'react';
import { X, Printer, Save, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { JobWithProduction } from '../producao/ProductionBoard';
import { parseDate } from '../../utils/date';
import { cn } from '../../utils/cn';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContractData {
  // Studio
  studioName: string;
  studioCNPJ: string;
  studioAddress: string;
  studioResponsible: string;
  studioResponsibleCPF: string;
  studioCity: string;
  // Client
  clientName: string;
  clientCPF: string;
  clientAddress: string;
  clientCEP: string;
  clientPhone: string;
  clientEmail: string;
  // Service
  serviceType: string;
  serviceDate: string;
  serviceTime: string;
  serviceValue: string;
  serviceValueWords: string;
  sessionLocation: string;
  sessionDuration: string;
  packageDescription: string;
  // Payment
  downPaymentPercent: number;
  installments: number;
  extraPhotoPrice: string;
  deliveryDaysSelection: number;
  selectionDeadlineDays: number;
  deliveryDays: number;
  // Signing
  signingCity: string;
  signingDate: string;
}

interface ClientInfo {
  name: string;
  phone: string;
  email: string;
  instagram: string;
  city: string;
  state: string;
  notes: string;
  cpf?: string;
  cep?: string;
  address?: string;
}

interface ContractGeneratorProps {
  job: JobWithProduction;
  client: ClientInfo | null;
  onClose: () => void;
}

// ─── LocalStorage ─────────────────────────────────────────────────────────────

const STUDIO_KEY = 'focal_studio_settings';

function loadStudio(): Partial<ContractData> {
  try {
    const s = localStorage.getItem(STUDIO_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function saveStudio(d: ContractData) {
  const toSave = {
    studioName: d.studioName, studioCNPJ: d.studioCNPJ,
    studioAddress: d.studioAddress, studioResponsible: d.studioResponsible,
    studioResponsibleCPF: d.studioResponsibleCPF, studioCity: d.studioCity,
    downPaymentPercent: d.downPaymentPercent, installments: d.installments,
    extraPhotoPrice: d.extraPhotoPrice, deliveryDaysSelection: d.deliveryDaysSelection,
    selectionDeadlineDays: d.selectionDeadlineDays, deliveryDays: d.deliveryDays,
    signingCity: d.signingCity,
  };
  localStorage.setItem(STUDIO_KEY, JSON.stringify(toSave));
}

// ─── Contract Document (inline styles → print-safe) ───────────────────────────

function ContractDocument({ d }: { d: ContractData }) {
  const s: React.CSSProperties = {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: '11px',
    lineHeight: '1.8',
    color: '#000',
    maxWidth: '19cm',
    margin: '0 auto',
    padding: '1.5cm 2cm',
  };
  const h2s: React.CSSProperties = { fontSize: '12px', textDecoration: 'underline', textAlign: 'center', letterSpacing: '1px', fontWeight: 'bold', marginBottom: '2em', textTransform: 'uppercase' };
  const h3s: React.CSSProperties = { fontSize: '11px', textDecoration: 'underline', fontWeight: 'bold', marginTop: '2em', marginBottom: '0.5em', textTransform: 'uppercase' };
  const ps: React.CSSProperties = { textAlign: 'justify', marginBottom: '0.8em' };
  const pbolds: React.CSSProperties = { ...ps, fontWeight: 'bold' };

  const fmtValue = d.serviceValue || '0,00';
  const fmtValueWords = d.serviceValueWords ? ` (${d.serviceValueWords})` : '';

  return (
    <div style={s}>
      <h2 style={h2s}>Instrumento Particular de Contrato de Serviço de Fotografia</h2>

      <p style={ps}>
        Por este instrumento particular de contrato, de um lado, denominada <strong>CONTRATADA</strong>,{' '}
        <strong>{d.studioName || '_______________________'}</strong>, inscrito no CNPJ nº{' '}
        {d.studioCNPJ || '_______________________'}, com sede à {d.studioAddress || '_______________________'},{' '}
        neste ato representado por sua responsável, {d.studioResponsible || '_______________________'},{' '}
        inscrita no CPF nº {d.studioResponsibleCPF || '_______________________'} e, de outro lado, denominada{' '}
        <strong>CONTRATANTE: {d.clientName || '_______________________'}</strong>, inscrito(a) no CPF:{' '}
        <strong>{d.clientCPF || '_______________________'}</strong>, domiciliada na{' '}
        <strong>{d.clientAddress || '_______________________'}</strong>, CEP:{' '}
        <strong>{d.clientCEP || '_______________________'}</strong>, telefone{' '}
        <strong>{d.clientPhone || '_______________________'}</strong>, e-mail:{' '}
        <strong>{d.clientEmail || '_______________________'}</strong>, têm entre si, justo e contratado o que segue:
      </p>

      <h3 style={h3s}>Cláusula 1ª - Do Objeto:</h3>
      <p style={ps}>
        É objeto do presente contrato a prestação do serviço de{' '}
        <strong>{(d.serviceType || '_______________________').toUpperCase()}</strong> no dia{' '}
        <strong>{d.serviceDate || '__/__/____'}</strong> às{' '}
        <strong>{d.serviceTime || '__h__'}</strong>. A sessão acontecerá no{' '}
        {d.sessionLocation || 'Estúdio ou Área Externa'}, e poderá levar{' '}
        {d.sessionDuration || 'até 1 hora'}.
      </p>
      <p style={pbolds}>Parágrafo Primeiro: <span style={{ fontWeight: 'normal' }}>
        {d.packageDescription || 'A CONTRATADA disponibilizará o pacote contratado conforme acordado entre as partes.'}
      </span></p>
      <p style={pbolds}>Parágrafo Segundo: <span style={{ fontWeight: 'normal' }}>
        As fotos serão enviadas para a CONTRATANTE em até {d.deliveryDaysSelection || 2} (
        {numWord(d.deliveryDaysSelection || 2)}) dias úteis e deverão ser escolhidas pela CONTRATANTE
        no prazo de até {d.selectionDeadlineDays || 5} ({numWord(d.selectionDeadlineDays || 5)}) dias corridos após
        o envio. As mesmas serão enviadas por e-mail, programas ou arquivos para que a seleção seja feita em casa.
      </span></p>
      <p style={pbolds}>Parágrafo Terceiro: <span style={{ fontWeight: 'normal' }}>
        A CONTRATANTE poderá adquirir fotos extras no valor de R${d.extraPhotoPrice || '35,00'} por foto,
        ou comprar pacotes de fotos extras. O pagamento deverá ser realizado no ato da escolha. As fotos extras
        somente serão editadas e entregues após a confirmação do pagamento.
      </span></p>
      <p style={pbolds}>Parágrafo Quarto: <span style={{ fontWeight: 'normal' }}>
        A CONTRATADA não enviará em nenhuma hipótese fotos sem edição, ou fotos a mais da quantidade estabelecida no contrato.
      </span></p>
      <p style={pbolds}>Parágrafo Quinto: <span style={{ fontWeight: 'normal' }}>
        A CONTRATANTE não poderá transferir a outrem o direito aos serviços ajustados, porém poderá a
        CONTRATADA efetuar a devida substituição do profissional a executar o disposto na cláusula 1ª,
        sempre observando os padrões de qualidade de quem executa a prestação de serviço.
      </span></p>
      <p style={pbolds}>Parágrafo Sexto: <span style={{ fontWeight: 'normal' }}>
        A CONTRATANTE está ciente do estilo de fotografia e forma de tratamento de imagem da CONTRATADA.
      </span></p>

      <h3 style={h3s}>Cláusula 2ª - Do Pagamento:</h3>
      <p style={ps}>
        O valor total do serviço contratado, conforme descrito na Cláusula 1ª, é de{' '}
        <strong>R$ {fmtValue}{fmtValueWords}</strong>, podendo ser pago à vista ou parcelado em até{' '}
        {d.installments || 6} ({numWord(d.installments || 6)}) vezes no cartão de crédito, com incidência
        dos juros da operadora da maquininha.
      </p>
      <p style={ps}>
        Para confirmação da reserva da data, deverá ser efetuado pagamento antecipado correspondente a,
        no mínimo, {d.downPaymentPercent || 30}% (trinta por cento) do valor total contratado, a título de
        sinal e bloqueio de agenda.
      </p>
      <p style={ps}>O saldo remanescente deverá ser quitado até a data da realização do ensaio.</p>

      <h3 style={h3s}>Cláusula 3ª - Da Força Maior:</h3>
      <p style={ps}>
        Nenhuma das partes será responsabilizada pelo não cumprimento das obrigações previstas neste contrato
        quando tal descumprimento decorrer de caso fortuito ou força maior, nos termos do artigo 393 do Código
        Civil, entendendo-se como tais fatos imprevisíveis ou inevitáveis, como, por exemplo, doença grave,
        acidente, falecimento, interdição do estúdio, calamidade pública, determinação de autoridade competente
        ou qualquer outro evento alheio à vontade das partes.
      </p>
      <p style={ps}>
        Ocorrendo alguma das hipóteses acima, as partes comprometem-se a buscar solução razoável, priorizando
        o reagendamento da sessão, conforme disponibilidade de agenda. Não sendo possível a remarcação, poderá
        haver a rescisão contratual, mediante análise do caso concreto.
      </p>

      <h3 style={h3s}>Cláusula 4ª - Da Entrega do Objeto:</h3>
      <p style={ps}>
        A CONTRATADA terá o prazo de até {d.deliveryDays || 30} ({numWord(d.deliveryDays || 30)}) dias úteis,
        contados da confirmação da seleção das imagens pela CONTRATANTE, para a entrega de todo o material
        contratado, conforme descrito na Cláusula 1ª.
      </p>
      <p style={pbolds}>Parágrafo Primeiro: <span style={{ fontWeight: 'normal' }}>O prazo poderá ser alterado caso a CONTRATANTE não realize a seleção das imagens dentro do prazo estabelecido pela CONTRATADA.</span></p>
      <p style={pbolds}>Parágrafo Segundo: <span style={{ fontWeight: 'normal' }}>O prazo de entrega também poderá ser alterado em caso de pendência de pagamento referente a fotos extras ou qualquer item adicional adquirido, iniciando-se a contagem do prazo somente após a confirmação do pagamento integral.</span></p>
      <p style={pbolds}>Parágrafo Terceiro: <span style={{ fontWeight: 'normal' }}>Após a comunicação de disponibilidade, os produtos físicos permanecerão disponíveis para retirada pelo prazo máximo de 3 (três) meses.</span></p>
      <p style={pbolds}>Parágrafo Quarto: <span style={{ fontWeight: 'normal' }}>Decorrido o prazo mencionado sem retirada, a CONTRATADA poderá realizar o descarte do material físico, não sendo devido reembolso.</span></p>
      <p style={pbolds}>Parágrafo Quinto: <span style={{ fontWeight: 'normal' }}>As imagens digitais permanecerão armazenadas pelo prazo máximo de 3 (três) meses após a entrega, sendo de responsabilidade da CONTRATANTE realizar o armazenamento adequado.</span></p>

      <h3 style={h3s}>Cláusula 5ª - Da Forma de Entrega:</h3>
      <p style={ps}>As fotografias serão entregues conforme previsto no pacote contratado.</p>
      <p style={ps}>A CONTRATANTE deverá verificar o correto funcionamento do dispositivo e a integridade dos arquivos no prazo máximo de 7 (sete) dias corridos após o recebimento. A ausência de manifestação dentro do referido prazo será considerada como confirmação de recebimento e pleno funcionamento do material entregue.</p>
      <p style={ps}>A CONTRATADA não se responsabiliza por danos decorrentes de mau uso, falhas em equipamentos da CONTRATANTE, vírus, formatação indevida, exclusão acidental dos arquivos ou ausência de backup posterior.</p>

      <h3 style={h3s}>Cláusula 6ª - Da Comunicação e Falta de Retorno:</h3>
      <p style={ps}>A CONTRATANTE compromete-se a manter comunicação ativa com a CONTRATADA por meio dos canais informados no presente contrato, a fim de viabilizar a execução adequada do serviço contratado.</p>
      <p style={ps}>Caso a CONTRATANTE deixe de responder às comunicações enviadas pela CONTRATADA pelo prazo superior a 7 (sete) dias corridos, a CONTRATADA poderá dar continuidade ao serviço conforme critérios técnicos próprios, inclusive realizando a seleção de imagens quando aplicável, ou suspender o cronograma até manifestação da CONTRATANTE.</p>
      <p style={ps}>Persistindo a ausência de manifestação por período superior a 30 (trinta) dias, o contrato poderá ser considerado encerrado por abandono, não havendo devolução de valores pagos, considerando a reserva de agenda e a estrutura já disponibilizada.</p>

      <h3 style={h3s}>Cláusula 7ª - Do Cancelamento:</h3>
      <p style={ps}>Para confirmação da reserva da data, a CONTRATANTE deverá efetuar o pagamento de {d.downPaymentPercent || 30}% (trinta por cento) do valor total contratado, a título de sinal e reserva de agenda.</p>
      <p style={ps}>Em caso de cancelamento por iniciativa da CONTRATANTE, o valor pago a título de sinal não será reembolsado, considerando tratar-se de compensação pela reserva da data, organização administrativa e indisponibilização da agenda para terceiros.</p>
      <p style={ps}>Caso a CONTRATANTE já tenha efetuado o pagamento integral do valor contratado, será retido o montante correspondente a {d.downPaymentPercent || 30}% (trinta por cento), sendo o saldo eventualmente pago devolvido no prazo de até 10 (dez) dias úteis. Após a realização do ensaio, não haverá devolução de valores, por se tratar de serviço já prestado.</p>

      <h3 style={h3s}>Cláusula 8ª - Reagendamento:</h3>
      <p style={ps}>O reagendamento poderá ser solicitado pela CONTRATANTE com antecedência mínima de 10 (dez) dias da data previamente agendada, sem perda do valor pago a título de sinal, estando sujeito à disponibilidade da agenda da CONTRATADA.</p>
      <p style={ps}>Caso o reagendamento seja solicitado com prazo inferior a 10 (dez) dias da data agendada, o valor pago a título de sinal será considerado perdido. Para confirmação da nova data, será necessário o pagamento de novo sinal correspondente a {d.downPaymentPercent || 30}% (trinta por cento) do valor total contratado.</p>

      <h3 style={h3s}>Cláusula 9ª - Atraso:</h3>
      <p style={ps}>A CONTRATANTE compromete-se a comparecer no horário previamente agendado para a realização do ensaio. Em caso de atraso superior a 10 (dez) minutos, o tempo da sessão poderá ser reduzido proporcionalmente, não cabendo qualquer desconto no valor contratado.</p>
      <p style={ps}>Ultrapassado o limite de 20 (vinte) minutos de atraso, a sessão poderá ser considerada cancelada por ausência, aplicando-se as regras previstas na cláusula de cancelamento e reagendamento, não cabendo remarcação gratuita.</p>

      <h3 style={h3s}>Cláusula 10ª - Do Dano Moral e Material:</h3>
      <p style={ps}>Caso ocorra impossibilidade de utilização do material por culpa exclusiva da CONTRATADA, a CONTRATANTE poderá optar pelo reagendamento sem ônus ou pela restituição integral do valor efetivamente pago, não sendo devida indenização adicional.</p>

      <h3 style={h3s}>Cláusula 11ª - Da Responsabilidade Civil:</h3>
      <p style={ps}>A CONTRATANTE é responsável por quaisquer danos causados por si, por seus filhos ou acompanhantes aos equipamentos, cenários, objetos decorativos, mobiliário ou estrutura do estúdio, comprometendo-se ao ressarcimento integral do valor correspondente ao bem danificado, conforme valor de mercado vigente.</p>

      <h3 style={h3s}>Cláusula 12ª - Do Direito de Imagem:</h3>
      <p style={ps}>A CONTRATANTE autoriza o uso das imagens pela CONTRATADA para fins de divulgação em site, blog, cursos, amostra impressa, redes sociais e concursos. A presente cláusula estende-se a todos os participantes do ensaio.</p>

      <h3 style={h3s}>Cláusula 13ª - Foro:</h3>
      <p style={ps}>
        Os contratantes elegem, para dirimir qualquer questão pertinente a este instrumento, o foro de{' '}
        {d.studioCity || 'Cambé/PR'}, renunciando, desde logo, a qualquer outro.
      </p>
      <p style={ps}>E, por estarem justos e contratados, assinam o presente instrumento em duas vias de igual teor, juntamente com duas testemunhas idôneas abaixo nomeadas, as quais todas assistiram.</p>

      {/* Signatures */}
      <div style={{ marginTop: '3em' }}>
        <p style={ps}>{d.signingCity || d.studioCity || 'Cambé'}, {d.signingDate || '_____ de __________ de _____'}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4em' }}>
          <div style={{ textAlign: 'center', width: '45%' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '0.5em' }}>
              <strong>{d.studioResponsible || d.studioName}</strong>
            </div>
          </div>
          <div style={{ textAlign: 'center', width: '45%' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '0.5em' }}>
              <strong>{d.clientName || 'CONTRATANTE'}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Simple number-to-word for small numbers
function numWord(n: number): string {
  const words: Record<number, string> = {
    1: 'um', 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco',
    6: 'seis', 7: 'sete', 10: 'dez', 15: 'quinze', 20: 'vinte',
    30: 'trinta', 60: 'sessenta', 90: 'noventa',
  };
  return words[n] || String(n);
}

// ─── Form field helper ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-indigo-400 dark:focus:border-indigo-500 outline-none transition-colors";

// ─── Main Component ────────────────────────────────────────────────────────────

export function ContractGenerator({ job, client, onClose }: ContractGeneratorProps) {
  const studio = loadStudio();
  const contractRef = useRef<HTMLDivElement>(null);
  const [studioOpen, setStudioOpen] = useState(!studio.studioName);
  const [savedStudio, setSavedStudio] = useState(!!studio.studioName);

  const jobDate = job.job_date ? parseDate(job.job_date) : null;

  const [form, setForm] = useState<ContractData>({
    // Studio
    studioName: studio.studioName || '',
    studioCNPJ: studio.studioCNPJ || '',
    studioAddress: studio.studioAddress || '',
    studioResponsible: studio.studioResponsible || '',
    studioResponsibleCPF: studio.studioResponsibleCPF || '',
    studioCity: studio.studioCity || '',
    // Client
    clientName: client?.name || job.client_name || '',
    clientCPF: client?.cpf || '',
    clientAddress: client?.address || [client?.city, client?.state].filter(Boolean).join('/') || '',
    clientCEP: client?.cep || '',
    clientPhone: client?.phone || '',
    clientEmail: client?.email || '',
    // Service
    serviceType: job.job_type || '',
    serviceDate: jobDate ? format(jobDate, 'dd/MM/yyyy', { locale: ptBR }) : '',
    serviceTime: job.job_time || '',
    serviceValue: (job.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    serviceValueWords: '',
    sessionLocation: 'Estúdio ou Área Externa',
    sessionDuration: 'até 1 hora',
    packageDescription: '',
    // Payment
    downPaymentPercent: studio.downPaymentPercent || 30,
    installments: studio.installments || 6,
    extraPhotoPrice: studio.extraPhotoPrice || '35,00',
    deliveryDaysSelection: studio.deliveryDaysSelection || 2,
    selectionDeadlineDays: studio.selectionDeadlineDays || 5,
    deliveryDays: studio.deliveryDays || 30,
    // Signing
    signingCity: studio.signingCity || studio.studioCity || '',
    signingDate: format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
  });

  // Sync client fields whenever client prop arrives (async load)
  useEffect(() => {
    if (!client) return;
    setForm(prev => ({
      ...prev,
      clientName: prev.clientName || client.name || '',
      clientCPF: prev.clientCPF || client.cpf || '',
      clientPhone: prev.clientPhone || client.phone || '',
      clientEmail: prev.clientEmail || client.email || '',
      clientAddress: prev.clientAddress || client.address || [client.city, client.state].filter(Boolean).join('/') || '',
      clientCEP: prev.clientCEP || client.cep || '',
    }));
  }, [client]);

  const set = (key: keyof ContractData, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSaveStudio = () => {
    saveStudio(form);
    setSavedStudio(true);
    setStudioOpen(false);
  };

  const handlePrint = () => {
    if (!contractRef.current) return;
    const html = contractRef.current.innerHTML;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Contrato - ${form.clientName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; }
    @page { margin: 1.5cm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>${html}</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-indigo-600 dark:text-indigo-400" />
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Gerar Contrato</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{form.clientName || 'Cliente'} · {form.serviceDate || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-indigo-100 dark:shadow-indigo-500/20"
          >
            <Printer size={15} />
            Imprimir / Salvar PDF
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Form ── */}
        <div className="w-96 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto">
          <div className="p-4 space-y-5">

            {/* Studio section */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setStudioOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
              >
                <span className="flex items-center gap-2">
                  Configurações do Estúdio
                  {savedStudio && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-full font-semibold">Salvo</span>}
                </span>
                {studioOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {studioOpen && (
                <div className="p-4 space-y-3">
                  <Field label="Nome do estúdio"><input className={inputCls} value={form.studioName} onChange={e => set('studioName', e.target.value)} placeholder="Stúdio Pitori Ltda" /></Field>
                  <Field label="CNPJ"><input className={inputCls} value={form.studioCNPJ} onChange={e => set('studioCNPJ', e.target.value)} placeholder="00.000.000/0001-00" /></Field>
                  <Field label="Endereço completo"><input className={inputCls} value={form.studioAddress} onChange={e => set('studioAddress', e.target.value)} placeholder="Rua Exemplo, 123, Centro, Cambé/PR, CEP 00000-000" /></Field>
                  <Field label="Responsável"><input className={inputCls} value={form.studioResponsible} onChange={e => set('studioResponsible', e.target.value)} placeholder="Nome completo" /></Field>
                  <Field label="CPF do responsável"><input className={inputCls} value={form.studioResponsibleCPF} onChange={e => set('studioResponsibleCPF', e.target.value)} placeholder="000.000.000-00" /></Field>
                  <Field label="Cidade do foro"><input className={inputCls} value={form.studioCity} onChange={e => { set('studioCity', e.target.value); set('signingCity', e.target.value); }} placeholder="Cambé/PR" /></Field>
                  <button
                    onClick={handleSaveStudio}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    <Save size={13} />
                    Salvar configurações
                  </button>
                </div>
              )}
            </div>

            {/* Client section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Cliente</p>
              <div className="space-y-3">
                <Field label="Nome completo"><input className={inputCls} value={form.clientName} onChange={e => set('clientName', e.target.value)} /></Field>
                <Field label="CPF"><input className={inputCls} value={form.clientCPF} onChange={e => set('clientCPF', e.target.value)} placeholder="000.000.000-00" /></Field>
                <Field label="Endereço (rua, nº, cidade/UF)"><input className={inputCls} value={form.clientAddress} onChange={e => set('clientAddress', e.target.value)} /></Field>
                <Field label="CEP"><input className={inputCls} value={form.clientCEP} onChange={e => set('clientCEP', e.target.value)} placeholder="00000-000" /></Field>
                <Field label="Telefone"><input className={inputCls} value={form.clientPhone} onChange={e => set('clientPhone', e.target.value)} /></Field>
                <Field label="E-mail"><input className={inputCls} value={form.clientEmail} onChange={e => set('clientEmail', e.target.value)} /></Field>
              </div>
            </div>

            {/* Service section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Serviço</p>
              <div className="space-y-3">
                <Field label="Tipo de ensaio"><input className={inputCls} value={form.serviceType} onChange={e => set('serviceType', e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Data"><input className={inputCls} value={form.serviceDate} onChange={e => set('serviceDate', e.target.value)} placeholder="DD/MM/AAAA" /></Field>
                  <Field label="Horário"><input className={inputCls} value={form.serviceTime} onChange={e => set('serviceTime', e.target.value)} placeholder="10h00" /></Field>
                </div>
                <Field label="Local da sessão"><input className={inputCls} value={form.sessionLocation} onChange={e => set('sessionLocation', e.target.value)} /></Field>
                <Field label="Duração prevista"><input className={inputCls} value={form.sessionDuration} onChange={e => set('sessionDuration', e.target.value)} /></Field>
                <Field label="Descrição do pacote (Parágrafo 1º)">
                  <textarea
                    rows={4}
                    className={cn(inputCls, 'resize-none')}
                    value={form.packageDescription}
                    onChange={e => set('packageDescription', e.target.value)}
                    placeholder="Ex: 01 pen drive com 30 fotos editadas em alta resolução e as mesmas reveladas no tamanho 15x21..."
                  />
                </Field>
              </div>
            </div>

            {/* Payment section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Pagamento</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Valor total (R$)"><input className={inputCls} value={form.serviceValue} onChange={e => set('serviceValue', e.target.value)} placeholder="1.150,00" /></Field>
                  <Field label="Valor por extenso"><input className={inputCls} value={form.serviceValueWords} onChange={e => set('serviceValueWords', e.target.value)} placeholder="Mil e cento e cinquenta reais" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Sinal (%)"><input className={inputCls} type="number" value={form.downPaymentPercent} onChange={e => set('downPaymentPercent', Number(e.target.value))} /></Field>
                  <Field label="Parcelamento (x)"><input className={inputCls} type="number" value={form.installments} onChange={e => set('installments', Number(e.target.value))} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Envio para seleção (dias úteis)"><input className={inputCls} type="number" value={form.deliveryDaysSelection} onChange={e => set('deliveryDaysSelection', Number(e.target.value))} /></Field>
                  <Field label="Prazo seleção cliente (dias)"><input className={inputCls} type="number" value={form.selectionDeadlineDays} onChange={e => set('selectionDeadlineDays', Number(e.target.value))} /></Field>
                </div>
                <Field label="Prazo de entrega final (dias úteis)"><input className={inputCls} type="number" value={form.deliveryDays} onChange={e => set('deliveryDays', Number(e.target.value))} /></Field>
                <Field label="Preço foto extra (R$)"><input className={inputCls} value={form.extraPhotoPrice} onChange={e => set('extraPhotoPrice', e.target.value)} /></Field>
              </div>
            </div>

            {/* Signing */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Assinatura</p>
              <div className="space-y-3">
                <Field label="Cidade"><input className={inputCls} value={form.signingCity} onChange={e => set('signingCity', e.target.value)} /></Field>
                <Field label="Data de assinatura"><input className={inputCls} value={form.signingDate} onChange={e => set('signingDate', e.target.value)} /></Field>
              </div>
            </div>

          </div>
        </div>

        {/* ── Right: Preview ── */}
        <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-950 p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pré-visualização</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Edite os campos ao lado para atualizar em tempo real</p>
          </div>
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div ref={contractRef}>
              <ContractDocument d={form} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
