// Exportação de contatos no formato que o Meta (Facebook/Instagram) Ads aceita.
// IMPORTANTE: o Meta hasheia os dados no momento do upload pelo Gerenciador de
// Anúncios — então enviamos TEXTO PURO (e-mail/telefone normalizados, sem hash).
// São dois formatos:
//   1. Lista de clientes  → Público Personalizado / Semelhante (Lookalike) / Exclusão
//   2. Eventos offline    → Conversões offline (Purchase com valor)

import type { Client, Deal, Job, PipelineStage } from "../types";

const COUNTRY = "BR";
const CURRENCY = "BRL";

const onlyDigits = (v?: string | null) => (v || "").replace(/\D/g, "");

export type MetaContact = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type MetaOfflineEvent = MetaContact & {
  value?: number | null;
  eventTime?: string | null; // ISO/data; usamos fechamento ou data do ensaio
  eventName?: string; // "Purchase" (venda) ou "Lead" (ainda não comprou)
};

// Telefone no formato E.164 que o Meta recomenda: +55 + DDD + número.
// Aceita o que já vier com 55 na frente; descarta número curto demais (sem DDD).
export function phoneToE164(phone?: string | null): string {
  const d = onlyDigits(phone);
  if (d.length < 10) return ""; // sem DDD não dá match confiável
  if (d.startsWith("55") && d.length >= 12) return `+${d}`;
  return `+55${d}`;
}

function splitName(name?: string | null): { fn: string; ln: string } {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: "", ln: "" };
  const [fn, ...rest] = parts;
  return { fn, ln: rest.join(" ") };
}

function isoDate(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD
}

const pad = (n: number) => String(n).padStart(2, "0");

// O Meta quer data E HORA do evento. Formato ISO 8601 com o fuso local
// (2026-03-09T15:00:00-03:00): ele lê o horário certo, e o arquivo continua
// legível pra conferência, o que um timestamp Unix não seria.
function toISO8601Local(dt: Date): string {
  const off = -dt.getTimezoneOffset(); // minutos; Brasil = -180 → off = -180
  const sinal = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const data = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const hora = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  return `${data}T${hora}${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Junta a data (YYYY-MM-DD) com o horário (HH:mm) quando ele existe. Sem horário
// usa meio-dia: evita que o fuso jogue o evento pro dia anterior/seguinte.
export function eventTimestamp(data?: string | null, hora?: string | null): string {
  if (!data) return "";
  const dia = String(data).slice(0, 10);
  const temHoraNaData = String(data).includes("T");
  if (temHoraNaData && !hora) {
    const dt = new Date(data as string);
    return isNaN(dt.getTime()) ? "" : toISO8601Local(dt);
  }
  const [h, m] = String(hora || "12:00").split(":");
  const dt = new Date(`${dia}T${pad(Number(h) || 12)}:${pad(Number(m) || 0)}:00`);
  return isNaN(dt.getTime()) ? "" : toISO8601Local(dt);
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function toCSV(headers: string[], rows: string[][]): string {
  const body = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  return "﻿" + body; // BOM p/ o Excel abrir os acentos corretamente
}

// Quantos contatos da lista têm pelo menos uma chave de match (telefone ou e-mail).
export function countMatchable(contacts: MetaContact[]): number {
  return contacts.filter((c) => phoneToE164(c.phone) || (c.email || "").trim()).length;
}

// Formato "Lista de clientes" → Público Personalizado / Semelhante / Exclusão.
// Os cabeçalhos abaixo são reconhecidos automaticamente pelo Meta no upload.
export function buildMetaCustomerListCSV(contacts: MetaContact[]): string {
  const headers = ["email", "phone", "fn", "ln", "ct", "st", "zip", "country"];
  const rows: string[][] = [];
  for (const c of contacts) {
    const phone = phoneToE164(c.phone);
    const email = (c.email || "").trim().toLowerCase();
    if (!phone && !email) continue; // sem chave de match não serve
    const { fn, ln } = splitName(c.name);
    rows.push([
      email,
      phone,
      fn.toLowerCase(),
      ln.toLowerCase(),
      (c.city || "").trim().toLowerCase(),
      (c.state || "").trim().toLowerCase(),
      onlyDigits(c.zip),
      COUNTRY,
    ]);
  }
  return toCSV(headers, rows);
}

// Formato "Eventos offline / Conversões offline".
// Aceita os dois eventos no MESMO arquivo: Purchase (venda, com valor) e Lead
// (ainda não comprou, sem valor). O Meta separa pela coluna event_name.
// `value`/`currency` ficam vazios no Lead: mandar 0 seria uma compra de R$ 0.
export function buildMetaOfflineEventsCSV(events: MetaOfflineEvent[]): string {
  const headers = ["email", "phone", "fn", "ln", "event_name", "event_time", "value", "currency"];
  const rows: string[][] = [];
  for (const e of events) {
    const phone = phoneToE164(e.phone);
    const email = (e.email || "").trim().toLowerCase();
    if (!phone && !email) continue;
    const { fn, ln } = splitName(e.name);
    const temValor = e.value != null && e.value > 0;
    rows.push([
      email,
      phone,
      fn.toLowerCase(),
      ln.toLowerCase(),
      e.eventName || "Purchase",
      // já vem como ISO com hora dos construtores de evento; isoDate é só rede
      // de segurança pra quem passar uma data solta.
      String(e.eventTime || "").includes("T") ? String(e.eventTime) : isoDate(e.eventTime),
      temValor ? String(e.value) : "",
      temValor ? CURRENCY : "",
    ]);
  }
  return toCSV(headers, rows);
}

// Quantos eventos vão sair de fato no CSV (sem telefone nem e-mail o Meta não
// consegue casar com ninguém, então a linha é descartada).
export function countMatchableEvents(events: MetaOfflineEvent[]): number {
  return countMatchable(events);
}

export function clientToMetaContact(c: Client): MetaContact {
  return { name: c.name, phone: c.phone, email: c.email, city: c.city, state: c.state, zip: c.cep };
}

// Ensaio pré-reservado ainda não é venda, e cancelado deixou de ser.
const STATUS_DE_VENDA = new Set(["scheduled", "completed"]);

const soData = (d?: string | null) => (d ? String(d).slice(0, 10) : "");

const ehVenda = (job: Job) => (job.amount ?? 0) > 0 && STATUS_DE_VENDA.has(job.status);

// A data que o Meta quer no Purchase é a da VENDA, não a do ensaio. No estúdio a
// venda fecha semanas antes do ensaio acontecer (mediana de 12 dias), então datar
// pelo ensaio jogava venda antiga pra dentro da janela recente e inflava o período.
//
// `closing_date` é do CLIENTE, não da venda: quem comprou 3 vezes tem uma data só.
// Por isso ela só vale para a PRIMEIRA venda da pessoa, e só se for anterior ao
// ensaio (tem cadastro com fechamento depois do ensaio, que é incoerente).
function dataDaVenda(job: Job, client: Client, ehPrimeiraVenda: boolean, conversao?: string): string | undefined {
  if (conversao) return conversao; // veio do funil: data exata daquela venda
  const fechamento = soData(client.closing_date);
  const ensaio = soData(job.job_date);
  const fechamentoServe = fechamento && ehPrimeiraVenda && (!ensaio || fechamento <= ensaio);
  return fechamentoServe ? fechamento : undefined;
}

// Sem data de venda registrada, cai na data do ensaio (aproximação). Ensaio ainda
// por acontecer usa o dia em que foi cadastrado: o Meta recusa evento no futuro.
export function purchaseTimestamp(job: Job, venda?: string, hojeISO?: string): string {
  const hoje = hojeISO || soData(new Date().toISOString());
  const candidatas: { data?: string | null; hora?: string | null }[] = [
    { data: venda },
    { data: job.job_date, hora: job.job_time },
    { data: job.created_at },
  ];
  const passada = candidatas.find((c) => soData(c.data) && soData(c.data) <= hoje);
  return eventTimestamp(passada?.data, passada?.hora) || eventTimestamp(hoje);
}

// Data de conversão do funil, por ensaio. Cobre os dois vínculos que existem:
// deal.converted_job_id e job.deal_id.
function conversoesPorJob(deals: Deal[]): (job: Job) => string | undefined {
  const porJob = new Map<number, string>();
  const porDeal = new Map<string, string>();
  for (const d of deals) {
    if (!d.converted_at) continue;
    if (d.converted_job_id) porJob.set(d.converted_job_id, d.converted_at);
    porDeal.set(String(d.id), d.converted_at);
  }
  return (job) => porJob.get(job.id) || (job.deal_id ? porDeal.get(String(job.deal_id)) : undefined);
}

// Purchase: uma linha por ensaio vendido, com o valor e a data/hora da VENDA.
// Quem comprou 3 vezes gera 3 eventos, e o Meta soma sozinho o total gasto.
export function purchaseEvents(clients: Client[], deals: Deal[] = []): MetaOfflineEvent[] {
  const conversao = conversoesPorJob(deals);
  const eventos: MetaOfflineEvent[] = [];
  for (const c of clients) {
    const contato = clientToMetaContact(c);
    const vendas = (c.jobs || [])
      .filter(ehVenda)
      .sort((a, b) => soData(a.job_date).localeCompare(soData(b.job_date)));
    vendas.forEach((job, i) => {
      const venda = dataDaVenda(job, c, i === 0, conversao(job));
      eventos.push({ ...contato, value: job.amount, eventTime: purchaseTimestamp(job, venda), eventName: "Purchase" });
    });
  }
  return eventos;
}

// Lead: quem está no funil de Vendas e ainda não virou venda. Etapa final (ganho
// ou perdido) e lead já convertido ficam de fora — convertido já vira Purchase.
export function leadEvents(deals: Deal[], stages: PipelineStage[]): MetaOfflineEvent[] {
  const etapasFinais = new Set(stages.filter((s) => s.is_final).map((s) => s.id));
  return deals
    .filter((d) => !d.converted && !etapasFinais.has(d.stage))
    .map((d) => ({
      name: d.contact_name || d.client_name || d.title,
      phone: d.contact_phone,
      email: d.contact_email,
      value: null,
      eventTime: eventTimestamp(d.created_at),
      eventName: "Lead",
    }));
}

// ── Período ────────────────────────────────────────────────────────────────
// O Meta pede que a conversão offline seja enviada em até 62 dias depois de
// acontecer. Passou disso, o arquivo sobe mas o evento não é atribuído a
// anúncio nenhum — por isso o filtro de período e o aviso.
export const JANELA_META_DIAS = 62;

export function diasAtras(dias: number, hoje = new Date()): string {
  const d = new Date(hoje);
  d.setDate(d.getDate() - dias);
  return soData(d.toISOString());
}

// `de` e `ate` são YYYY-MM-DD (inclusive nas duas pontas).
export function filterEventsByPeriod(events: MetaOfflineEvent[], de?: string, ate?: string): MetaOfflineEvent[] {
  return events.filter((e) => {
    const dia = soData(e.eventTime);
    if (!dia) return false;
    if (de && dia < de) return false;
    if (ate && dia > ate) return false;
    return true;
  });
}

// Quantos eventos já passaram da janela de envio do Meta.
export function countForaDaJanela(events: MetaOfflineEvent[], dias = JANELA_META_DIAS): number {
  const limite = diasAtras(dias);
  return events.filter((e) => soData(e.eventTime) && soData(e.eventTime) < limite).length;
}

export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
