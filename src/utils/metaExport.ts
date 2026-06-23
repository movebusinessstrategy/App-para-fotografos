// Exportação de contatos no formato que o Meta (Facebook/Instagram) Ads aceita.
// IMPORTANTE: o Meta hasheia os dados no momento do upload pelo Gerenciador de
// Anúncios — então enviamos TEXTO PURO (e-mail/telefone normalizados, sem hash).
// São dois formatos:
//   1. Lista de clientes  → Público Personalizado / Semelhante (Lookalike) / Exclusão
//   2. Eventos offline    → Conversões offline (Purchase com valor)

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
  eventName?: string; // default "Purchase"
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
export function buildMetaOfflineEventsCSV(events: MetaOfflineEvent[]): string {
  const headers = ["email", "phone", "fn", "ln", "event_name", "event_time", "value", "currency"];
  const rows: string[][] = [];
  for (const e of events) {
    const phone = phoneToE164(e.phone);
    const email = (e.email || "").trim().toLowerCase();
    if (!phone && !email) continue;
    const { fn, ln } = splitName(e.name);
    rows.push([
      email,
      phone,
      fn.toLowerCase(),
      ln.toLowerCase(),
      e.eventName || "Purchase",
      isoDate(e.eventTime),
      e.value != null ? String(e.value) : "",
      CURRENCY,
    ]);
  }
  return toCSV(headers, rows);
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
