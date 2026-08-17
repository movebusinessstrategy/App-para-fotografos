import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const TrilhaLogo = () => <img src="/logo-dark.png" alt="CRM Trilha" className="h-8 w-auto" />;

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
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

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 md:p-12 text-white/90">
          <h1 className="text-3xl font-bold text-white mb-2">Política de Privacidade</h1>
          <p className="text-white/50 text-sm mb-10">Última atualização: 16 de agosto de 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-white/80">

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">1. Introdução</h2>
              <p>
                A <strong className="text-white">CRM Trilha</strong> ("nós", "nosso" ou "Empresa") respeita a sua privacidade e está comprometida em proteger os dados pessoais que você nos fornece ao utilizar nossa plataforma de CRM para fotógrafos. Esta Política de Privacidade descreve como coletamos, usamos, armazenamos e protegemos suas informações.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">2. Dados que coletamos</h2>
              <p className="mb-3">Coletamos os seguintes tipos de dados:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li><strong className="text-white">Dados de cadastro:</strong> nome, e-mail e senha (armazenada de forma criptografada).</li>
                <li><strong className="text-white">Dados de clientes e trabalhos:</strong> informações que você insere na plataforma sobre seus clientes, sessões fotográficas e negociações.</li>
                <li><strong className="text-white">Dados de uso:</strong> registros de acesso, ações realizadas e preferências de configuração.</li>
                <li><strong className="text-white">Dados da integração WhatsApp Cloud API (Meta):</strong> quando você conecta uma conta WhatsApp Business via Embedded Signup, coletamos: identificador da WABA (waba_id), identificador do número de telefone (phone_number_id), número exibido (display_phone_number), nome verificado (verified_name), token de acesso criptografado, conteúdo de mensagens trocadas (texto, mídia, metadados como timestamps e IDs), nome de contato fornecido pelo remetente e status de qualidade do número.</li>
                <li><strong className="text-white">Dados da integração Google Agenda:</strong> quando você conecta sua Conta Google, acessamos o e-mail da conta, os eventos do calendário necessários à sincronização e os tokens OAuth que mantêm a integração ativa.</li>
                <li><strong className="text-white">Dados da integração Google Ads:</strong> quando a integração estiver disponível, for autorizada pelo titular e a conta for vinculada pela equipe autorizada da plataforma, acessamos os identificadores da conta administradora necessários ao roteamento, da conta anunciante autorizada e das campanhas, além de métricas agregadas como impressões, cliques, custo, conversões e valor de conversão. A consulta atual não busca detalhes de grupos de anúncios nem de anúncios individuais. Também podemos armazenar identificadores de clique recebidos nos seus canais, como GCLID, GBRAID e WBRAID, para futuramente relacionar um lead ou uma venda do CRM à campanha de origem, somente após validação verificável.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">3. Como usamos seus dados</h2>
              <p className="mb-3">Utilizamos seus dados para:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Fornecer e melhorar a plataforma CRM Trilha.</li>
                <li>Autenticar seu acesso e garantir a segurança da conta.</li>
                <li>Enviar notificações relacionadas ao serviço (atualizações, alertas de segurança).</li>
                <li>Processar automações de follow-up configuradas por você.</li>
                <li>Exibir relatórios de desempenho e, somente quando houver vínculo verificável entre clique, conta, campanha e negócio, atribuir leads e vendas do CRM ao Google Ads.</li>
                <li>Cumprir obrigações legais e regulatórias.</li>
              </ul>
              <p className="mt-3">Não vendemos, alugamos nem compartilhamos seus dados com terceiros para fins de marketing, remarketing (retargeting) de terceiros ou treinamento de modelos de inteligência artificial.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">4. Armazenamento e segurança</h2>
              <p>
                Seus dados são armazenados em servidores seguros fornecidos pelo <strong className="text-white">Supabase</strong>, com criptografia em trânsito (TLS) e em repouso. As credenciais Google Ads permanecem no ambiente do servidor e não são expostas pela interface. Aplicamos isolamento lógico por tenant para que cada empresa veja somente suas próprias contas vinculadas e métricas. Adotamos medidas técnicas e organizacionais adequadas para proteger suas informações contra acesso não autorizado, perda ou alteração.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">5. Compartilhamento de dados</h2>
              <p className="mb-3">Podemos compartilhar seus dados apenas com:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li><strong className="text-white">Provedores de infraestrutura:</strong> Supabase (banco de dados e autenticação), Render (processamento do servidor) e Vercel (hospedagem da interface).</li>
                <li><strong className="text-white">APIs de comunicação:</strong> Meta (WhatsApp Business API), quando a integração for habilitada por você.</li>
                <li><strong className="text-white">Google Calendar API:</strong> somente quando você habilita a integração, para sincronizar ensaios e enviar convites aos participantes informados por você.</li>
                <li><strong className="text-white">Google Ads API:</strong> somente quando a conta for autorizada e vinculada ao tenant, para consultar dados de relatório e atribuição. A CRM Trilha não usa essa integração para alterar campanhas ou criar públicos.</li>
                <li><strong className="text-white">Autoridades competentes:</strong> quando exigido por lei ou ordem judicial.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">6. Integração com WhatsApp Cloud API (Meta)</h2>
              <p className="mb-3">
                A CRM Trilha integra-se à <strong className="text-white">WhatsApp Cloud API da Meta Platforms, Inc.</strong> exclusivamente quando você habilita explicitamente essa integração via fluxo de Embedded Signup. Ao habilitar:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2 mb-3">
                <li><strong className="text-white">Dados acessados na Meta:</strong> WABAs e números de telefone que você possui ou tem acesso autorizado, perfil público do dono da conta (nome, foto), templates de mensagem cadastrados e mensagens recebidas e enviadas pelo número conectado.</li>
                <li><strong className="text-white">Dados armazenados por nós:</strong> identificadores Meta (waba_id, phone_number_id, business_account_id), token de acesso criptografado em repouso com AES-256-GCM, conteúdo de mensagens (texto e mídia), nome do contato remetente e metadados das mensagens (timestamps, IDs únicos, status de entrega).</li>
                <li><strong className="text-white">Onde armazenamos:</strong> banco de dados PostgreSQL gerenciado pelo Supabase, com criptografia em trânsito (TLS 1.2+) e em repouso. O conteúdo das mensagens fica restrito ao seu tenant — outros usuários da plataforma não têm acesso.</li>
                <li><strong className="text-white">Tempo de retenção:</strong> enquanto sua integração estiver ativa. Após desconexão da integração ou encerramento da conta, todos os dados WhatsApp são excluídos em até 90 dias, exceto quando a retenção for exigida por lei.</li>
                <li><strong className="text-white">Meta como sub-processador:</strong> a Meta Platforms, Inc. atua como sub-processadora dos dados de mensagens trocadas pela Cloud API. O processamento por parte da Meta segue a <a href="https://www.whatsapp.com/legal/business-policy/" target="_blank" rel="noopener noreferrer" className="text-[#D4A94A] hover:underline">WhatsApp Business Messaging Policy</a> e a <a href="https://privacycenter.instagram.com/policies/business-tools/" target="_blank" rel="noopener noreferrer" className="text-[#D4A94A] hover:underline">Política de Dados Comerciais da Meta</a>.</li>
                <li><strong className="text-white">Não compartilhamos com terceiros:</strong> os dados de mensagens não são vendidos, alugados nem compartilhados com terceiros não listados nesta política, nem usados para fins de marketing ou treinamento de modelos de IA fora do escopo do seu uso individual.</li>
              </ul>
              <p className="mb-3">
                As mensagens enviadas seguem as diretrizes da Meta, incluindo a janela de atendimento de 24 horas e o uso de templates aprovados. Você é responsável pelo conteúdo das mensagens enviadas e pelo cumprimento das políticas da Meta — violações podem resultar em suspensão pela própria Meta.
              </p>
              <p>
                Para revogar essa integração a qualquer momento, vá em <strong className="text-white">Configurações → Integrações → WhatsApp → Desconectar</strong>. Para solicitar a exclusão completa dos dados coletados via WhatsApp, utilize a página de <Link to="/excluir-dados" className="text-[#D4A94A] hover:underline">exclusão de dados</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">7. Integração com o Google Agenda</h2>
              <p className="mb-3">
                A integração com o <strong className="text-white">Google Agenda</strong> é opcional e só é ativada após sua autorização no fluxo OAuth do Google. Ela é usada para criar, consultar, atualizar e excluir eventos de ensaios no calendário conectado e para adicionar como participantes os e-mails de clientes que você informar.
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2 mb-3">
                <li><strong className="text-white">Dados acessados:</strong> e-mail da Conta Google conectada e dados dos eventos necessários à sincronização, como título, descrição, data, horário e participantes.</li>
                <li><strong className="text-white">Finalidade:</strong> manter os ensaios do CRM e do calendário alinhados, evitar cadastro duplicado e enviar o convite do agendamento ao cliente.</li>
                <li><strong className="text-white">Dados armazenados:</strong> tokens de acesso e atualização OAuth, validade da autorização e o identificador do evento Google vinculado ao ensaio. Os tokens são protegidos com controles de acesso e criptografia.</li>
                <li><strong className="text-white">Compartilhamento:</strong> não vendemos nem usamos dados do Google para publicidade, perfilamento ou treinamento de modelos. Os dados são enviados apenas ao Google Calendar API e aos participantes adicionados ao evento por você.</li>
                <li><strong className="text-white">Revogação:</strong> você pode desconectar a integração em <strong className="text-white">Configurações → Integrações → Google Calendar</strong>. Ao desconectar, removemos os tokens salvos e solicitamos a revogação da autorização no Google.</li>
              </ul>
              <p>
                O uso e a transferência de informações recebidas das APIs do Google pela CRM Trilha seguem a <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-[#D4A94A] hover:underline">Política de Dados do Usuário dos Serviços de API do Google</a>, inclusive os requisitos de Uso Limitado.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">8. Integração com o Google Ads</h2>
              <p className="mb-3">
                A integração com o <strong className="text-white">Google Ads</strong> é opcional. Quando estiver disponível, ela funcionará com acesso somente leitura após autorização do titular e vinculação da conta de anunciante pela equipe autorizada da plataforma.
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2 mb-3">
                <li><strong className="text-white">Dados acessados atualmente:</strong> identificadores e nomes da conta e das campanhas; datas, status e métricas de desempenho, como impressões, cliques, custo, conversões e valor de conversão. O relatório atual não consulta detalhes de grupos de anúncios ou anúncios individuais.</li>
                <li><strong className="text-white">Atribuição:</strong> receber um identificador de clique (GCLID, GBRAID ou WBRAID) não é suficiente, por si só, para atribuir uma venda. Vendas atribuídas, CAC e ROAS permanecem indisponíveis até que o CRM consiga verificar a relação entre o clique, a conta e campanha vinculadas e o negócio correspondente.</li>
                <li><strong className="text-white">Isolamento por empresa:</strong> cada tenant é associado somente aos identificadores de conta Google Ads que lhe pertencem. Usuários de uma empresa não recebem acesso à hierarquia, às credenciais ou aos relatórios de outra.</li>
                <li><strong className="text-white">Limites do relatório:</strong> "conversões do Google Ads" são métricas nativas, medidas ou importadas na plataforma de anúncios; "vendas do CRM" são negócios registrados como ganhos na CRM Trilha. Enquanto a atribuição verificável não estiver disponível, o dashboard mostra somente as métricas nativas do Google Ads. Quando habilitadas, as fontes continuam separadas e podem divergir por janela, modelo e cobertura.</li>
                <li><strong className="text-white">Compartilhamento:</strong> as métricas e atribuições ficam acessíveis aos usuários autorizados do tenant e aos provedores de infraestrutura necessários ao funcionamento da CRM Trilha, além das hipóteses exigidas por lei.</li>
                <li><strong className="text-white">Uso restrito:</strong> não vendemos esses dados, não os usamos para criar públicos ou remarketing (retargeting), não os transferimos para publicidade de terceiros e não os utilizamos para treinar modelos de inteligência artificial.</li>
                <li><strong className="text-white">Revogação e desvinculação:</strong> o titular pode solicitar a desvinculação. A equipe autorizada remove o vínculo da conta no CRM e interrompe novas sincronizações. A autorização da conta técnica compartilhada pela plataforma é removida separadamente no Google Ads ou no MCC por um administrador autorizado.</li>
                <li><strong className="text-white">Retenção:</strong> métricas já sincronizadas e vínculos de atribuição podem permanecer no histórico do tenant enquanto a conta CRM estiver ativa. Uma solicitação aplicável é registrada para revisão e processamento; depois da exclusão nos sistemas ativos, cópias protegidas podem permanecer em backups por até 90 dias, além das retenções exigidas por lei.</li>
              </ul>
              <p>
                O uso e a transferência de informações recebidas das APIs do Google pela CRM Trilha seguem a <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-[#D4A94A] hover:underline">Política de Dados do Usuário dos Serviços de API do Google</a>, inclusive os requisitos de Uso Limitado.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">9. Retenção de dados</h2>
              <p>
                Mantemos seus dados enquanto sua conta estiver ativa ou pelo tempo necessário para fornecer cada integração. Pedidos de exclusão são registrados com protocolo e passam por revisão antes do processamento. Depois da remoção dos sistemas ativos, cópias protegidas podem permanecer em backups por até 90 dias, sendo então eliminadas, exceto quando a retenção for exigida por lei.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">10. Seus direitos</h2>
              <p className="mb-3">De acordo com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018), você tem direito a:</p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>Confirmar a existência de tratamento de seus dados.</li>
                <li>Acessar seus dados pessoais.</li>
                <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
                <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários.</li>
                <li>Solicitar a portabilidade dos dados.</li>
                <li>Revogar o consentimento a qualquer momento.</li>
              </ul>
              <p className="mt-3">
                Para exercer seus direitos, entre em contato pelo e-mail abaixo ou utilize a página dedicada de <Link to="/excluir-dados" className="text-[#D4A94A] hover:underline">exclusão de dados</Link>, onde você pode solicitar a remoção completa dos seus dados, incluindo dados de integrações, sem precisar abrir um ticket.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">11. Cookies e identificadores de clique</h2>
              <p>
                Utilizamos cookies essenciais para manter sua sessão autenticada e cookies de preferência para salvar configurações como tema (claro/escuro). Não utilizamos cookies de rastreamento de terceiros para fins publicitários. Se um visitante chegar por um anúncio, o CRM pode receber o identificador de clique presente no endereço da página para atribuir o lead, sem usá-lo para retargeting.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">12. Alterações nesta política</h2>
              <p>
                Podemos atualizar esta Política de Privacidade periodicamente. Quando realizarmos mudanças significativas, notificaremos você por e-mail ou por aviso na plataforma. O uso continuado do serviço após a notificação implica na aceitação das alterações.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white mb-3">13. Contato</h2>
              <p>
                Para dúvidas, solicitações ou exercício de direitos relacionados à privacidade, entre em contato conosco:
              </p>
              <div className="mt-3 p-4 bg-white/5 border border-white/10 rounded-lg">
                <p><strong className="text-white">CRM Trilha</strong></p>
                <p>E-mail: <a href="mailto:contato@movebusiness.com.br" className="text-[#D4A94A] hover:underline">contato@movebusiness.com.br</a></p>
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
