import React, { useEffect, useState } from "react";
import { X, Phone, Loader2, CheckCircle2, AlertCircle, Building2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

interface Number {
  phone_number_id: string;
  display_phone_number: string;
  verified_name: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
  is_active: boolean;
}

interface Waba {
  waba_id: string;
  waba_name: string | null;
  numbers: Number[];
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

// Modal pra escolher qual número da WhatsApp Business Account (WABA) usar.
// Resolve o caso comum: Embedded Signup retorna múltiplos números (Test
// Number + reais), backend pegou só o primeiro, user quer outro.
//
// O token salvo já tem permissão pra todos os números autorizados — não
// precisa reconectar nem voltar pro Facebook.
export function PhoneNumberPicker({ open, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wabas, setWabas] = useState<Waba[]>([]);
  const [selecting, setSelecting] = useState<string | null>(null);

  // Parser seguro de respostas: o vercel.json reescreve /api/* pra Render,
  // mas no cold start (Render free tier dormindo) pode voltar HTML do
  // próprio Vercel em vez de JSON. Tratamos isso em vez de explodir.
  const safeJson = async (r: Response): Promise<any> => {
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      // Detecta caso clássico: HTML voltando em vez de JSON
      if (text.trim().startsWith("<")) {
        throw new Error(
          "Servidor demorou a responder (cold start). Aguarde 30s e tente de novo.",
        );
      }
      throw new Error("Resposta inválida do servidor.");
    }
  };

  const fetchNumbers = async (attempt = 1) => {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch("/api/meta/whatsapp/available-numbers");
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data?.error || "Erro ao listar números");
      setWabas(data.wabas || []);
    } catch (e: any) {
      // Cold start? retry uma vez com delay (Render acorda em ~30s)
      const isCold = (e?.message || "").includes("cold start") || (e?.message || "").includes("Failed to fetch");
      if (isCold && attempt === 1) {
        setError("Acordando servidor… (tenta de novo em 5s)");
        setTimeout(() => fetchNumbers(2), 5000);
        return;
      }
      setError(e?.message || "Erro ao listar números");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    fetchNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelect = async (waba_id: string, n: Number) => {
    if (n.is_active) return;
    if (!confirm(`Trocar pro número ${n.display_phone_number} (${n.verified_name || "sem nome"})?`)) return;
    setSelecting(n.phone_number_id);
    setError(null);
    try {
      const res = await authFetch("/api/meta/whatsapp/select-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waba_id, phone_number_id: n.phone_number_id }),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setError(data?.error || "Erro ao trocar número");
        return;
      }
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Erro ao trocar número");
    } finally {
      setSelecting(null);
    }
  };

  if (!open) return null;

  const totalNumbers = wabas.reduce((s, w) => s + w.numbers.length, 0);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col bg-white dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <Phone size={20} className="text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Trocar número conectado
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Escolha entre os números que você autorizou no Facebook
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

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => fetchNumbers()}
                className="w-full py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Tentar de novo
              </button>
            </div>
          ) : totalNumbers === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400">
              <p className="font-semibold mb-1">Nenhum número adicional disponível</p>
              <p className="text-xs">
                O token atual só tem acesso a 1 número. Pra adicionar outros,
                vincule-os na sua WhatsApp Business Account em business.facebook.com
                e reconecte aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {wabas.map(waba => (
                <div key={waba.waba_id}>
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 size={13} className="text-gray-400" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {waba.waba_name || "WABA sem nome"}
                    </p>
                    <span className="text-[10px] text-gray-400 font-mono">{waba.waba_id}</span>
                  </div>
                  {waba.error ? (
                    <p className="text-xs text-rose-500 pl-5">⚠️ {waba.error}</p>
                  ) : waba.numbers.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-5">Sem números nesta WABA.</p>
                  ) : (
                    <div className="space-y-1.5 pl-5">
                      {waba.numbers.map(n => {
                        const isSelectingThis = selecting === n.phone_number_id;
                        return (
                          <button
                            key={n.phone_number_id}
                            onClick={() => handleSelect(waba.waba_id, n)}
                            disabled={n.is_active || !!selecting}
                            className={
                              "w-full text-left p-3 rounded-xl border transition-all disabled:cursor-default " +
                              (n.is_active
                                ? "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10"
                                : "border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5")
                            }
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm text-gray-900 dark:text-white">
                                  {n.display_phone_number}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {n.verified_name || "Sem nome verificado"}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  {n.quality_rating && (
                                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                                      Qualidade: {n.quality_rating.toLowerCase()}
                                    </span>
                                  )}
                                  {n.code_verification_status && (
                                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                                      {n.code_verification_status.toLowerCase()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex-shrink-0">
                                {n.is_active ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 size={13} /> Em uso
                                  </span>
                                ) : isSelectingThis ? (
                                  <Loader2 size={14} className="animate-spin text-gray-400" />
                                ) : (
                                  <span className="text-xs text-gold-600 dark:text-gold-400 font-medium">
                                    Usar este →
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-amber-50 dark:bg-amber-500/10 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Trocar o número desativa o anterior (mas não deleta) e re-registra o
            novo na Cloud API. Funciona sem 2FA ativada no WhatsApp do número.
          </span>
        </div>
      </div>
    </div>
  );
}
