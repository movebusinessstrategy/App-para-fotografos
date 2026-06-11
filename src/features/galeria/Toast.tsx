import { AlertCircle, CheckCheck, X } from "lucide-react";
import { cn } from "../../utils/cn";

// Toast caseiro, mesmo padrão da ContractsPage (sem lib).
export type ToastKind = "success" | "error" | "info";
export interface ToastState { kind: ToastKind; message: string }

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className="fixed top-5 right-5 z-[110] animate-in slide-in-from-top-2 fade-in duration-200">
      <div className={cn(
        "flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl backdrop-blur border max-w-md",
        toast.kind === "success" && "bg-emerald-50/95 dark:bg-emerald-900/80 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-100",
        toast.kind === "error" && "bg-red-50/95 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-800 dark:text-red-100",
        toast.kind === "info" && "bg-gray-50/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100",
      )}>
        {toast.kind === "success" && <CheckCheck size={16} className="flex-shrink-0" />}
        {toast.kind === "error" && <AlertCircle size={16} className="flex-shrink-0" />}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
