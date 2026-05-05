import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, Save, ChevronDown, ChevronUp, FileText, Send, RefreshCw, CheckCircle2, Loader2, Trash2, AlertCircle, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { parseDate } from '../../utils/date';
import { authFetch } from '../../utils/authFetch';
import { cn } from '../../utils/cn';
import { substituteVariables } from '../../utils/contractTemplate';
import { ContractTemplate } from '../../types';
import { ConfirmModal } from '../ui/ConfirmModal';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContractData {
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
  // Direito de imagem (cláusula 12)
  imageAuthorization: 'autoriza' | 'NÃO autoriza';
}

export interface Signer {
  role: 'contratada' | 'contratante';
  name: string;
  email: string;
  phone?: string;
  status: 'pending' | 'signed';
  signed_at?: string | null;
  autentique_public_id?: string | null;
}

interface Contract {
  id: number;
  client_id: number;
  job_id: number | null;
  template_id: number | null;
  status: 'draft' | 'pending_signature' | 'signed' | 'cancelled';
  contract_data: Partial<ContractData>;
  signers: Signer[];
  autentique_id: string | null;
  signed_at: string | null;
  signed_pdf_url: string | null;
}

interface StudioSettings {
  studio_name?: string;
  studio_cnpj?: string;
  studio_address?: string;
  studio_responsible?: string;
  studio_responsible_cpf?: string;
  studio_city?: string;
  down_payment_percent?: number;
  installments?: number;
  extra_photo_price?: string;
  delivery_days_selection?: number;
  selection_deadline_days?: number;
  delivery_days?: number;
  signing_city?: string;
  autentique_api_key_set?: boolean;
}

interface ContractGeneratorProps {
  contractId: number;
  onClose: () => void;
  onSaved?: (contract: Contract) => void;
  onDeleted?: () => void;
}

// ─── Defaults & merge helpers ────────────────────────────────────────────────

const EMPTY_FORM: ContractData = {
  studioName: '', studioCNPJ: '', studioAddress: '', studioResponsible: '',
  studioResponsibleCPF: '', studioCity: '',
  clientName: '', clientCPF: '', clientAddress: '', clientCEP: '', clientPhone: '', clientEmail: '',
  serviceType: '', serviceDate: '', serviceTime: '', serviceValue: '', serviceValueWords: '',
  sessionLocation: 'Estúdio ou Área Externa', sessionDuration: 'até 1 hora', packageDescription: '',
  downPaymentPercent: 30, installments: 6, extraPhotoPrice: '35,00',
  deliveryDaysSelection: 2, selectionDeadlineDays: 5, deliveryDays: 30,
  signingCity: '', signingDate: format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
  imageAuthorization: 'autoriza',
};

function buildInitialForm(contract: Contract, client: any, studio: StudioSettings | null): ContractData {
  const fromStudio: Partial<ContractData> = studio ? {
    studioName: studio.studio_name || '',
    studioCNPJ: studio.studio_cnpj || '',
    studioAddress: studio.studio_address || '',
    studioResponsible: studio.studio_responsible || '',
    studioResponsibleCPF: studio.studio_responsible_cpf || '',
    studioCity: studio.studio_city || '',
    downPaymentPercent: studio.down_payment_percent ?? 30,
    installments: studio.installments ?? 6,
    extraPhotoPrice: studio.extra_photo_price ?? '35,00',
    deliveryDaysSelection: studio.delivery_days_selection ?? 2,
    selectionDeadlineDays: studio.selection_deadline_days ?? 5,
    deliveryDays: studio.delivery_days ?? 30,
    signingCity: studio.signing_city || studio.studio_city || '',
  } : {};

  const fromClient: Partial<ContractData> = client ? {
    clientName: client.name || '',
    clientCPF: client.cpf || '',
    clientAddress: client.address || [client.city, client.state].filter(Boolean).join('/') || '',
    clientCEP: client.cep || '',
    clientPhone: client.phone || '',
    clientEmail: client.email || '',
  } : {};

  // Pre-format job_date if it's a raw ISO date
  const cd: any = { ...(contract.contract_data || {}) };
  if (cd.serviceDate && /^\d{4}-\d{2}-\d{2}/.test(cd.serviceDate)) {
    const d = parseDate(cd.serviceDate);
    if (d) cd.serviceDate = format(d, 'dd/MM/yyyy', { locale: ptBR });
  }

  // Order: empty defaults -> studio defaults -> client info -> stored contract_data (highest priority)
  return { ...EMPTY_FORM, ...fromStudio, ...fromClient, ...cd } as ContractData;
}

function buildDefaultSigners(form: ContractData, existing: Signer[] | undefined): Signer[] {
  if (existing && existing.length > 0) return existing;
  return [
    { role: 'contratada', name: form.studioResponsible || form.studioName || '', email: '', status: 'pending' },
    { role: 'contratante', name: form.clientName || '', email: form.clientEmail || '', phone: form.clientPhone || '', status: 'pending' },
  ];
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

// ─── Template-driven Document (renderiza body do modelo com variáveis) ──────

function buildTemplateVariables(d: ContractData): Record<string, string | undefined> {
  const yearMatch = d.signingDate?.match(/(\d{4})/);
  const enderecoParts = [d.clientAddress, d.clientCEP ? `CEP: ${d.clientCEP}` : ''].filter(Boolean);
  return {
    cliente_nome: d.clientName || undefined,
    cliente_cpf: d.clientCPF || undefined,
    cliente_endereco: enderecoParts.length > 0 ? enderecoParts.join(', ') : undefined,
    cliente_telefone: d.clientPhone || undefined,
    cliente_email: d.clientEmail || undefined,
    servico_data: d.serviceDate || undefined,
    servico_hora: d.serviceTime || undefined,
    servico_endereco: d.sessionLocation || undefined,
    valor_total: d.serviceValue || undefined,
    valor_extenso: d.serviceValueWords || undefined,
    // SEMPRE preenchido: 'NÃO' ou '' (vazio = "A CONTRATANTE  autoriza")
    autorizacao_imagem: d.imageAuthorization === 'NÃO autoriza' ? 'NÃO' : '',
    ano: yearMatch ? yearMatch[1] : String(new Date().getFullYear()),
  };
}

function TemplateContractDocument({ d, body }: { d: ContractData; body: string }) {
  const rendered = useMemo(() => {
    return substituteVariables(body, buildTemplateVariables(d));
  }, [body, d]);

  // Layout ABNT: A4, Times New Roman 12pt, espaçamento 1.5,
  // margens 3cm esq/topo, 2cm dir/rodapé, justificado, recuo 1.25cm
  const page: React.CSSProperties = {
    fontFamily: '"Times New Roman", Times, serif',
    fontSize: '12pt',
    lineHeight: 1.5,
    color: '#000',
    background: '#fff',
    width: '21cm',
    minHeight: '29.7cm',
    margin: '0 auto',
    padding: '3cm 2cm 2cm 3cm',
    boxSizing: 'border-box',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '14pt',
    fontWeight: 'bold',
    textAlign: 'center',
    textTransform: 'uppercase',
    margin: '0 0 1.5em 0',
    letterSpacing: '0.5px',
  };
  const clauseHeaderStyle: React.CSSProperties = {
    fontSize: '12pt',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    margin: '1.2em 0 0.6em 0',
    textAlign: 'left',
  };
  const pStyle: React.CSSProperties = {
    margin: '0 0 0.6em 0',
    textAlign: 'justify',
    textIndent: '1.25cm',
  };
  const pNoIndentStyle: React.CSSProperties = {
    margin: '0 0 0.6em 0',
    textAlign: 'justify',
  };

  const lines = rendered.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Pula linhas vazias
    if (!trimmed) { i++; continue; }

    // Título principal (Instrumento Particular...)
    if (/^INSTRUMENTO PARTICULAR/i.test(trimmed)) {
      elements.push(<h1 key={i} style={titleStyle}>{trimmed}</h1>);
      i++; continue;
    }

    // Cabeçalho de cláusula: "CLÁUSULA Xª - DO OBJETO:"
    if (/^CLÁUSULA\s+\d+/i.test(trimmed)) {
      elements.push(<h2 key={i} style={clauseHeaderStyle}>{trimmed.replace(/:$/, '')}</h2>);
      i++; continue;
    }

    // Linha de assinatura (vários underscores)
    if (/_{5,}/.test(line)) {
      // Renderiza linha de assinatura + linha de nomes (se houver)
      const sigLine = line;
      const nameLine = lines[i + 1]?.trim() || '';
      // Se a próxima linha não é underscore mas tem dois nomes (Giovana ... ClienteX)
      if (nameLine && !/_{5,}/.test(nameLine) && !/^CLÁUSULA/i.test(nameLine)) {
        elements.push(
          <div key={i} style={{ marginTop: '2.5em', textAlign: 'center', whiteSpace: 'pre-wrap', fontFamily: '"Times New Roman", serif' }}>
            <div>{sigLine}</div>
            <div style={{ fontWeight: 'bold' }}>{nameLine}</div>
          </div>
        );
        i += 2; continue;
      }
      elements.push(<div key={i} style={{ marginTop: '2.5em', textAlign: 'center' }}>{sigLine}</div>);
      i++; continue;
    }

    // "Parágrafo Primeiro: ...", "Parágrafo Segundo: ...", etc
    const paragMatch = trimmed.match(/^(Parágrafo\s+\w+:?)\s*(.*)$/);
    if (paragMatch) {
      elements.push(
        <p key={i} style={pStyle}>
          <strong>{paragMatch[1]}</strong> {paragMatch[2]}
        </p>
      );
      i++; continue;
    }

    // "Cambé, _____ de YYYY" — linha da cidade de assinatura, sem indent
    if (/^[A-ZÁÉÍÓÚ][a-záéíóúâêôãõç]+,\s+_{5,}\s+de/i.test(trimmed)) {
      elements.push(<p key={i} style={{ ...pNoIndentStyle, marginTop: '2em' }}>{trimmed}</p>);
      i++; continue;
    }

    // Parágrafo normal
    elements.push(<p key={i} style={pStyle}>{trimmed}</p>);
    i++;
  }

  return <div style={page}>{elements}</div>;
}

function numWord(n: number): string {
  const words: Record<number, string> = {
    1: 'um', 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco',
    6: 'seis', 7: 'sete', 10: 'dez', 15: 'quinze', 20: 'vinte',
    30: 'trinta', 60: 'sessenta', 90: 'noventa',
  };
  return words[n] || String(n);
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-gold-400 dark:focus:border-gold-500 outline-none transition-colors";

// ─── Main Component ────────────────────────────────────────────────────────────

type ToastKind = 'success' | 'error' | 'info';
interface ToastState { kind: ToastKind; message: string }
interface ConfirmState {
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
}

export function ContractGenerator({ contractId, onClose, onSaved, onDeleted }: ContractGeneratorProps) {
  const contractRef = useRef<HTMLDivElement>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [studio, setStudio] = useState<StudioSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const showToast = (kind: ToastKind, message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4000);
  };

  const [form, setForm] = useState<ContractData>(EMPTY_FORM);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [template, setTemplate] = useState<ContractTemplate | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cRes = await authFetch(`/api/contracts/${contractId}`);
        if (!cRes.ok) throw new Error('Contrato não encontrado');
        const c: Contract = await cRes.json();

        const [clientRes, studioRes, templateRes] = await Promise.all([
          authFetch(`/api/clients/${c.client_id}`),
          authFetch('/api/studio-settings'),
          c.template_id
            ? authFetch(`/api/contract-templates/${c.template_id}`).catch(() => null)
            : Promise.resolve(null),
        ]);
        const client = clientRes.ok ? await clientRes.json() : null;
        const s: StudioSettings | null = studioRes.ok ? await studioRes.json() : null;
        const tpl: ContractTemplate | null = templateRes && templateRes.ok ? await templateRes.json() : null;

        if (cancelled) return;
        const initial = buildInitialForm(c, client, s);
        setContract(c);
        setStudio(s);
        setTemplate(tpl);
        setForm(initial);
        setSigners(buildDefaultSigners(initial, c.signers));
        setStudioOpen(!s?.studio_name);

        // Auto-refresh status from Autentique when opening a pending contract.
        // Avoids the "client signed but app didn't notice" issue without a webhook.
        if (c.status === 'pending_signature' && c.autentique_id) {
          authFetch(`/api/contracts/${c.id}/autentique-refresh`, { method: 'POST' })
            .then(async (rr) => {
              if (!rr.ok) {
                const err = await rr.json().catch(() => ({}));
                if (!cancelled) showToast('error', 'Falha ao atualizar Autentique: ' + (err.error || rr.statusText));
                return;
              }
              const fresh = await authFetch(`/api/contracts/${c.id}`);
              if (!fresh.ok || cancelled) return;
              const updated: Contract = await fresh.json();
              setContract(updated);
              setSigners(updated.signers || []);
              const signed = (updated.signers || []).filter(s => s.status === 'signed').length;
              const total = (updated.signers || []).length;
              if (updated.status === 'signed') {
                showToast('success', 'Todos assinaram! Contrato movido para Assinados.');
              } else if (signed > 0) {
                showToast('info', `Status atualizado: ${signed} de ${total} já assinaram.`);
              }
            })
            .catch((err) => {
              if (!cancelled) showToast('error', 'Erro ao consultar Autentique: ' + (err?.message || err));
            });
        }
      } catch (err) {
        console.error(err);
        showToast('error', 'Erro ao carregar contrato.');
        setTimeout(onClose, 800);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contractId]);

  const set = (key: keyof ContractData, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const updateSigner = (idx: number, patch: Partial<Signer>) =>
    setSigners(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/contracts/${contractId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_data: form, signers }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('error', 'Erro ao salvar: ' + (err.error || res.statusText));
        return;
      }
      const updated = await res.json();
      setContract(updated);
      onSaved?.(updated);
      showToast('success', 'Contrato salvo.');
    } finally {
      setSaving(false);
    }
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
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    /* As margens são definidas pela própria div do contrato (padding 3-2-2-3 no ABNT). */
    @page { margin: 0; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>${html}</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  const doSendAutentique = async () => {
    if (!contractRef.current) return;
    setSending(true);
    try {
      // Save first to ensure backend has latest data
      await authFetch(`/api/contracts/${contractId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_data: form, signers }),
      });

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>* { box-sizing: border-box; }</style></head><body>${contractRef.current.innerHTML}</body></html>`;
      const res = await authFetch(`/api/contracts/${contractId}/autentique-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('error', 'Erro ao enviar: ' + (err.error || res.statusText));
        return;
      }
      const cRes = await authFetch(`/api/contracts/${contractId}`);
      if (cRes.ok) {
        const updated = await cRes.json();
        setContract(updated);
        setSigners(updated.signers || signers);
        onSaved?.(updated);
      }
      showToast('success', 'Contrato enviado para assinatura!');
    } finally {
      setSending(false);
    }
  };

  const handleSendAutentique = () => {
    if (!studio?.autentique_api_key_set) {
      showToast('error', 'Configure a chave da API Autentique em Contratos > Configurações antes de enviar.');
      return;
    }
    if (!signers.every(s => s.email)) {
      showToast('error', 'Todos os signatários precisam ter e-mail antes de enviar para a Autentique.');
      return;
    }
    setConfirmState({
      title: 'Enviar para Autentique',
      message: 'Enviar este contrato para os signatários via Autentique? Cada um receberá um e-mail com o link de assinatura.',
      confirmText: 'Enviar',
      variant: 'default',
      onConfirm: doSendAutentique,
    });
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      const res = await authFetch(`/api/contracts/${contractId}/autentique-refresh`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('error', 'Erro ao atualizar: ' + (err.error || res.statusText));
        return;
      }
      const cRes = await authFetch(`/api/contracts/${contractId}`);
      if (cRes.ok) {
        const updated = await cRes.json();
        setContract(updated);
        setSigners(updated.signers || signers);
        onSaved?.(updated);
        const allSigned = (updated.signers || []).every((s: Signer) => s.status === 'signed');
        showToast(allSigned ? 'success' : 'info',
          allSigned ? 'Todos assinaram! Contrato movido para Assinados.' : 'Status atualizado.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const doMarkSigned = async () => {
    const newSigners = signers.map(s => ({ ...s, status: 'signed' as const, signed_at: new Date().toISOString() }));
    const res = await authFetch(`/api/contracts/${contractId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signers: newSigners,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setContract(updated);
      setSigners(updated.signers || newSigners);
      onSaved?.(updated);
      showToast('success', 'Contrato marcado como assinado.');
    }
  };

  const handleMarkSigned = () => {
    setConfirmState({
      title: 'Marcar como assinado',
      message: 'Marcar este contrato como assinado manualmente? Use isso quando o contrato foi assinado fora da Autentique.',
      confirmText: 'Marcar como assinado',
      variant: 'default',
      onConfirm: doMarkSigned,
    });
  };

  const doDelete = async () => {
    const res = await authFetch(`/api/contracts/${contractId}`, { method: 'DELETE' });
    if (res.ok) {
      onDeleted?.();
      onClose();
    }
  };

  const handleDelete = () => {
    setConfirmState({
      title: 'Excluir contrato',
      message: 'Excluir este contrato? Esta ação não pode ser desfeita.',
      confirmText: 'Excluir',
      variant: 'danger',
      onConfirm: doDelete,
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 size={18} className="animate-spin" /> Carregando contrato...
        </div>
      </div>
    );
  }

  const isSigned = contract?.status === 'signed';
  const isPending = contract?.status === 'pending_signature';
  const isDraft = contract?.status === 'draft';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-gold-600 dark:text-gold-400" />
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {isSigned ? 'Contrato Assinado' : isPending ? 'Aguardando Assinaturas' : 'Editar Contrato'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {form.clientName || 'Cliente'} · {form.serviceDate || '—'}
              {template && (
                <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-400 font-semibold text-[10px]">
                  <FileText size={9} /> {template.name}
                </span>
              )}
            </p>
          </div>
          <StatusBadge status={contract?.status || 'draft'} />
        </div>
        <div className="flex items-center gap-2">
          {!isSigned && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Salvar
            </button>
          )}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-gold-100 dark:shadow-gold-500/20"
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

            {/* Status & Signers panel */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status dos signatários</p>
                {isPending && contract?.autentique_id && (
                  <button
                    onClick={handleRefreshStatus}
                    disabled={refreshing}
                    className="flex items-center gap-1 text-[10px] font-semibold text-gold-600 hover:text-gold-700 disabled:opacity-60"
                  >
                    {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    Atualizar
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {signers.map((s, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">
                        {s.role === 'contratada' ? 'Contratada' : 'Contratante'}
                      </span>
                      {s.status === 'signed' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={10} /> Assinado
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          Pendente
                        </span>
                      )}
                    </div>
                    <input
                      className={cn(inputCls, 'text-xs')}
                      value={s.name}
                      placeholder="Nome"
                      onChange={e => updateSigner(i, { name: e.target.value })}
                      disabled={isSigned}
                    />
                    <input
                      className={cn(inputCls, 'text-xs')}
                      type="email"
                      value={s.email}
                      placeholder="E-mail (obrigatório p/ Autentique)"
                      onChange={e => updateSigner(i, { email: e.target.value })}
                      disabled={isSigned || isPending}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            {!isSigned && (
              <div className="space-y-2">
                {isDraft && (
                  <button
                    onClick={handleSendAutentique}
                    disabled={sending || !studio?.autentique_api_key_set}
                    title={!studio?.autentique_api_key_set ? 'Configure a chave da Autentique em Configurações' : ''}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Enviar para Autentique
                  </button>
                )}
                <button
                  onClick={handleMarkSigned}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <CheckCircle2 size={14} />
                  Marcar como assinado manualmente
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                  Excluir contrato
                </button>
              </div>
            )}

            {/* Studio section (collapsible) */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setStudioOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 transition-colors"
              >
                <span>Configurações do Estúdio</span>
                {studioOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {studioOpen && (
                <div className="p-4 space-y-3">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    Padrões da empresa. Para editar permanentemente, use a aba <strong>Configurações</strong> em Contratos.
                  </p>
                  <Field label="Nome do estúdio"><input className={inputCls} value={form.studioName} onChange={e => set('studioName', e.target.value)} disabled={isSigned} /></Field>
                  <Field label="CNPJ"><input className={inputCls} value={form.studioCNPJ} onChange={e => set('studioCNPJ', e.target.value)} disabled={isSigned} /></Field>
                  <Field label="Endereço completo"><input className={inputCls} value={form.studioAddress} onChange={e => set('studioAddress', e.target.value)} disabled={isSigned} /></Field>
                  <Field label="Responsável"><input className={inputCls} value={form.studioResponsible} onChange={e => set('studioResponsible', e.target.value)} disabled={isSigned} /></Field>
                  <Field label="CPF do responsável"><input className={inputCls} value={form.studioResponsibleCPF} onChange={e => set('studioResponsibleCPF', e.target.value)} disabled={isSigned} /></Field>
                  <Field label="Cidade do foro"><input className={inputCls} value={form.studioCity} onChange={e => { set('studioCity', e.target.value); set('signingCity', e.target.value); }} disabled={isSigned} /></Field>
                </div>
              )}
            </div>

            {/* Client section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Cliente</p>
              <div className="space-y-3">
                <Field label="Nome completo"><input className={inputCls} value={form.clientName} onChange={e => set('clientName', e.target.value)} disabled={isSigned} /></Field>
                <Field label="CPF"><input className={inputCls} value={form.clientCPF} onChange={e => set('clientCPF', e.target.value)} disabled={isSigned} /></Field>
                <Field label="Endereço (rua, nº, cidade/UF)"><input className={inputCls} value={form.clientAddress} onChange={e => set('clientAddress', e.target.value)} disabled={isSigned} /></Field>
                <Field label="CEP"><input className={inputCls} value={form.clientCEP} onChange={e => set('clientCEP', e.target.value)} disabled={isSigned} /></Field>
                <Field label="Telefone"><input className={inputCls} value={form.clientPhone} onChange={e => set('clientPhone', e.target.value)} disabled={isSigned} /></Field>
                <Field label="E-mail"><input className={inputCls} value={form.clientEmail} onChange={e => set('clientEmail', e.target.value)} disabled={isSigned} /></Field>
              </div>
            </div>

            {/* Service section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Serviço</p>
              <div className="space-y-3">
                <Field label="Tipo de ensaio"><input className={inputCls} value={form.serviceType} onChange={e => set('serviceType', e.target.value)} disabled={isSigned} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Data"><input className={inputCls} value={form.serviceDate} onChange={e => set('serviceDate', e.target.value)} placeholder="DD/MM/AAAA" disabled={isSigned} /></Field>
                  <Field label="Horário"><input className={inputCls} value={form.serviceTime} onChange={e => set('serviceTime', e.target.value)} placeholder="10h00" disabled={isSigned} /></Field>
                </div>
                <Field label="Local da sessão"><input className={inputCls} value={form.sessionLocation} onChange={e => set('sessionLocation', e.target.value)} disabled={isSigned} /></Field>
                <Field label="Duração prevista"><input className={inputCls} value={form.sessionDuration} onChange={e => set('sessionDuration', e.target.value)} disabled={isSigned} /></Field>
                <Field label="Descrição do pacote (Parágrafo 1º)">
                  <textarea
                    rows={4}
                    className={cn(inputCls, 'resize-none')}
                    value={form.packageDescription}
                    onChange={e => set('packageDescription', e.target.value)}
                    disabled={isSigned}
                    placeholder="Ex: 01 pen drive com 30 fotos editadas em alta resolução..."
                  />
                </Field>
              </div>
            </div>

            {/* Payment section */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Pagamento</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Valor total (R$)"><input className={inputCls} value={form.serviceValue} onChange={e => set('serviceValue', e.target.value)} placeholder="1.150,00" disabled={isSigned} /></Field>
                  <Field label="Valor por extenso"><input className={inputCls} value={form.serviceValueWords} onChange={e => set('serviceValueWords', e.target.value)} placeholder="Mil e cento e cinquenta reais" disabled={isSigned} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Sinal (%)"><input className={inputCls} type="number" value={form.downPaymentPercent} onChange={e => set('downPaymentPercent', Number(e.target.value))} disabled={isSigned} /></Field>
                  <Field label="Parcelamento (x)"><input className={inputCls} type="number" value={form.installments} onChange={e => set('installments', Number(e.target.value))} disabled={isSigned} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Envio para seleção (dias úteis)"><input className={inputCls} type="number" value={form.deliveryDaysSelection} onChange={e => set('deliveryDaysSelection', Number(e.target.value))} disabled={isSigned} /></Field>
                  <Field label="Prazo seleção cliente (dias)"><input className={inputCls} type="number" value={form.selectionDeadlineDays} onChange={e => set('selectionDeadlineDays', Number(e.target.value))} disabled={isSigned} /></Field>
                </div>
                <Field label="Prazo de entrega final (dias úteis)"><input className={inputCls} type="number" value={form.deliveryDays} onChange={e => set('deliveryDays', Number(e.target.value))} disabled={isSigned} /></Field>
                <Field label="Preço foto extra (R$)"><input className={inputCls} value={form.extraPhotoPrice} onChange={e => set('extraPhotoPrice', e.target.value)} disabled={isSigned} /></Field>
              </div>
            </div>

            {/* Direito de imagem (cláusula 12) */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Direito de imagem</p>
              <Field label="A CONTRATANTE…">
                <select
                  className={inputCls}
                  value={form.imageAuthorization}
                  onChange={e => set('imageAuthorization', e.target.value as 'autoriza' | 'NÃO autoriza')}
                  disabled={isSigned}
                >
                  <option value="autoriza">…autoriza o uso das imagens</option>
                  <option value="NÃO autoriza">…NÃO autoriza o uso das imagens</option>
                </select>
              </Field>
            </div>

            {/* Signing */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Assinatura</p>
              <div className="space-y-3">
                <Field label="Cidade"><input className={inputCls} value={form.signingCity} onChange={e => set('signingCity', e.target.value)} disabled={isSigned} /></Field>
                <Field label="Data de assinatura"><input className={inputCls} value={form.signingDate} onChange={e => set('signingDate', e.target.value)} disabled={isSigned} /></Field>
              </div>
            </div>

          </div>
        </div>

        {/* ── Right: Preview ── */}
        <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-950 p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pré-visualização</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {isSigned ? 'Contrato assinado · somente leitura' : 'Edite os campos ao lado para atualizar em tempo real'}
            </p>
          </div>
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div ref={contractRef}>
              {template ? (
                <TemplateContractDocument d={form} body={template.body} />
              ) : (
                <ContractDocument d={form} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-[110] animate-in slide-in-from-top-2 fade-in duration-200">
          <div className={cn(
            'flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl backdrop-blur border max-w-md',
            toast.kind === 'success' && 'bg-emerald-50/95 dark:bg-emerald-900/80 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-100',
            toast.kind === 'error' && 'bg-red-50/95 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-800 dark:text-red-100',
            toast.kind === 'info' && 'bg-gray-50/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100',
          )}>
            {toast.kind === 'success' && <CheckCheck size={16} className="flex-shrink-0" />}
            {toast.kind === 'error' && <AlertCircle size={16} className="flex-shrink-0" />}
            {toast.kind === 'info' && <RefreshCw size={16} className="flex-shrink-0" />}
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        open={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message || ''}
        confirmText={confirmState?.confirmText}
        variant={confirmState?.variant}
        onConfirm={() => {
          const action = confirmState?.onConfirm;
          setConfirmState(null);
          action?.();
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Contract['status'] }) {
  const map = {
    draft: { label: 'Rascunho', cls: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
    pending_signature: { label: 'Aguardando assinatura', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' },
    signed: { label: 'Assinado', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' },
  } as const;
  const it = map[status];
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ml-2', it.cls)}>
      {it.label}
    </span>
  );
}
