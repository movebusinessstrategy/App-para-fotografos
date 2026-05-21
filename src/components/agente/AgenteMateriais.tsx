import React, { useState } from "react";
import {
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useAgenteMateriais, Material } from "../../hooks/useAgenteMateriais";

// Nichos de ensaio aceitos para os materiais.
const NICHOS: { value: string; label: string }[] = [
  { value: "gestante", label: "Gestante" },
  { value: "newborn", label: "Newborn" },
  { value: "smash_the_cake", label: "Smash the Cake" },
  { value: "familia", label: "Família" },
  { value: "infantil", label: "Infantil" },
  { value: "casal", label: "Casal" },
  { value: "feminino", label: "Feminino" },
  { value: "marca_pessoal", label: "Marca Pessoal" },
  { value: "revelacao", label: "Revelação" },
  { value: "anunciacao", label: "Anunciação" },
  { value: "baby", label: "Baby" },
  { value: "batizado", label: "Batizado" },
  { value: "aniversario", label: "Aniversário" },
  { value: "cha_revelacao", label: "Chá Revelação" },
];

const nichoLabel = (v: string) =>
  NICHOS.find((n) => n.value === v)?.label || v;

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const selectCls =
  "px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500/40";

export default function AgenteMateriais() {
  const { materiais, loading, error, upload, remove } = useAgenteMateriais();
  const [nicho, setNicho] = useState("gestante");
  const [tipo, setTipo] = useState<"pacote" | "dicas">("pacote");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function doUpload(n: string, t: string, file: File) {
    setBusy(true);
    setActionError(null);
    try {
      await upload(n, t, file);
    } catch (e: any) {
      setActionError(e?.message || "Falha no envio do PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function doRemove(m: Material) {
    if (!window.confirm(`Remover o PDF "${m.nome_arquivo}"?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await remove(m.id);
    } catch (e: any) {
      setActionError(e?.message || "Falha ao remover o PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <FileText size={17} className="text-gold-600 dark:text-gold-400" />
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Materiais (PDFs)
        </h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Os PDFs de pacotes e dicas, por nicho. São salvos automaticamente ao
        enviar — não dependem do botão Salvar.
      </p>

      {/* Adicionar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={nicho}
          onChange={(e) => setNicho(e.target.value)}
          className={selectCls}
        >
          {NICHOS.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "pacote" | "dicas")}
          className={selectCls}
        >
          <option value="pacote">Pacote</option>
          <option value="dicas">Dicas</option>
        </select>
        <label
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-500 text-white text-sm font-semibold transition-colors cursor-pointer",
            busy ? "opacity-60 pointer-events-none" : "hover:bg-gold-600",
          )}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plus size={16} />
          )}
          Enviar PDF
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doUpload(nicho, tipo, f);
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
      ) : materiais.length === 0 ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
          Nenhum PDF enviado ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {materiais.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
            >
              <FileText size={20} className="text-red-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {m.nome_arquivo}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {nichoLabel(m.nicho)} ·{" "}
                  {m.tipo === "pacote" ? "Pacote" : "Dicas"}
                  {m.tamanho ? ` · ${formatBytes(m.tamanho)}` : ""}
                </div>
              </div>
              {m.url && (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Ver PDF"
                  className="p-2 rounded-lg text-gray-400 hover:text-gold-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ExternalLink size={16} />
                </a>
              )}
              <label
                title="Substituir"
                className={cn(
                  "p-2 rounded-lg text-gray-400 cursor-pointer",
                  busy
                    ? "opacity-50 pointer-events-none"
                    : "hover:text-gold-600 hover:bg-gray-100 dark:hover:bg-gray-700",
                )}
              >
                <Upload size={16} />
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) doUpload(m.nicho, m.tipo, f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={() => doRemove(m)}
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
