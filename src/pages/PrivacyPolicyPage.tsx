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

export default function PrivacyPolicyPage() {
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
          <h1 className="text-3xl font-bold text-white mb-2">Política de Privacidade</h1>
          <p className="text-white/50 text-sm mb-10">Última atualização: 10 de abril de 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-white/80">

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">1. Introdução</h2>
              <p>
                A <strong className="text-white">FotoMOVE</strong> ("nós", "nosso" ou "Empresa") respeita a sua privacidade e está comprometida em proteger os dados pessoais que você nos fornece ao utilizar nossa plataforma de CRM para fotógrafos. Esta Política de Privacidade descreve como coletamos, usamos, armazenamos e protegemos suas informações.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">2. Dados que coletamos</h2>
              <p className="mb-3">Coletamos os seguintes tipos de dados:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li><strong className="text-white">Dados de cadastro:</strong> nome, e-mail e senha (armazenada de forma criptografada).</li>
                <li><strong className="text-white">Dados de clientes e trabalhos:</strong> informações que você insere na plataforma sobre seus clientes, sessões fotográficas e negociações.</li>
                <li><strong className="text-white">Dados de uso:</strong> registros de acesso, ações realizadas e preferências de configuração.</li>
                <li><strong className="text-white">Dados de comunicação:</strong> caso integre com canais de mensagens (ex: WhatsApp Business), os conteúdos de mensagens enviadas via automação.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">3. Como usamos seus dados</h2>
              <p className="mb-3">Utilizamos seus dados para:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Fornecer e melhorar a plataforma FotoMOVE.</li>
                <li>Autenticar seu acesso e garantir a segurança da conta.</li>
                <li>Enviar notificações relacionadas ao serviço (atualizações, alertas de segurança).</li>
                <li>Processar automações de follow-up configuradas por você.</li>
                <li>Cumprir obrigações legais e regulatórias.</li>
              </ul>
              <p className="mt-3">Não vendemos, alugamos nem compartilhamos seus dados com terceiros para fins de marketing.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">4. Armazenamento e segurança</h2>
              <p>
                Seus dados são armazenados em servidores seguros fornecidos pelo <strong className="text-white">Supabase</strong>, com criptografia em trânsito (TLS) e em repouso. Adotamos medidas técnicas e organizacionais adequadas para proteger suas informações contra acesso não autorizado, perda ou alteração.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">5. Compartilhamento de dados</h2>
              <p className="mb-3">Podemos compartilhar seus dados apenas com:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li><strong className="text-white">Provedores de infraestrutura:</strong> Supabase (banco de dados e autenticação), Vercel (hospedagem).</li>
                <li><strong className="text-white">APIs de comunicação:</strong> Meta (WhatsApp Business API), quando a integração for habilitada por você.</li>
                <li><strong className="text-white">Autoridades competentes:</strong> quando exigido por lei ou ordem judicial.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">6. Integração com WhatsApp Business</h2>
              <p>
                Ao utilizar a funcionalidade de automação via WhatsApp, você concorda com os <strong className="text-white">Termos de Serviço do WhatsApp Business</strong> e com a <strong className="text-white">Política de Dados da Meta</strong>. As mensagens enviadas através dessa integração seguem as diretrizes da plataforma Meta, incluindo a janela de 24 horas e o uso de templates aprovados. A FotoMOVE não se responsabiliza por conteúdo enviado em desacordo com as políticas da Meta.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">7. Retenção de dados</h2>
              <p>
                Mantemos seus dados enquanto sua conta estiver ativa. Após o encerramento da conta, os dados são retidos por até 90 dias para fins de backup, sendo então excluídos permanentemente, exceto quando a retenção for exigida por lei.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">8. Seus direitos</h2>
              <p className="mb-3">De acordo com a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018), você tem direito a:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Confirmar a existência de tratamento de seus dados.</li>
                <li>Acessar seus dados pessoais.</li>
                <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
                <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários.</li>
                <li>Solicitar a portabilidade dos dados.</li>
                <li>Revogar o consentimento a qualquer momento.</li>
              </ul>
              <p className="mt-3">Para exercer seus direitos, entre em contato pelo e-mail abaixo.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">9. Cookies</h2>
              <p>
                Utilizamos cookies essenciais para manter sua sessão autenticada e cookies de preferência para salvar configurações como tema (claro/escuro). Não utilizamos cookies de rastreamento de terceiros para fins publicitários.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">10. Alterações nesta política</h2>
              <p>
                Podemos atualizar esta Política de Privacidade periodicamente. Quando realizarmos mudanças significativas, notificaremos você por e-mail ou por aviso na plataforma. O uso continuado do serviço após a notificação implica na aceitação das alterações.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">11. Contato</h2>
              <p>
                Para dúvidas, solicitações ou exercício de direitos relacionados à privacidade, entre em contato conosco:
              </p>
              <div className="mt-3 p-4 bg-white/5 border border-white/10 rounded-lg">
                <p><strong className="text-white">FotoMOVE</strong></p>
                <p>E-mail: <a href="mailto:privacidade@fotomove.com.br" className="text-[#D4A94A] hover:underline">privacidade@fotomove.com.br</a></p>
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
