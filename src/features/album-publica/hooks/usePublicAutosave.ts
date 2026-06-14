import { useCallback, useEffect, useRef, useState } from "react";
import { publicPut } from "../api";
import type { AlbumSpread } from "../../album/types";

export type EstadoSalvamento = "ocioso" | "salvando" | "salvo" | "erro";

// Autosave debounced das lâminas do editor LIVRE no PUT público.
// Envia canvas_json de cada página. Só roda se podeEditar.
export function usePublicAutosave(token: string | undefined, podeEditar: boolean) {
  const [estado, setEstado] = useState<EstadoSalvamento>("ocioso");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendenteRef = useRef<AlbumSpread[] | null>(null);

  const enviar = useCallback(async () => {
    if (!token) return;
    const spreads = pendenteRef.current;
    if (!spreads) return;
    pendenteRef.current = null;
    setEstado("salvando");
    try {
      await publicPut(`/api/public/album/${token}/spreads`, {
        spreads: spreads.map((s, i) => ({
          id: s.id?.startsWith("tmp-") ? undefined : s.id,
          position: i,
          kind: s.kind || "spread",
          template_id: s.template_id || "livre",
          slots: s.slots || [],
          canvas_json: s.canvas_json ?? null,
        })),
      }, token);
      setEstado("salvo");
    } catch {
      setEstado("erro");
    }
  }, [token]);

  const agendar = useCallback(
    (spreads: AlbumSpread[]) => {
      if (!token || !podeEditar) return;
      pendenteRef.current = spreads;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(enviar, 1200);
    },
    [token, podeEditar, enviar],
  );

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { estado, agendar };
}
