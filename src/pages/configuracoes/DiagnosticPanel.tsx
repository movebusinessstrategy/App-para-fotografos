import React, { useEffect, useState } from "react";
import {
  X,
  Stethoscope,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
  fix_hint?: string;
}

interface DiagnoseResponse {
  checks: Check[];
  meta_panel_reminder?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Modal de diagnóstico da integração WhatsApp/Meta. Roda uma bateria de checks
// no backend (token válido, webhook subscrito, número ativo, etc.) e mostra
// uma checklist visual com dicas de correção pra cada falha.
export function DiagnosticPanel({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DiagnoseResponse | null>(null);

  // Mesmo parser do PhoneNumberPicker: vercel.json reescreve /api/* pro Render,
  // que no cold start (free tier dormindo) pode devolver HTML do Vercel em vez
  // de JSON. Tratamos em vez de explodir o JSON.parse.
  const safeJson = async (r: Response): Promise<any> => {
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      if (text.trim().startsWith("<")) {
        throw new Error(
          "Servidor demorou a responder (cold start). Aguarde 30s e tente de novo.",
        );
      }
      throw new Error("Resposta inválida do servidor.");
    }
  };

  const runDiagnose = async (attempt = 1) => {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch("/api/meta/whatsapp/diagnose", {
        method: "POST",
      });
      const json = await safeJson(r);
      if (!r.ok) throw new Error(json?.error || "Erro ao executar diagnóstico");
      setData(json);
    } catch (e: any) {
      const isCold =
        (e?.message || "").includes("cold start") ||
        (e?.message || "").includes("Failed to fetch");
      if (isCold && attempt === 1) {
        setError("Acordando servidor… (tenta de novo em 5s)");
        setTimeout(() => runDiagnose(2), 5000);
        return;
      }
      setError(e?.message || "Erro ao executar diagnóstico");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setData(null);
    runDiagnose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const totalOk = data?.checks?.filter(c => c.ok).length || 0;
  const totalChecks = data?.checks?.length || 0;
  const allGood = data && totalChecks > 0 && totalOk === totalChecks;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col bg-white dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <Stethoscope size={20} className="text-purple-600 dark:text-purple-400" />
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Diagnóstico da integração
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Checagem completa da conexão com o Meta/WhatsApp
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 size={20} className="animate-spin text-gray-400" />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Rodando checagens…
              </p>
            </div>
          ) : error ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => runDiagnose()}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <RefreshCw size={14} />
                Tentar de novo
              </button>
            </div>
          ) : data && data.checks && data.checks.length > 0 ? (
            <div className="space-y-3">
              {/* Resumo no topo */}
              <div
                className={
                  "flex items-center gap-2 p-3 rounded-xl text-sm border " +
                  (allGood
                    ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200")
                }
              >
                {allGood ? (
                  <CheckCircle2 size={15} className="flex-shrink-0" />
                ) : (
                  <AlertCircle size={15} className="flex-shrink-0" />
                )}
                <span className="font-semibold">
                  {totalOk} de {totalChecks} checagens passaram
                  {allGood ? " — tudo certo!" : ""}
                </span>
              </div>

              {/* Lista de checks */}
              <ul className="space-y-2">
                {data.checks.map((c, idx) => (
                  <li
                    key={idx}
                    className={
                      "rounded-2xl border " +
                      (c.ok
                        ? "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/5"
                        : "border-rose-200 dark:border-rose-500/20 bg-rose-50/40 dark:bg-rose-500/5")
                    }
                  >
                    <div className="flex items-start gap-2.5 p-3">
                      {c.ok ? (
                        <CheckCircle2
                          size={18}
                          className="flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400"
                        />
                      ) : (
                        <XCircle
                          size={18}
                          className="flex-shrink-0 mt-0.5 text-rose-600 dark:text-rose-400"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {c.label}
                        </p>
                        {c.detail && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {c.detail}
                          </p>
                        )}
                      </div>
                    </div>
                    {!c.ok && c.fix_hint && (
                      <div className="mx-3 mb-3 flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200">
                        <Lightbulb size={14} className="flex-shrink-0 mt-0.5" />
                        <p className="text-xs leading-relaxed">
                          <span className="font-semibold">Como resolver: </span>
                          {c.fix_hint}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {/* Botão de re-executar */}
              <button
                onClick={() => runDiagnose()}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <RefreshCw size={14} />
                Tentar de novo
              </button>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
              Nenhuma checagem retornada pelo servidor.
            </div>
          )}
        </div>

        {/* Banner final com lembrete do painel do Meta */}
        {data?.meta_panel_reminder && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-500/10 text-[11px] text-blue-800 dark:text-blue-200 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{data.meta_panel_reminder}</span>
          </div>
        )}
      </div>
    </div>
  );
}
