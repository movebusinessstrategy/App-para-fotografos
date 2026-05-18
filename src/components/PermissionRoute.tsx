import React from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface PermissionRouteProps {
  children: React.ReactNode;
  /** Permissão necessária. Se omitida, qualquer logado passa. */
  module?: string;
  /** Se true, só dono da conta OU platform admin podem acessar. */
  ownerOnly?: boolean;
}

/**
 * Bloqueia acesso a uma rota se o usuário (membro) não tem a permissão
 * configurada. Diferente de esconder o item no sidebar, isso impede
 * acesso via URL direta também.
 *
 * Regras:
 * - Dono da conta (isMember === false) sempre passa.
 * - Platform admin sempre passa (override total).
 * - Membro: precisa de `permissions[module] !== false` (default = true).
 * - `ownerOnly`: bloqueia membros independente das permissões.
 */
export default function PermissionRoute({ children, module, ownerOnly }: PermissionRouteProps) {
  const { loading, user, isMember, isPlatformAdmin, canAccess } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-gold-500" />
      </div>
    );
  }

  if (!user) return null; // ProtectedRoute pai já redireciona pra login

  // Platform admin: passa por tudo
  if (isPlatformAdmin) return <>{children}</>;

  // Dono: passa por tudo (não é membro)
  if (!isMember) return <>{children}</>;

  // Membro: checa ownerOnly e/ou módulo
  const denied = ownerOnly || (module ? !canAccess(module) : false);

  if (denied) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            Acesso restrito
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {ownerOnly
              ? "Essa área é restrita ao dono da conta."
              : "Você não tem permissão pra acessar essa página."}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
            Peça pro administrador liberar o acesso em <strong>Configurações &gt; Permissões</strong>.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gold-500 hover:bg-gold-600 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <ArrowLeft size={14} /> Voltar
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
