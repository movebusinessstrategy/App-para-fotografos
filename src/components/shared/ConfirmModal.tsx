import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

type Variant = "danger" | "warning" | "info";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  onConfirm: () => void;
  onCancel: () => void;
};

const variantStyles: Record<Variant, { 
  bg: string; 
  text: string; 
  icon: React.ReactNode;
  confirmBtn: string;
}> = {
  danger: {
    bg: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    text: "text-red-700 dark:text-red-400",
    icon: <ShieldAlert size={22} />,
    confirmBtn: "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700",
  },
  warning: {
    bg: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
    icon: <AlertTriangle size={22} />,
    confirmBtn: "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700",
  },
  info: {
    bg: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    text: "text-blue-700 dark:text-blue-400",
    icon: <Info size={22} />,
    confirmBtn: "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600",
  },
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "warning",
  onConfirm,
  onCancel,
}: Props) {
  const styles = variantStyles[variant];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl dark:shadow-black/40 border border-gray-200 dark:border-gray-800 p-6 space-y-4"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${styles.bg}`}>
                {styles.icon}
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Confirmação</p>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
              </div>
            </div>

            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{message}</p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 rounded-xl font-semibold text-white transition-colors ${styles.confirmBtn}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
