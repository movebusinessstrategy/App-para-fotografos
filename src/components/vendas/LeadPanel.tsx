import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Lead, QuickReply } from "../../types/vendas";
import { LeadPanelDados } from "./LeadPanelDados";
import { LeadPanelChat } from "./LeadPanelChat";

interface LeadPanelProps {
  lead: Lead | null;
  quickReplies: QuickReply[];
  onClose: () => void;
  onSendMessage: (text: string) => void;
}

export function LeadPanel({ lead, quickReplies, onClose, onSendMessage }: LeadPanelProps) {
  const [activeTab, setActiveTab] = useState<"dados" | "chat">("dados");

  useEffect(() => {
    setActiveTab("dados");
  }, [lead?.id]);

  if (!lead) return null;

  return (
    <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:inset-y-0 md:right-0 md:left-auto md:w-[380px] md:bg-transparent md:backdrop-blur-none">
      <div className="absolute inset-0 md:hidden" onClick={onClose} />
      <aside className="relative z-10 flex h-full flex-col bg-white shadow-lg dark:bg-gray-800 md:border-l md:border-gray-200 md:dark:border-gray-700">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {lead.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {lead.serviceType} • {lead.channel === "whatsapp" ? "WhatsApp" : "Instagram"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Fechar painel"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex items-center border-b border-gray-200 px-3 dark:border-gray-700">
          {["dados", "chat"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as "dados" | "chat")}
              className={`flex-1 px-3 py-3 text-sm font-semibold transition ${
                activeTab === tab
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {tab === "dados" ? "📋 Dados" : "💬 Chat"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-900">
          {activeTab === "dados" ? (
            <LeadPanelDados lead={lead} />
          ) : (
            <LeadPanelChat
              lead={lead}
              quickReplies={quickReplies}
              onSendMessage={onSendMessage}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
