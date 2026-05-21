import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../utils/authFetch";

export interface Material {
  id: string;
  nicho: string;
  tipo: "pacote" | "dicas";
  nome_arquivo: string;
  path: string;
  tamanho: number | null;
  url: string | null;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

// Leitura/escrita dos materiais (PDFs) do agente no Supabase, via API.
export function useAgenteMateriais() {
  const [materiais, setMateriais] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/agent/materiais");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMateriais(Array.isArray(data.materiais) ? data.materiais : []);
      } else {
        setError(data.error || "Erro ao carregar os materiais.");
      }
    } catch {
      setError("Erro de conexão ao carregar os materiais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Envia (ou substitui) o PDF de um nicho+tipo. Lança erro em caso de falha.
  const upload = useCallback(
    async (nicho: string, tipo: string, file: File) => {
      if (file.type !== "application/pdf") {
        throw new Error("O arquivo precisa ser um PDF.");
      }
      const dataUrl = await fileToDataUrl(file);
      const res = await authFetch("/api/agent/materiais", {
        method: "POST",
        body: JSON.stringify({ nicho, tipo, nome_arquivo: file.name, dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha no envio do PDF.");
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await authFetch(`/api/agent/materiais/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao remover o PDF.");
      }
      await reload();
    },
    [reload],
  );

  return { materiais, loading, error, reload, upload, remove };
}
