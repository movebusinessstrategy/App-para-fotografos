import { parseDate } from "../../utils/date";
import { Gallery, GalleryStatus } from "./types";

export const GALLERY_COLUMNS: { id: GalleryStatus; label: string }[] = [
  { id: "draft", label: "Preparando" },
  { id: "sent", label: "Enviada" },
  { id: "selected", label: "Seleção feita" },
  { id: "delivered", label: "Finalizada" },
];

export function formatBRL(v: number | null | undefined): string {
  const n = v || 0;
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
}

export function formatDateBR(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

// Link público da galeria (mesma base do app; APP_PUBLIC_URL só vale no server).
export function publicGalleryLink(shareToken: string): string {
  return `${window.location.origin}/g/${shareToken}`;
}

function sentSummary(g: Gallery): string {
  const prazo = g.selection_deadline ? ` · prazo ${formatDateBR(g.selection_deadline)}` : "";
  return `aberta ${g.view_count || 0}x${prazo}`;
}

function selectedSummary(g: Gallery): string {
  const pendente = g.pending_amount || 0;
  const pago = g.paid_amount || 0;
  let pagamento = "sem extras";
  if (pendente > 0) pagamento = `${formatBRL(pendente)} pendente`;
  else if (pago > 0) pagamento = `${formatBRL(pago)} pago`;
  return `${g.selected_count || 0} escolhidas · ${g.extra_count || 0} extras · ${pagamento}`;
}

// Linha-resumo do card do kanban, conforme o status da galeria.
export function gallerySummary(g: Gallery): string {
  if (g.status === "draft") return `${g.photo_count || 0} foto${g.photo_count === 1 ? "" : "s"}`;
  if (g.status === "sent") return sentSummary(g);
  if (g.status === "selected") return selectedSummary(g);
  return `Pago ${formatBRL(g.paid_amount)}`;
}
