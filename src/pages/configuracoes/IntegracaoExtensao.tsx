import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Chrome, Download, Check, Folder, MousePointer2, ExternalLink, AlertCircle } from "lucide-react";

interface VersionInfo {
  version: string;
  updated_at: string | null;
}

export default function IntegracaoExtensao() {
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch("/api/public/extension-version")
      .then((r) => r.json())
      .then(setVersion)
      .catch(() => setVersion({ version: "dev", updated_at: null }));
  }, []);

  return (
    <div className="max-w-3xl">
      <Link to="/configuracoes/integracoes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4">
        <ChevronLeft size={16} /> Voltar para integrações
      </Link>

      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-4">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Chrome size={26} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Extensão do Chrome</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Adicione leads direto do WhatsApp Web, veja seu pipeline ao lado das conversas e mande mensagens com templates aprovados — sem trocar de aba.
            </p>
            {version && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                Versão {version.version}
                {version.updated_at && ` · atualizada ${new Date(version.updated_at).toLocaleDateString("pt-BR")}`}
              </p>
            )}
          </div>
        </div>

        <a
          href="/api/public/extension.zip"
          download="focalpoint-extension.zip"
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-600 hover:to-gold-700 text-white font-semibold rounded-lg shadow-md shadow-gold-500/25 hover:shadow-lg transition-all"
        >
          <Download size={18} /> Baixar extensão (.zip)
        </a>
      </div>

      {/* Instruções */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Como instalar (1 minuto)</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
          O processo é manual porque ainda não estamos na Chrome Web Store. Depois de instalar, basta logar com seu email e senha — sem configuração.
        </p>

        <ol className="space-y-4">
          <Step
            n="1"
            title="Baixe e descompacte o arquivo"
            icon={<Folder size={16} />}
            description="Clique em 'Baixar extensão (.zip)' acima. Quando terminar, descompacte o arquivo (clique direito → Extrair). Vai criar uma pasta com vários arquivos dentro."
          />
          <Step
            n="2"
            title="Abra a página de extensões do Chrome"
            icon={<Chrome size={16} />}
            description={
              <>
                Cole na barra de endereço do navegador:{" "}
                <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gold-700 dark:text-gold-400">chrome://extensions</code>
                {" "}e tecle Enter.
              </>
            }
          />
          <Step
            n="3"
            title="Ative o 'Modo do desenvolvedor'"
            icon={<MousePointer2 size={16} />}
            description="No canto superior direito da página de extensões, ative o toggle 'Modo do desenvolvedor'."
          />
          <Step
            n="4"
            title="Clique em 'Carregar sem compactação'"
            icon={<MousePointer2 size={16} />}
            description="O Chrome vai abrir um seletor de pastas. Selecione a pasta que você descompactou no passo 1."
          />
          <Step
            n="5"
            title="Faça login dentro da extensão"
            icon={<Check size={16} />}
            description="A extensão vai aparecer no canto superior do navegador. Clique nela e entre com o MESMO email e senha que você usa aqui no app."
          />
        </ol>

        {/* Sobre atualizações */}
        <div className="mt-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                Quando houver atualizações
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-200 leading-relaxed">
                Avisaremos no app quando sair uma versão nova. Você só precisa baixar o zip de novo, descompactar por cima da pasta antiga e clicar no botão de "Atualizar" em <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">chrome://extensions</code>.
                <br />
                <span className="opacity-75">Em breve estaremos na Chrome Web Store e as atualizações serão automáticas.</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Link pra Chrome Web Store (futuro) */}
      <div className="mt-4 text-center">
        <a
          href="https://chrome.google.com/webstore"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gold-600 dark:hover:text-gold-400"
        >
          Em breve na Chrome Web Store <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function Step({ n, title, icon, description }: { n: string; title: string; icon: React.ReactNode; description: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="w-8 h-8 rounded-lg bg-gold-100 dark:bg-gold-900/30 text-gold-700 dark:text-gold-300 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {n}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="flex items-center gap-1.5 mb-0.5">
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">{title}</h4>
          <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{description}</div>
      </div>
    </li>
  );
}
