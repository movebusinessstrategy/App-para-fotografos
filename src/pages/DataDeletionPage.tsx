import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const FotoMoveLogo = () => (
  <div className="flex items-center gap-2.5">
    <svg width="32" height="32" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 4C17 4 7 5.5 4.5 17H17V4Z" fill="#F1C665"/>
      <path d="M19 4C19 4 29 5.5 31.5 17H19V4Z" fill="#D4A94A"/>
      <path d="M17 32C17 32 7 30.5 4.5 19H17V32Z" fill="#D4A94A"/>
      <path d="M19 32C19 32 29 30.5 31.5 19H19V32Z" fill="#F1C665"/>
    </svg>
    <span className="text-xl font-extrabold tracking-tight text-white">
      Foto<span style={{ color: "#D4A94A" }}>MOVE</span>
    </span>
  </div>
);

export default function DataDeletionPage() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"all" | "whatsapp_only">("all");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; ticketId?: string; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/data-deletion/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason, scope }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          ok: true,
          ticketId: data.ticket_id,
          message: data.message || "Solicitação registrada. Você receberá confirmação por e-mail em até 15 dias úteis.",
        });
        setEmail("");
        setReason("");
      } else {
        setResult({ ok: false, message: data.error || "Não foi possível registrar a solicitação. Tente novamente." });
      }
    } catch {
      setResult({ ok: false, message: "Erro de rede. Tente novamente em alguns minutos." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}>
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <FotoMoveLogo />
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Voltar ao login
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 md:p-12 text-white/90">
          <h1 className="text-3xl font-bold text-white mb-2">Exclusão de Dados</h1>
          <p className="text-white/50 text-sm mb-8">
            Solicite a exclusão dos seus dados da CRM Trilha em conformidade com a LGPD e com a Política de Dados da Meta.
          </p>

          <div className="space-y-6 text-sm leading-relaxed text-white/80">

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">Como funciona</h2>
              <p className="mb-3">
                Você tem o direito de solicitar a exclusão completa dos seus dados ou apenas dos dados coletados via integração WhatsApp Cloud API.
                Após receber sua solicitação:
              </p>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>Confirmaremos o recebimento por e-mail em até <strong className="text-white">48 horas úteis</strong>.</li>
                <li>A exclusão é processada em até <strong className="text-white">15 dias úteis</strong>, conforme prazo da LGPD.</li>
                <li>Dados que precisam ser retidos por obrigação legal (ex: registros fiscais) serão informados e mantidos pelo prazo mínimo exigido.</li>
                <li>Você receberá um <strong className="text-white">código de confirmação</strong> ao final do processo.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">Formulário de solicitação</h2>

              {result?.ok ? (
                <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5 text-emerald-400" />
                    <div className="space-y-2">
                      <p className="font-semibold text-emerald-300">Solicitação registrada</p>
                      <p className="text-sm text-white/80">{result.message}</p>
                      {result.ticketId && (
                        <p className="text-xs text-white/60">
                          Protocolo: <span className="font-mono text-[#D4A94A]">{result.ticketId}</span>
                        </p>
                      )}
                      <button
                        onClick={() => setResult(null)}
                        className="text-xs text-emerald-300 hover:underline mt-1"
                      >
                        Fazer outra solicitação
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {result && !result.ok && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
                      <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                      <span>{result.message}</span>
                    </div>
                  )}

                  <div>
                    <label htmlFor="email" className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                      E-mail cadastrado *
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white placeholder:text-white/30 focus:border-[#D4A94A] focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-white/70 mb-2 uppercase tracking-wide">
                      Escopo da exclusão *
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20 cursor-pointer transition-colors">
                        <input
                          type="radio"
                          name="scope"
                          value="all"
                          checked={scope === "all"}
                          onChange={() => setScope("all")}
                          className="mt-0.5 accent-[#D4A94A]"
                        />
                        <div>
                          <p className="font-semibold text-white text-sm">Todos os meus dados</p>
                          <p className="text-xs text-white/60 mt-0.5">
                            Exclui conta, clientes, trabalhos, mensagens, integrações e histórico completo. <strong>Irreversível.</strong>
                          </p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20 cursor-pointer transition-colors">
                        <input
                          type="radio"
                          name="scope"
                          value="whatsapp_only"
                          checked={scope === "whatsapp_only"}
                          onChange={() => setScope("whatsapp_only")}
                          className="mt-0.5 accent-[#D4A94A]"
                        />
                        <div>
                          <p className="font-semibold text-white text-sm">Apenas dados WhatsApp</p>
                          <p className="text-xs text-white/60 mt-0.5">
                            Exclui mensagens, tokens e identificadores Meta (waba_id, phone_number_id). Sua conta CRM permanece ativa.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reason" className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide">
                      Motivo (opcional)
                    </label>
                    <textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      placeholder="Conte rapidamente o motivo da exclusão. Não é obrigatório, mas ajuda a melhorar o serviço."
                      className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white placeholder:text-white/30 focus:border-[#D4A94A] focus:outline-none transition-colors resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !email}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-[#D4A94A] hover:bg-[#c19a3e] disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-colors"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={15} className="animate-spin" /> Enviando…
                      </>
                    ) : (
                      "Enviar solicitação"
                    )}
                  </button>
                </form>
              )}
            </section>

            <section className="pt-4 border-t border-white/10">
              <h2 className="text-base font-semibold text-white mb-2">Alternativas</h2>
              <p className="text-xs text-white/60">
                Se você é cliente ativo, pode desconectar apenas a integração WhatsApp diretamente em{" "}
                <strong className="text-white">Configurações → Integrações → WhatsApp → Desconectar</strong>, sem precisar deste formulário. Para dúvidas:{" "}
                <a href="mailto:contato@movebusiness.com.br" className="text-[#D4A94A] hover:underline">
                  contato@movebusiness.com.br
                </a>
                .
              </p>
            </section>

          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/privacidade"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Ver Política de Privacidade
          </Link>
        </div>
      </div>
    </div>
  );
}
