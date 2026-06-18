import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "../integrations/supabase/client";
import { authFetch } from "../utils/authFetch";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isMember: boolean;
  permissions: Record<string, boolean> | null;
  isPlatformAdmin: boolean;
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
  isMember: false,
  permissions: null,
  isPlatformAdmin: false,
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
  const [isMember, setIsMember] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isProductionOnly, setIsProductionOnly] = useState(false);
  const [features, setFeatures] = useState<PlanFeatures>(DEFAULT_FEATURES);
  // Qual usuário já teve as permissões carregadas — evita re-fetch em refresh de
  // token e, principalmente, garante que NÃO renderizamos o app antes de saber
  // as permissões (senão o menu pisca "tudo liberado" por alguns segundos).
  const loadedForUser = useRef<string | null>(null);

  const fetchMe = async () => {
    try {
      const res = await authFetch("/api/me");
      if (res.ok) {
        const data = await res.json();
        setIsMember(data.isMember ?? false);
        setPermissions(data.permissions ?? null);
        setIsPlatformAdmin(data.isPlatformAdmin ?? false);
        setIsProductionOnly(data.productionOnly ?? false);
        setFeatures(data.planFeatures ?? DEFAULT_FEATURES);
      }
    } catch {
      // silencia - se falhar, trata como dono
    } finally {
      setLoading(false);
    }
  };

  const resetAuthState = () => {
    loadedForUser.current = null;
    setIsMember(false);
    setPermissions(null);
    setIsPlatformAdmin(false);
    setIsProductionOnly(false);
    setFeatures(DEFAULT_FEATURES);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        // Só busca se ainda não buscou pra esse usuário (evita corrida com
        // onAuthStateChange). loading começa true, então o app já espera.
        if (loadedForUser.current !== session.user.id) {
          loadedForUser.current = session.user.id;
          fetchMe();
        }
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const newUserId = session?.user?.id ?? null;
        setSession(session);
        setUser(session?.user ?? null);
        if (!session) {
          resetAuthState();
          setLoading(false);
          return;
        }
        // Usuário NOVO (login ou troca de conta): segura o app no "Carregando"
        // até as permissões chegarem. Mesmo usuário (refresh de token): ignora.
        if (loadedForUser.current !== newUserId) {
          loadedForUser.current = newUserId;
          setLoading(true);
          fetchMe();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const canAccess = (module: string): boolean => {
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
    <AuthContext.Provider value={{ user, session, loading, isMember, permissions, isPlatformAdmin, isProductionOnly, features, canAccess, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
