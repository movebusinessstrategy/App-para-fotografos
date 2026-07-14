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
      isoDate(e.eventTime),
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

// O Meta recusa evento com data no futuro. Um ensaio agendado pra semana que vem
// tem job_date futuro, mas a VENDA aconteceu quando foi registrada — então a data
// do Purchase é a primeira data que já passou: ensaio → cadastro do ensaio →
// fechamento do cliente.
export function purchaseDate(job: Job, client: Client, hojeISO?: string): string {
  const hoje = hojeISO || soData(new Date().toISOString());
  const candidatas = [job.job_date, job.created_at, client.closing_date, client.created_at];
  const passadas = candidatas.map(soData).filter((d) => d && d <= hoje);
  return passadas[0] || hoje;
}

// Purchase: uma linha por ensaio vendido, com o valor e a data daquela venda.
// Quem comprou 3 vezes gera 3 eventos, e o Meta soma sozinho o total gasto.
export function purchaseEvents(clients: Client[]): MetaOfflineEvent[] {
  const eventos: MetaOfflineEvent[] = [];
  for (const c of clients) {
    const contato = clientToMetaContact(c);
    for (const job of c.jobs || []) {
      if (!((job.amount ?? 0) > 0) || !STATUS_DE_VENDA.has(job.status)) continue;
      eventos.push({ ...contato, value: job.amount, eventTime: purchaseDate(job, c), eventName: "Purchase" });
    }
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
      eventTime: d.created_at,
      eventName: "Lead",
    }));
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
