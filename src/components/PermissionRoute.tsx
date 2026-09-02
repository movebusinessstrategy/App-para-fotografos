import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { getLandingRoute } from "../utils/landingRoute";

interface PermissionRouteProps {
  children: React.ReactNode;
  /** Permissão necessária. Se omitida, qualquer logado passa. */
  module?: string;
  /** Se true, só dono da conta OU platform admin podem acessar. */
  ownerOnly?: boolean;
  /** Se true, exige liberação explícita para o painel de rastreamento. */
  marketingTrackingOnly?: boolean;
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
 *
 * Quando bloqueado, redireciona silenciosamente pra primeira rota acessível
 * (ver [[landingRoute]]) — antes mostrava tela "Acesso restrito" com botão
 * Voltar, mas isso quebrava o login (login → /dashboard sem permissão →
 * tela de erro → Voltar → /login → loop).
 */
export default function PermissionRoute({ children, module, ownerOnly, marketingTrackingOnly }: PermissionRouteProps) {
  const { loading, user, isMember, isPlatformAdmin, canAccess, canAccessMarketingTracking } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-gold-500" />
      </div>
    );
  }

  if (!user) return null; // ProtectedRoute pai já redireciona pra login

  if (marketingTrackingOnly && !canAccessMarketingTracking) {
    return <Navigate to={getLandingRoute(canAccess)} replace />;
  }

  // Platform admin: passa por tudo
  if (isPlatformAdmin) return <>{children}</>;

  // Dono: passa por tudo (não é membro)
  if (!isMember) return <>{children}</>;

  // Membro: checa ownerOnly e/ou módulo
  const denied = ownerOnly || (module ? !canAccess(module) : false);

  if (denied) {
    return <Navigate to={getLandingRoute(canAccess)} replace />;
  }

  return <>{children}</>;
}
