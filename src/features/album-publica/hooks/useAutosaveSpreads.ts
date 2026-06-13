import { useCallback, useEffect, useRef, useState } from "react";
import { publicPut } from "../api";
import type { AlbumSpread } from "../../album/types";
import { payloadSpreads } from "../spreads";

export type EstadoSalvamento = "ocioso" | "salvando" | "salvo" | "erro";

// Autosave debounced das lâminas no PUT /api/public/album/:token/spreads.
// Agenda o salvamento ~800ms após a última alteração; só roda se podeEditar.
export function useAutosaveSpreads(token: string | undefined, podeEditar: boolean) {
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
        spreads: payloadSpreads(spreads),
      });
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
      timerRef.current = setTimeout(enviar, 800);
    },
    [token, podeEditar, enviar],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { estado, agendar };
}
