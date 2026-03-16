import React from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle, Download, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export type ImportSummary = {
  importedClientsCount: number;
  updatedClientsCount: number;
  importedJobsCount: number;
  updatedJobsCount: number;
  errors: Array<{ row: number; message: string }>;
  totalProcessed: number;
  totalRows: number;
};

type Props = {
  open: boolean;
  total: number;
  processed: number;
  done: boolean;
  summary: ImportSummary | null;
  error: string | null;
  onClose: () => void;
};

export default function ImportProgressModal({
  open,
  total,
  processed,
  done,
  summary,
  error,
  onClose,
}: Props) {
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  
  const hasErrors = summary && summary.errors.length > 0;
  const allFailed = error !== null;
  
  const title = done
    ? allFailed
      ? "Falha na importação"
      : hasErrors
        ? "Importação concluída com alertas"
        : "Importação concluída!"
    : "Importando clientes...";

  const handleDownloadErrorReport = () => {
    if (!summary?.errors.length) return;

    const headers = ["Linha", "Erro"];
    const csvRows = [
      headers.join(";"),
      ...summary.errors.map((err) =>
        [err.row, `"${err.message.replace(/"/g, '""')}"`].join(";")
      ),
    ];

    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `erros_importacao_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 space-y-4 max-h-[90vh] overflow-hidden flex flex-col"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  done
                    ? allFailed
                      ? "bg-red-50 text-red-600"
                      : hasErrors
                        ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    : "bg-indigo-50 text-indigo-600"
                }`}
              >
                {done ? (
                  allFailed ? (
                    <XCircle size={22} />
                  ) : hasErrors ? (
                    <AlertCircle size={22} />
                  ) : (
                    <CheckCircle2 size={22} />
                  )
                ) : (
                  <Upload size={22} />
                )}
              </div>
              <div>
                <p className="text-sm text-gray-500">Importação de CSV</p>
                <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              </div>
            </div>

            {/* Progress indicator */}
            <div className="flex items-center gap-3 text-sm text-gray-600">
              {!done ? (
                <>
                  <Loader2 className="animate-spin text-indigo-600" size={18} />
                  <span>
                    Processando {Math.min(processed, total)} de {total} registros...
                  </span>
                </>
              ) : allFailed ? (
                <span className="text-red-600">Importação interrompida por erro crítico.</span>
              ) : (
                <span className="text-green-600">
                  {summary?.totalProcessed || processed} de {total} registros processados
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full ${
                    done
                      ? allFailed
                        ? "bg-red-500"
                        : hasErrors
                          ? "bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500"
                          : "bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500"
                      : "bg-gradient-to-r from-indigo-500 via-violet-500 to-blue-500"
                  }`}
                  style={{ width: `${percent}%` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ ease: "easeOut", duration: 0.25 }}
                />
              </div>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{percent}% concluído</span>
                <span>
                  {Math.min(processed, total)} / {total}
                </span>
              </div>
            </div>

            {/* Success Summary */}
            {done && summary && !allFailed && (
              <div className="rounded-xl bg-green-50 border border-green-100 p-4 text-sm text-green-800">
                <div className="flex items-center gap-2 font-semibold mb-3">
                  <CheckCircle2 size={16} />
                  Resumo da importação
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-green-700">Novos clientes:</span>
                    <span className="font-bold text-green-800">{summary.importedClientsCount}</span>
                  </div>
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-green-700">Atualizados:</span>
                    <span className="font-bold text-green-800">{summary.updatedClientsCount}</span>
                  </div>
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-green-700">Novos trabalhos:</span>
                    <span className="font-bold text-green-800">{summary.importedJobsCount}</span>
                  </div>
                  <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-green-700">Jobs atualizados:</span>
                    <span className="font-bold text-green-800">{summary.updatedJobsCount}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Errors List */}
            {done && hasErrors && (
              <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm flex flex-col max-h-48 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold text-red-800">
                    <AlertCircle size={16} />
                    {summary.errors.length} registro(s) com problema
                  </div>
                  <button
                    onClick={handleDownloadErrorReport}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-900 bg-red-100 hover:bg-red-200 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Download size={14} />
                    Baixar relatório
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
                  {summary.errors.slice(0, 10).map((err, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 bg-white/70 rounded-lg px-3 py-2 text-xs"
                    >
                      <span className="font-mono font-bold text-red-600 whitespace-nowrap">
                        Linha {err.row}:
                      </span>
                      <span className="text-red-800">{err.message}</span>
                    </div>
                  ))}
                  {summary.errors.length > 10 && (
                    <div className="text-xs text-amber-600 italic text-center py-2">
                      ... e mais {summary.errors.length - 10} erro(s). Baixe o relatório para ver todos.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Critical Error */}
            {done && allFailed && (
              <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">
                <div className="flex items-center gap-2 font-semibold">
                  <XCircle size={16} />
                  Erro crítico na importação
                </div>
                <p className="mt-2">{error}</p>
              </div>
            )}

            {/* Close Button */}
            {done && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className={`px-5 py-2.5 rounded-xl font-semibold transition-colors ${
                    allFailed
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  Fechar
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
