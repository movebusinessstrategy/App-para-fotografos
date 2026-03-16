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

const variantStyles: Record<Variant, { bg: string; text: string; icon: React.ReactNode }> = {
  danger: {
    bg: "bg-red-100 text-red-700",
    text: "text-red-700",
    icon: <ShieldAlert size={22} />,
  },
  warning: {
    bg: "bg-amber-100 text-amber-700",
    text: "text-amber-700",
    icon: <AlertTriangle size={22} />,
  },
  info: {
    bg: "bg-blue-100 text-blue-700",
    text: "text-blue-700",
    icon: <Info size={22} />,
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
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 space-y-4"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${styles.bg}`}>
                {styles.icon}
              </div>
              <div>
                <p className="text-sm text-gray-500">Confirmação</p>
                <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              </div>
            </div>

            <p className="text-gray-700 leading-relaxed">{message}</p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 rounded-xl font-semibold text-white transition-colors ${
                  variant === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : variant === "warning"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-indigo-600 hover:bg-indigo-700"
                }`}
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
