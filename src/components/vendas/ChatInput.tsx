import React, { KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
}

export function ChatInput({ value, onChange, onSend }: ChatInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      triggerSend();
    }
  };

  const triggerSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          placeholder="Digite uma mensagem..."
        />
        <button
          type="button"
          onClick={triggerSend}
          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
          disabled={!value.trim()}
          title="Enviar"
        >
          <Send size={16} />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        Enter envia • Shift + Enter quebra linha
      </p>
    </div>
  );
}
