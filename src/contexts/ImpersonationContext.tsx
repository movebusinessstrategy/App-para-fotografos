import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { mutate as swrGlobalMutate } from "swr";
import {
  authFetch,
  IMPERSONATION_STORAGE_KEY,
  IMPERSONATION_MEMBER_STORAGE_KEY,
} from "../utils/authFetch";

type Mode = "owner" | "member";

interface ImpersonationState {
  ownerId: string | null;
  ownerEmail: string | null;
  memberId: string | null;
  memberLabel: string | null;
  mode: Mode | null;
}

interface ImpersonationContextType extends ImpersonationState {
  startAsOwner: (ownerId: string, ownerEmail?: string | null) => Promise<void>;
  startAsMember: (memberId: string, memberLabel: string, ownerId: string, ownerEmail?: string | null) => Promise<void>;
  stop: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  ownerId: null,
  ownerEmail: null,
  memberId: null,
  memberLabel: null,
  mode: null,
  startAsOwner: async () => {},
  startAsMember: async () => {},
  stop: async () => {},
});

export const useImpersonation = () => useContext(ImpersonationContext);

const OWNER_EMAIL_KEY = "platform_admin_impersonate_owner_email";
const MEMBER_LABEL_KEY = "platform_admin_impersonate_member_label";

function readState(): ImpersonationState {
  if (typeof window === "undefined") {
    return { ownerId: null, ownerEmail: null, memberId: null, memberLabel: null, mode: null };
  }
  const memberId = sessionStorage.getItem(IMPERSONATION_MEMBER_STORAGE_KEY);
  const ownerId  = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
  return {
    ownerId,
    ownerEmail: sessionStorage.getItem(OWNER_EMAIL_KEY),
    memberId,
    memberLabel: sessionStorage.getItem(MEMBER_LABEL_KEY),
    mode: memberId ? "member" : ownerId ? "owner" : null,
  };
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImpersonationState>(readState);

  const startAsOwner = useCallback(async (ownerId: string, ownerEmail?: string | null) => {
    // Loga ANTES de ativar o header - assim o registro fica no admin real.
    // CRÍTICO: se o backend recusa (não é super-admin, tenant deletado, etc),
    // NÃO ativa o sessionStorage — senão o banner aparece mas todas as requisições
    // batem 403 e a UI vê tudo vazio.
    const res = await authFetch(`/api/platform/tenants/${ownerId}/impersonate-start`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Não consegui entrar como esse usuário: ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }
    sessionStorage.removeItem(IMPERSONATION_MEMBER_STORAGE_KEY);
    sessionStorage.removeItem(MEMBER_LABEL_KEY);
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, ownerId);
    if (ownerEmail) sessionStorage.setItem(OWNER_EMAIL_KEY, ownerEmail);
    // Limpa todo o cache SWR antes do reload pra evitar dados do admin
    // vazarem pra tela do impersonado.
    await swrGlobalMutate(() => true, undefined, { revalidate: false });
    setState(readState());
    window.location.assign("/");
  }, []);

  const startAsMember = useCallback(async (
    memberId: string,
    memberLabel: string,
    ownerId: string,
    ownerEmail?: string | null,
  ) => {
    const res = await authFetch(`/api/platform/members/${memberId}/impersonate-start`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Não consegui entrar como esse membro: ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.setItem(IMPERSONATION_MEMBER_STORAGE_KEY, memberId);
    sessionStorage.setItem(MEMBER_LABEL_KEY, memberLabel);
    sessionStorage.setItem(OWNER_EMAIL_KEY, ownerEmail ?? "");
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, ownerId);
    await swrGlobalMutate(() => true, undefined, { revalidate: false });
    setState(readState());
    window.location.assign("/");
  }, []);

  const stop = useCallback(async () => {
    const ownerId = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.removeItem(IMPERSONATION_MEMBER_STORAGE_KEY);
    sessionStorage.removeItem(OWNER_EMAIL_KEY);
    sessionStorage.removeItem(MEMBER_LABEL_KEY);
    // Limpa cache SWR pra não vazar dados do impersonado pra tela do admin.
    await swrGlobalMutate(() => true, undefined, { revalidate: false });
    setState(readState());
    try {
      await authFetch("/api/platform/impersonate-stop", {
        method: "POST",
        body: JSON.stringify({ owner_user_id: ownerId }),
      });
    } catch {
      // best-effort
    }
    window.location.assign("/platform-admin/tenants");
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === IMPERSONATION_STORAGE_KEY ||
        e.key === IMPERSONATION_MEMBER_STORAGE_KEY
      ) {
        setState(readState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ImpersonationContext.Provider value={{ ...state, startAsOwner, startAsMember, stop }}>
      {children}
    </ImpersonationContext.Provider>
  );
}
