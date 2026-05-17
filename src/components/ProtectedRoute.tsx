import type React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-gold-400" />
          <p className="text-white/70">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // Não-logados em rota protegida vão pro login (preservando a URL de destino).
    // A raiz "/" é pública (LandingPage), então nem chega aqui.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
