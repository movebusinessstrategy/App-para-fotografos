import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../utils/authFetch";

export interface Audio {
  id: string;
  titulo: string;
  path: string;
  duracao: number | null;
  tamanho: number | null;
  mimetype: string | null;
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

// Lê a duração do áudio no navegador, sem precisar processar no servidor.
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      URL.revokeObjectURL(audio.src);
      resolve(d);
    };
    audio.onerror = () => resolve(0);
    audio.src = URL.createObjectURL(file);
  });
}

// Leitura/escrita dos áudios do agente no Supabase, via API.
export function useAgenteAudios() {
  const [audios, setAudios] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/agent/audios");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAudios(Array.isArray(data.audios) ? data.audios : []);
      } else {
        setError(data.error || "Erro ao carregar os áudios.");
      }
    } catch {
      setError("Erro de conexão ao carregar os áudios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const upload = useCallback(
    async (titulo: string, file: File) => {
      if (!file.type.startsWith("audio/")) {
        throw new Error("O arquivo precisa ser um áudio.");
      }
      const [dataUrl, duracao] = await Promise.all([
        fileToDataUrl(file),
        readDuration(file),
      ]);
      const res = await authFetch("/api/agent/audios", {
        method: "POST",
        body: JSON.stringify({
          titulo: titulo.trim(),
          mimetype: file.type,
          duracao,
          dataUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha no envio do áudio.");
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await authFetch(`/api/agent/audios/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao remover o áudio.");
      }
      await reload();
    },
    [reload],
  );

  return { audios, loading, error, reload, upload, remove };
}
