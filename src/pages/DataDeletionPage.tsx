import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const TrilhaLogo = () => <img src="/logo-dark.png" alt="CRM Trilha" className="h-8 w-auto" />;

export default function DataDeletionPage() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"all" | "whatsapp_only" | "google_ads_only">("all");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; ticketId?: string; message: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
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
          message: data.message || "Solicitação registrada. Guarde o protocolo para identificar o pedido.",
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
          <TrilhaLogo />
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
            Solicite a exclusão dos seus dados da CRM Trilha em conformidade com a LGPD e com as políticas de dados aplicáveis às integrações Meta e Google.
          </p>

          <div className="space-y-6 text-sm leading-relaxed text-white/80">

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">Como funciona</h2>
              <p className="mb-3">
                Você tem o direito de solicitar a exclusão completa dos seus dados ou somente dos dados de uma integração disponível. A exclusão completa inclui credenciais de integração, métricas Google Ads sincronizadas, identificadores de clique e vínculos de atribuição associados ao seu tenant.
                Após receber sua solicitação:
              </p>
              <ul className="list-disc list-inside space-y-1.5 pl-2">
                <li>O sistema registra o pedido como <strong className="text-white">pendente</strong> e apresenta um protocolo imediatamente.</li>
                <li>O envio do formulário não apaga dados automaticamente; a equipe responsável analisa o escopo e a identidade do solicitante.</li>
                <li>Dados que precisam ser retidos por obrigação legal (ex: registros fiscais) serão informados e mantidos pelo prazo mínimo exigido.</li>
                <li>Guarde o protocolo para identificar a solicitação em qualquer contato com a equipe responsável.</li>
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
                            Solicita a exclusão de conta, clientes, trabalhos, mensagens, integrações, métricas de anúncios, identificadores de clique, atribuições e histórico completo. Depois de processada, a exclusão é <strong>irreversível.</strong>
                          </p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20 cursor-pointer transition-colors">
                        <input
                          type="radio"
                          name="scope"
                          value="google_ads_only"
                          checked={scope === "google_ads_only"}
                          onChange={() => setScope("google_ads_only")}
                          className="mt-0.5 accent-[#D4A94A]"
                        />
                        <div>
                          <p className="font-semibold text-white text-sm">Apenas dados Google Ads</p>
                          <p className="text-xs text-white/60 mt-0.5">
                            Solicita a exclusão de métricas sincronizadas, identificadores de clique e vínculos de atribuição. Sua conta CRM permanece ativa.
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
                            Solicita a exclusão de mensagens, tokens e identificadores Meta (waba_id, phone_number_id). Sua conta CRM permanece ativa.
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
                      maxLength={1000}
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
                Se você é cliente ativo, pode desconectar WhatsApp ou Google Agenda em{" "}
                <strong className="text-white">Configurações → Integrações → integração desejada → Desconectar</strong>, sem precisar deste formulário. Para Google Ads, solicite a desvinculação à equipe da plataforma. Você também pode remover o acesso diretamente na Meta ou no Google. Para dúvidas:{" "}
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
