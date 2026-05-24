import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
  canAccess: (module: string) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isMember: false,
  permissions: null,
  isPlatformAdmin: false,
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

  const fetchMe = async () => {
    try {
      const res = await authFetch("/api/me");
      if (res.ok) {
        const data = await res.json();
        setIsMember(data.isMember ?? false);
        setPermissions(data.permissions ?? null);
        setIsPlatformAdmin(data.isPlatformAdmin ?? false);
      }
    } catch {
      // silencia - se falhar, trata como dono
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        fetchMe(); // loading=false só depois do fetchMe
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session) {
          fetchMe(); // loading=false dentro do fetchMe
        } else {
          setIsMember(false);
          setPermissions(null);
          setIsPlatformAdmin(false);
          setLoading(false);
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
    setIsMember(false);
    setPermissions(null);
    setIsPlatformAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isMember, permissions, isPlatformAdmin, canAccess, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
