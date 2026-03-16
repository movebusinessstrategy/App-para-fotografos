import React from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type ImportSummary = {
  importedClientsCount: number;
  updatedClientsCount: number;
  importedJobsCount: number;
  updatedJobsCount: number;
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
  const title = done
    ? error
      ? "Falha na importação"
      : "Importação concluída!"
    : "Importando clientes...";

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
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 space-y-4"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                {done ? (
                  error ? (
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

            <div className="flex items-center gap-3 text-sm text-gray-600">
              {!done ? (
                <>
                  <Loader2 className="animate-spin text-indigo-600" size={18} />
                  <span>
                    Processando {Math.min(processed, total)} de {total} clientes...
                  </span>
                </>
              ) : error ? (
                <span>Importação interrompida.</span>
              ) : (
                <span>Importação concluída!</span>
              )}
            </div>

            <div className="space-y-2">
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-blue-500"
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

            {done && summary && !error && (
              <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={16} />
                  Importação concluída!
                </div>
                <ul className="mt-2 space-y-1">
                  <li>Novos clientes: {summary.importedClientsCount}</li>
                  <li>Clientes atualizados: {summary.updatedClientsCount}</li>
                  <li>Novos trabalhos: {summary.importedJobsCount}</li>
                  <li>Trabalhos atualizados: {summary.updatedJobsCount}</li>
                </ul>
              </div>
            )}

            {done && error && (
              <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle size={16} />
                  Erro na importação
                </div>
                <p className="mt-2">{error}</p>
              </div>
            )}

            {done && (
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
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
