import type { AlbumSpread, SlotFill } from "../album/types";
import { slotCount, templateById } from "../album/templates";

// Lógica pura de manipulação das lâminas — sem React, fácil de testar e mantém
// a complexidade dos componentes baixa.

// Garante que o array de slots tenha exatamente o tamanho do template.
function ajustarSlots(slots: SlotFill[], total: number): SlotFill[] {
  const out: SlotFill[] = [];
  for (let i = 0; i < total; i++) {
    out.push(slots[i] ?? { asset_id: null });
  }
  return out;
}

// Normaliza todas as lâminas para o tamanho do seu template (defensivo contra
// dados antigos ou template trocado no estúdio).
export function normalizarSpreads(spreads: AlbumSpread[]): AlbumSpread[] {
  return spreads.map((s) => ({
    ...s,
    slots: ajustarSlots(Array.isArray(s.slots) ? s.slots : [], slotCount(s.template_id)),
  }));
}

// Coloca um asset num slot específico de uma lâmina.
export function colocarFoto(
  spreads: AlbumSpread[],
  spreadIndex: number,
  slot: number,
  assetId: string,
): AlbumSpread[] {
  return spreads.map((s, i) => {
    if (i !== spreadIndex) return s;
    const slots = s.slots.slice();
    if (slot < 0 || slot >= slots.length) return s;
    slots[slot] = { ...slots[slot], asset_id: assetId };
    return { ...s, slots };
  });
}

// Esvazia um slot (remove a foto).
export function limparFoto(
  spreads: AlbumSpread[],
  spreadIndex: number,
  slot: number,
): AlbumSpread[] {
  return spreads.map((s, i) => {
    if (i !== spreadIndex) return s;
    const slots = s.slots.slice();
    if (slot < 0 || slot >= slots.length) return s;
    slots[slot] = { asset_id: null };
    return { ...s, slots };
  });
}

// Troca o template de uma lâmina, preservando as fotos que cabem no novo layout.
export function trocarTemplate(
  spreads: AlbumSpread[],
  spreadIndex: number,
  templateId: string,
): AlbumSpread[] {
  if (!templateById(templateId)) return spreads;
  const total = slotCount(templateId);
  return spreads.map((s, i) =>
    i === spreadIndex
      ? { ...s, template_id: templateId, slots: ajustarSlots(s.slots, total) }
      : s,
  );
}

// Conjunto dos asset_ids usados em qualquer lâmina (pra marcar a bandeja).
export function assetsUsados(spreads: AlbumSpread[]): Set<string> {
  const set = new Set<string>();
  spreads.forEach((s) =>
    s.slots.forEach((slot) => {
      if (slot?.asset_id) set.add(slot.asset_id);
    }),
  );
  return set;
}

// Payload do autosave: shape esperado pelo PUT /api/public/album/:token/spreads.
export function payloadSpreads(spreads: AlbumSpread[]) {
  return spreads.map((s) => ({
    id: s.id,
    position: s.position,
    template_id: s.template_id,
    slots: s.slots,
  }));
}

// Lê "slot:<spreadIndex>:<slot>" (id do droppable) → { spreadIndex, slot }.
export function parseSlotId(id: string): { spreadIndex: number; slot: number } | null {
  const m = /^slot:(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { spreadIndex: Number(m[1]), slot: Number(m[2]) };
}

// Lê "asset:<id>" (id do draggable) → assetId.
export function parseAssetId(id: string): string | null {
  return id.startsWith("asset:") ? id.slice("asset:".length) : null;
}
