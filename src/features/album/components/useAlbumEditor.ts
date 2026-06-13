import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "../../../utils/authFetch";
import { slotCount, templateById } from "../templates";
import type { AlbumAsset, AlbumDetail, AlbumSpread, SlotFill } from "../types";

export type SaveState = "idle" | "saving" | "saved" | "error";

// Garante que slots tenha exatamente slotCount(template) posições.
function normalizeSlots(templateId: string, slots: SlotFill[]): SlotFill[] {
  const n = slotCount(templateId) || 0;
  const out: SlotFill[] = [];
  for (let i = 0; i < n; i++) out.push(slots[i] || { asset_id: null });
  return out;
}

// Hook do editor: detalhe carregado, estado local de spreads, autosave (~1s).
export function useAlbumEditor(albumId: string) {
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [spreads, setSpreads] = useState<AlbumSpread[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // Carrega o álbum completo.
  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/albums/${albumId}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as AlbumDetail;
      setDetail(data);
      setSpreads(
        [...data.spreads]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ ...s, slots: normalizeSlots(s.template_id, s.slots || []) })),
      );
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [albumId]);

  useEffect(() => { load(); }, [load]);

  // Recarrega só os assets (após upload / import / delete), preservando spreads.
  const reloadAssets = useCallback(async () => {
    try {
      const res = await authFetch(`/api/albums/${albumId}`);
      if (!res.ok) return;
      const data = (await res.json()) as AlbumDetail;
      setDetail((prev) => (prev ? { ...prev, assets: data.assets, album: data.album } : data));
    } catch { /* ignora */ }
  }, [albumId]);

  // Salva os spreads atuais no servidor (lote).
  const flush = useCallback(async (next: AlbumSpread[]) => {
    setSaveState("saving");
    try {
      const res = await authFetch(`/api/albums/${albumId}/spreads`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreads: next.map((s, i) => ({
            id: s.id?.startsWith("tmp-") ? undefined : s.id,
            position: i,
            template_id: s.template_id,
            slots: s.slots,
          })),
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { spreads?: AlbumSpread[] };
      // O servidor devolve ids reais (importante pros temporários criados local).
      if (Array.isArray(data.spreads)) {
        setSpreads(
          [...data.spreads]
            .sort((a, b) => a.position - b.position)
            .map((s) => ({ ...s, slots: normalizeSlots(s.template_id, s.slots || []) })),
        );
      }
      dirtyRef.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [albumId]);

  // Agenda autosave com debounce de 1s. Usa a lista mais recente.
  const scheduleSave = useCallback((next: AlbumSpread[]) => {
    dirtyRef.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(next), 1000);
  }, [flush]);

  // Aplica uma mudança nos spreads + agenda salvar.
  const updateSpreads = useCallback((updater: (prev: AlbumSpread[]) => AlbumSpread[]) => {
    setSpreads((prev) => {
      const next = updater(prev);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  // Helpers de manipulação ---------------------------------------------------

  const setTemplate = useCallback((index: number, templateId: string) => {
    if (!templateById(templateId)) return;
    updateSpreads((prev) => prev.map((s, i) =>
      i === index ? { ...s, template_id: templateId, slots: normalizeSlots(templateId, s.slots) } : s,
    ));
  }, [updateSpreads]);

  const setSlotAsset = useCallback((index: number, slotIndex: number, assetId: string | null) => {
    updateSpreads((prev) => prev.map((s, i) => {
      if (i !== index) return s;
      const slots = s.slots.slice();
      slots[slotIndex] = { ...(slots[slotIndex] || {}), asset_id: assetId };
      return { ...s, slots };
    }));
  }, [updateSpreads]);

  // Troca o conteúdo de dois slots da mesma lâmina.
  const swapSlots = useCallback((index: number, a: number, b: number) => {
    updateSpreads((prev) => prev.map((s, i) => {
      if (i !== index) return s;
      const slots = s.slots.slice();
      const tmp = slots[a];
      slots[a] = slots[b];
      slots[b] = tmp;
      return { ...s, slots };
    }));
  }, [updateSpreads]);

  const addSpread = useCallback(() => {
    updateSpreads((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        position: prev.length,
        template_id: "classico",
        slots: normalizeSlots("classico", []),
      },
    ]);
  }, [updateSpreads]);

  const deleteSpread = useCallback((index: number) => {
    updateSpreads((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i })));
  }, [updateSpreads]);

  const reorderSpreads = useCallback((next: AlbumSpread[]) => {
    updateSpreads(() => next.map((s, i) => ({ ...s, position: i })));
  }, [updateSpreads]);

  // Auto-preencher: distribui todas as fotos da bandeja nos slots em ordem.
  const autoFill = useCallback((assets: AlbumAsset[]) => {
    const ordered = [...assets].sort((a, b) => a.sort_order - b.sort_order);
    let cursor = 0;
    updateSpreads((prev) => prev.map((s) => {
      const slots = s.slots.map((slot) => {
        const next = ordered[cursor];
        cursor += 1;
        return { ...slot, asset_id: next ? next.id : null };
      });
      return { ...s, slots };
    }));
  }, [updateSpreads]);

  return {
    detail, spreads, loadError, saveState,
    reloadAssets, load,
    setTemplate, setSlotAsset, swapSlots,
    addSpread, deleteSpread, reorderSpreads, autoFill,
  };
}
