// Hook do editor LIVRE (estúdio): carrega o álbum, mantém spreads com
// canvas_json em estado local e faz autosave em lote (PUT /spreads).
import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "../../../utils/authFetch";
import type { AlbumDetail, AlbumSpread, SpreadKind } from "../types";

export type SaveState = "idle" | "saving" | "saved" | "error";

function sortSpreads(spreads: AlbumSpread[]): AlbumSpread[] {
  return [...spreads].sort((a, b) => a.position - b.position);
}

export function useAlbumFreeEditor(albumId: string) {
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [spreads, setSpreads] = useState<AlbumSpread[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/albums/${albumId}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as AlbumDetail;
      setDetail(data);
      setSpreads(sortSpreads(data.spreads || []));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [albumId]);

  useEffect(() => { load(); }, [load]);

  const reloadAssets = useCallback(async () => {
    try {
      const res = await authFetch(`/api/albums/${albumId}`);
      if (!res.ok) return;
      const data = (await res.json()) as AlbumDetail;
      setDetail((prev) => (prev ? { ...prev, assets: data.assets, album: data.album } : data));
    } catch { /* ignora */ }
  }, [albumId]);

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
            kind: s.kind || "spread",
            template_id: s.template_id || "livre",
            slots: s.slots || [],
            canvas_json: s.canvas_json ?? null,
          })),
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { spreads?: AlbumSpread[] };
      // Atualiza ids reais sem perder o canvas_json local (servidor pode não devolver).
      if (Array.isArray(data.spreads)) {
        setSpreads((prev) => {
          const sorted = sortSpreads(data.spreads!);
          return sorted.map((s, i) => ({
            ...s,
            canvas_json: s.canvas_json ?? prev[i]?.canvas_json ?? null,
          }));
        });
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [albumId]);

  const scheduleSave = useCallback((next: AlbumSpread[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(next), 1200);
  }, [flush]);

  // Aplica mudança nos spreads + agenda salvar.
  const applySpreads = useCallback((next: AlbumSpread[]) => {
    setSpreads(next);
    scheduleSave(next);
  }, [scheduleSave]);

  const addSpread = useCallback((kind: SpreadKind = "spread") => {
    setSpreads((prev) => {
      const next = [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          position: prev.length,
          kind,
          template_id: "livre",
          slots: [],
          canvas_json: null,
        } as AlbumSpread,
      ];
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const deleteSpread = useCallback((index: number) => {
    setSpreads((prev) => {
      const next = prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  return {
    detail, spreads, loadError, saveState,
    load, reloadAssets, applySpreads, addSpread, deleteSpread, setSpreads,
  };
}
