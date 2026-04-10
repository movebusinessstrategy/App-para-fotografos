import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

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

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
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

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 md:p-12 text-white/90">
          <h1 className="text-3xl font-bold text-white mb-2">Termos de Serviço</h1>
          <p className="text-white/50 text-sm mb-10">Última atualização: 10 de abril de 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-white/80">

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">1. Aceitação dos Termos</h2>
              <p>
                Ao criar uma conta ou utilizar a plataforma <strong className="text-white">FotoMOVE</strong>, você concorda com estes Termos de Serviço. Caso não concorde com algum dos termos, não utilize o serviço. Estes termos constituem um contrato vinculante entre você e a FotoMOVE.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">2. Descrição do Serviço</h2>
              <p>
                A FotoMOVE é uma plataforma de CRM (Customer Relationship Management) desenvolvida para fotógrafos e estúdios fotográficos. O serviço oferece funcionalidades de gestão de clientes, controle de trabalhos, funil de vendas, agenda, controle financeiro, produção e automações de comunicação.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">3. Cadastro e Conta</h2>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Você deve fornecer informações verdadeiras, precisas e completas durante o cadastro.</li>
                <li>Você é responsável por manter a confidencialidade de suas credenciais de acesso.</li>
                <li>Você é responsável por todas as atividades realizadas em sua conta.</li>
                <li>Notifique-nos imediatamente em caso de uso não autorizado da sua conta.</li>
                <li>Uma conta pode ter múltiplos usuários membros, com permissões configuráveis pelo titular.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">4. Uso Permitido</h2>
              <p className="mb-3">Você concorda em usar a FotoMOVE apenas para fins legítimos e de acordo com estes termos. É proibido:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Usar o serviço para atividades ilegais ou fraudulentas.</li>
                <li>Tentar acessar sistemas ou dados de outros usuários sem autorização.</li>
                <li>Realizar engenharia reversa, descompilar ou tentar extrair o código-fonte da plataforma.</li>
                <li>Sobrecarregar ou interromper os servidores da plataforma.</li>
                <li>Enviar comunicações não solicitadas (spam) através das integrações de mensagens.</li>
                <li>Usar a plataforma para violar as políticas de uso do WhatsApp Business ou Meta.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibent text-white mb-3">5. Dados e Propriedade</h2>
              <p>
                Os dados inseridos por você na plataforma (clientes, trabalhos, negociações, etc.) são de sua propriedade. A FotoMOVE não reivindica propriedade sobre seu conteúdo. Ao usar o serviço, você nos concede uma licença limitada para armazenar e processar esses dados com o único objetivo de fornecer o serviço a você.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">6. Integrações de Terceiros</h2>
              <p className="mb-3">
                A FotoMOVE pode integrar com serviços de terceiros, incluindo WhatsApp Business (Meta). Ao usar essas integrações:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Você concorda com os termos de serviço e políticas do respectivo terceiro.</li>
                <li>Você é responsável pelo uso adequado dessas integrações e pelo conteúdo das mensagens enviadas.</li>
                <li>A FotoMOVE não se responsabiliza por suspensões ou penalidades aplicadas por plataformas de terceiros devido ao uso inadequado.</li>
                <li>Mensagens via WhatsApp devem seguir as políticas de negócios da Meta, incluindo respeito à janela de 24 horas e uso de templates aprovados.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">7. Pagamento e Assinatura</h2>
              <p className="mb-3">
                O acesso a determinadas funcionalidades pode exigir assinatura paga. Em tais casos:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Os valores e condições serão apresentados claramente antes da contratação.</li>
                <li>O cancelamento pode ser realizado a qualquer momento, sem multas.</li>
                <li>Não há reembolso por períodos parcialmente utilizados, salvo disposição legal em contrário.</li>
                <li>Reservamo-nos o direito de ajustar preços com aviso prévio de 30 dias.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">8. Disponibilidade do Serviço</h2>
              <p>
                A FotoMOVE envidar seus melhores esforços para manter a plataforma disponível 24 horas por dia, 7 dias por semana. No entanto, não garantimos disponibilidade ininterrupta. Manutenções programadas serão comunicadas com antecedência sempre que possível. Não nos responsabilizamos por danos decorrentes de indisponibilidade temporária do serviço.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">9. Limitação de Responsabilidade</h2>
              <p>
                A FotoMOVE não se responsabiliza por danos indiretos, incidentais, especiais ou consequentes decorrentes do uso ou impossibilidade de uso do serviço. Nossa responsabilidade total está limitada ao valor pago por você nos últimos 12 meses de serviço.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">10. Encerramento de Conta</h2>
              <p>
                Você pode encerrar sua conta a qualquer momento entrando em contato conosco. A FotoMOVE pode suspender ou encerrar sua conta em caso de violação destes termos, com ou sem aviso prévio dependendo da gravidade da infração. Após o encerramento, seus dados serão retidos por 90 dias conforme descrito na Política de Privacidade.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">11. Modificações dos Termos</h2>
              <p>
                Podemos modificar estes Termos de Serviço a qualquer momento. Alterações significativas serão comunicadas por e-mail ou aviso na plataforma com pelo menos 15 dias de antecedência. O uso continuado do serviço após esse período implica na aceitação das novas condições.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">12. Lei Aplicável e Foro</h2>
              <p>
                Estes Termos são regidos pela legislação brasileira, incluindo o Código de Defesa do Consumidor (Lei nº 8.078/90) e a Lei Geral de Proteção de Dados (Lei nº 13.709/18). Fica eleito o foro da comarca de São Paulo/SP para resolução de quaisquer disputas, ressalvadas as hipóteses de foro privilegiado por lei.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">13. Contato</h2>
              <p>
                Para dúvidas ou questões relacionadas a estes Termos de Serviço:
              </p>
              <div className="mt-3 p-4 bg-white/5 border border-white/10 rounded-lg">
                <p><strong className="text-white">FotoMOVE</strong></p>
                <p>E-mail: <a href="mailto:contato@fotomove.com.br" className="text-[#D4A94A] hover:underline">contato@fotomove.com.br</a></p>
              </div>
            </section>

          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  );
}
