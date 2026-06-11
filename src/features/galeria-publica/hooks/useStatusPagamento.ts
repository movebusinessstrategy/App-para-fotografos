import { useEffect, useState } from "react";
import { publicGet } from "../api";
import type { RespostaPaymentStatus } from "../types";

// Polling leve (5s) do GET /api/public/gallery/:token/payment-status.
// Para sozinho quando o status vira 'paid'.
export function useStatusPagamento(token: string | undefined, ativo: boolean) {
  const [status, setStatus] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !ativo) return;
    let parado = false;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    const consultar = async () => {
      try {
        const dados = await publicGet<RespostaPaymentStatus>(
          `/api/public/gallery/${token}/payment-status`
        );
        if (parado) return;
        setStatus(dados.status ?? null);
        if (dados.payment_url) setUrl(dados.payment_url);
        if (dados.status === "paid" && intervalo) clearInterval(intervalo);
      } catch {
        // erro transitório — tenta de novo no próximo ciclo
      }
    };

    consultar();
    intervalo = setInterval(consultar, 5000);
    return () => {
      parado = true;
      if (intervalo) clearInterval(intervalo);
    };
  }, [token, ativo]);

  return { status, url };
}
