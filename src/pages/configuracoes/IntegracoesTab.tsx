import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, MessageCircle, CheckCircle2, ChevronRight, Circle, Chrome, FileSignature } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { useAuth } from "../../contexts/AuthContext";

interface IntegrationCardProps {
  to: string;
  title: string;
  description: string;
  connected?: boolean;
  loading?: boolean;
  badge?: string;
  icon: React.ReactNode;
  iconBg: string;
}

function IntegrationCard({ to, title, description, connected, loading, badge, icon, iconBg }: IntegrationCardProps) {
  const hasConnectionState = connected !== undefined || loading;
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 hover:border-gold-400 hover:shadow-md transition-all"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          {badge ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gold-100 dark:bg-gold-900/30 text-gold-700 dark:text-gold-300">
              {badge}
            </span>
          ) : hasConnectionState ? (
            loading ? (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
                Verificando…
              </span>
            ) : connected ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={10} /> Conectado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                <Circle size={9} /> Não conectado
              </span>
            )
          ) : null}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <ChevronRight size={18} className="text-gray-300 group-hover:text-gold-500 transition-colors flex-shrink-0" />
    </Link>
  );
}

export default function IntegracoesTab() {
  const { isMember, isPlatformAdmin } = useAuth();
  const isOwner = !isMember || isPlatformAdmin;
  const [googleConnected, setGoogleConnected] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      authFetch("/api/auth/google/status").then(r => r.json()).then(d => setGoogleConnected(!!d.connected)).catch(() => {}),
      authFetch("/api/meta/whatsapp/status").then(r => r.json()).then(d => setWaConnected(!!d.connected)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Integrações</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Conecte ferramentas externas pra automatizar seu fluxo.
        </p>
      </div>

      <div className="space-y-3">
        <IntegrationCard
          to="/configuracoes/integracoes/whatsapp"
          title="WhatsApp Business"
          description="Envie mensagens automáticas, templates aprovados pelo Meta e follow-ups."
          connected={waConnected}
          loading={loading}
          icon={<MessageCircle size={22} className="text-emerald-600 dark:text-emerald-400" />}
          iconBg="bg-emerald-50 dark:bg-emerald-900/20"
        />
        <IntegrationCard
          to="/configuracoes/integracoes/calendar"
          title="Google Calendar"
          description="Sincronize seus ensaios automaticamente com o calendário."
          connected={googleConnected}
          loading={loading}
          icon={<Calendar size={22} className="text-gold-600 dark:text-gold-400" />}
          iconBg="bg-gold-50 dark:bg-gold-900/20"
        />
        <IntegrationCard
          to="/configuracoes/integracoes/extensao"
          title="Extensão Chrome"
          description="Crie leads e veja o pipeline direto no WhatsApp Web."
          badge="Download"
          icon={<Chrome size={22} className="text-blue-600 dark:text-blue-400" />}
          iconBg="bg-blue-50 dark:bg-blue-900/20"
        />
        {/* Autentique — Importar histórico (DESATIVADO temporariamente).
            Backend e rota /configuracoes/integracoes/autentique continuam
            existindo, só não estão expostos no menu. Pra reativar, basta
            descomentar este bloco. */}
        {false && isOwner && (
          <IntegrationCard
            to="/configuracoes/integracoes/autentique"
            title="Autentique — Importar histórico"
            description="Puxa contratos antigos do Autentique e cria clientes + histórico de sessões."
            badge="Importar"
            icon={<FileSignature size={22} className="text-gold-600 dark:text-gold-400" />}
            iconBg="bg-gold-50 dark:bg-gold-900/20"
          />
        )}
      </div>
    </div>
  );
}
