import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "../integrations/supabase/client";
import { authFetch } from "../utils/authFetch";
import { CONNECTION_ERROR, withTimeout } from '../utils/requestTimeout';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authError: string | null;
  isMember: boolean;
  permissions: Record<string, boolean> | null;
  isPlatformAdmin: boolean;
  isImpersonating: boolean;
  canAccessMarketingTracking: boolean;
  isProductionOnly: boolean;
  features: PlanFeatures;
  canAccess: (module: string) => boolean;
  signOut: () => Promise<void>;
}

interface PlanFeatures { gallery: boolean; album: boolean; storage_gb: number; nota_fiscal: boolean }
const DEFAULT_FEATURES: PlanFeatures = { gallery: true, album: true, storage_gb: 0, nota_fiscal: true };

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  authError: null,
  isMember: false,
  permissions: null,
  isPlatformAdmin: false,
  isImpersonating: false,
  canAccessMarketingTracking: false,
  isProductionOnly: false,
  features: DEFAULT_FEATURES,
  canAccess: () => true,
  signOut: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [canAccessMarketingTracking, setCanAccessMarketingTracking] = useState(false);
  const [isProductionOnly, setIsProductionOnly] = useState(false);
  const [features, setFeatures] = useState<PlanFeatures>(DEFAULT_FEATURES);
  // Qual usuário já teve as permissões carregadas — evita re-fetch em refresh de
  // token e, principalmente, garante que NÃO renderizamos o app antes de saber
  // as permissões (senão o menu pisca "tudo liberado" por alguns segundos).
  const loadedForUser = useRef<string | null>(null);
  const requestVersion = useRef(0);

  const fetchMe = async (version: number) => {
    try {
      const data = await withTimeout((async () => {
        const res = await authFetch("/api/me");
        if (!res.ok) throw new Error(CONNECTION_ERROR);
        return res.json();
      })());
      if (version === requestVersion.current) {
        setIsMember(data.isMember ?? false);
        setPermissions(data.permissions ?? null);
        setIsPlatformAdmin(data.isPlatformAdmin ?? false);
        setIsImpersonating(data.isImpersonating ?? false);
        setCanAccessMarketingTracking(data.canAccessMarketingTracking === true);
        setIsProductionOnly(data.productionOnly ?? false);
        setFeatures(data.planFeatures ?? DEFAULT_FEATURES);
        setAuthError(null);
      }
    } catch {
      if (version !== requestVersion.current) return;
      loadedForUser.current = null;
      setAuthError(CONNECTION_ERROR);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const resetAuthState = () => {
    requestVersion.current++;
    loadedForUser.current = null;
    setAuthError(null);
    setIsMember(false);
    setPermissions(null);
    setIsPlatformAdmin(false);
    setIsImpersonating(false);
    setCanAccessMarketingTracking(false);
    setIsProductionOnly(false);
    setFeatures(DEFAULT_FEATURES);
  };

  useEffect(() => {
    let active = true;
    const scheduled = new Set<ReturnType<typeof setTimeout>>();
    const acceptSession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession) {
        resetAuthState();
        setLoading(false);
        return;
      }
      if (loadedForUser.current === nextSession.user.id) return;
      loadedForUser.current = nextSession.user.id;
      setAuthError(null);
      setLoading(true);
      void fetchMe(++requestVersion.current);
    };

    const initialVersion = requestVersion.current;
    withTimeout(supabase.auth.getSession()).then(({ data, error }) => {
      if (error) throw error;
      if (requestVersion.current === initialVersion) acceptSession(data.session);
    }).catch(() => {
      if (!active || requestVersion.current !== initialVersion) return;
      setAuthError(CONNECTION_ERROR);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        // O callback roda sob o lock de auth. A API pode pedir getSession(),
        // então só a consultamos depois que esse callback liberar o lock.
        const timer = setTimeout(() => {
          scheduled.delete(timer);
          acceptSession(nextSession);
        }, 0);
        scheduled.add(timer);
      }
    );

    return () => {
      active = false;
      requestVersion.current++;
      loadedForUser.current = null;
      scheduled.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const canAccess = (module: string): boolean => {
    if (loading || authError) return false;
    if (!isMember) return true; // dono tem acesso total
    if (!permissions) return false;
    return permissions[module] !== false;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    resetAuthState();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, authError, isMember, permissions, isPlatformAdmin, isImpersonating, canAccessMarketingTracking, isProductionOnly, features, canAccess, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
