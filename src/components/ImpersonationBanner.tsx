import { LogOut, ShieldAlert } from "lucide-react";
import { useImpersonation } from "../contexts/ImpersonationContext";

export default function ImpersonationBanner() {
  const { ownerId, ownerEmail, memberLabel, mode, stop } = useImpersonation();
  if (!ownerId && !memberLabel) return null;

  return (
    <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert size={16} className="flex-shrink-0" />
        <span className="truncate">
          {mode === "member" ? (
            <>Você está vendo como o membro <strong>{memberLabel}</strong> da empresa <strong>{ownerEmail || ownerId}</strong> - todas as ações são registradas.</>
          ) : (
            <>Você está vendo a conta de <strong>{ownerEmail ?? ownerId}</strong> - todas as ações são registradas.</>
          )}
        </span>
      </div>
      <button
        onClick={stop}
        className="flex items-center gap-1.5 px-3 py-1 bg-white/15 hover:bg-white/25 rounded text-xs font-semibold whitespace-nowrap"
      >
        <LogOut size={13} /> Sair
      </button>
    </div>
  );
}
