import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading, isPlatformAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
