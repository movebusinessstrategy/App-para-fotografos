import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title = "Confirmar ação",
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: "text-red-500 bg-red-50",
      button: "bg-red-600 hover:bg-red-700 text-white",
    },
    warning: {
      icon: "text-amber-500 bg-amber-50",
      button: "bg-amber-600 hover:bg-amber-700 text-white",
    },
    default: {
      icon: "text-gray-500 bg-gray-100",
      button: "bg-gray-900 hover:bg-gray-800 text-white",
    },
  } as const;

  const styles = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          {/* Ícone */}
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${styles.icon}`}
          >
            <AlertTriangle size={24} />
          </div>

          {/* Título */}
          <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
            {title}
          </h3>

          {/* Mensagem */}
          <p className="text-sm text-gray-600 text-center">
            {message}
          </p>
        </div>

        {/* Ações */}
        <div className="flex gap-3 p-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${styles.button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
