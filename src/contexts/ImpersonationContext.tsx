import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
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
    await authFetch(`/api/platform/tenants/${ownerId}/impersonate-start`, { method: "POST" });
    sessionStorage.removeItem(IMPERSONATION_MEMBER_STORAGE_KEY);
    sessionStorage.removeItem(MEMBER_LABEL_KEY);
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, ownerId);
    if (ownerEmail) sessionStorage.setItem(OWNER_EMAIL_KEY, ownerEmail);
    setState(readState());
    window.location.assign("/");
  }, []);

  const startAsMember = useCallback(async (
    memberId: string,
    memberLabel: string,
    ownerId: string,
    ownerEmail?: string | null,
  ) => {
    await authFetch(`/api/platform/members/${memberId}/impersonate-start`, { method: "POST" });
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.setItem(IMPERSONATION_MEMBER_STORAGE_KEY, memberId);
    sessionStorage.setItem(MEMBER_LABEL_KEY, memberLabel);
    // Guarda o owner também (pra exibir no banner)
    sessionStorage.setItem(OWNER_EMAIL_KEY, ownerEmail ?? "");
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, ownerId); // só pro display, header de member tem prioridade
    setState(readState());
    window.location.assign("/");
  }, []);

  const stop = useCallback(async () => {
    const ownerId = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    sessionStorage.removeItem(IMPERSONATION_MEMBER_STORAGE_KEY);
    sessionStorage.removeItem(OWNER_EMAIL_KEY);
    sessionStorage.removeItem(MEMBER_LABEL_KEY);
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
