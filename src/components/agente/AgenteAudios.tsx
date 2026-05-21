import React, { useState } from "react";
import { Loader2, Mic, Plus, Trash2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useAgenteAudios, Audio } from "../../hooks/useAgenteAudios";

function formatDuration(s: number | null): string {
  if (!s || s < 1) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function AgenteAudios() {
  const { audios, loading, error, upload, remove } = useAgenteAudios();
  const [titulo, setTitulo] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function doUpload(file: File) {
    const nome = titulo.trim();
    if (!nome) {
      setActionError("Dê um nome ao áudio antes de enviar.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await upload(nome, file);
      setTitulo("");
    } catch (e: any) {
      setActionError(e?.message || "Falha no envio do áudio.");
    } finally {
      setBusy(false);
    }
  }

  async function doRemove(a: Audio) {
    if (!window.confirm(`Remover o áudio "${a.titulo}"?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await remove(a.id);
    } catch (e: any) {
      setActionError(e?.message || "Falha ao remover o áudio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <Mic size={17} className="text-gold-600 dark:text-gold-400" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Áudios prontos</h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Respostas em áudio que você grava e deixa salvas aqui. O envio pelo
        WhatsApp será ligado quando a conexão estiver configurada.
      </p>

      {/* Adicionar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Nome do áudio (ex.: Saudação)"
          className="flex-1 min-w-[180px] px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500/40"
        />
        <label
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-500 text-white text-sm font-semibold cursor-pointer transition-colors",
            busy ? "opacity-60 pointer-events-none" : "hover:bg-gold-600",
          )}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plus size={16} />
          )}
          Enviar áudio
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {(actionError || error) && (
        <div className="text-sm text-red-600 dark:text-red-400 mb-3">
          {actionError || error}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-6 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : audios.length === 0 ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
          Nenhum áudio enviado ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {audios.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {a.titulo}
                  {a.duracao ? (
                    <span className="text-gray-400 font-normal">
                      {" "}
                      · {formatDuration(a.duracao)}
                    </span>
                  ) : null}
                </div>
                {a.url && (
                  <audio
                    controls
                    preload="none"
                    src={a.url}
                    className="mt-1.5 w-full max-w-[240px]"
                  />
                )}
              </div>
              <button
                onClick={() => doRemove(a)}
                disabled={busy}
                title="Remover"
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
