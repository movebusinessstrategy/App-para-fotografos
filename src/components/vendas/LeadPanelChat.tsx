import React, { useEffect, useState } from "react";
import { Phone, Instagram } from "lucide-react";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { QuickReplies } from "./QuickReplies";
import { Lead, QuickReply } from "../../types/vendas";

interface LeadPanelChatProps {
  lead: Lead;
  quickReplies: QuickReply[];
  onSendMessage: (text: string) => void;
}

export function LeadPanelChat({ lead, quickReplies, onSendMessage }: LeadPanelChatProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [lead.id]);

  const channelPill =
    lead.channel === "whatsapp" ? (
      <div className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
        <Phone size={14} />
        WhatsApp
      </div>
    ) : (
      <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-1 text-xs font-semibold text-white">
        <Instagram size={14} />
        Instagram
      </div>
    );

  const handleSend = (text: string) => {
    onSendMessage(text);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {channelPill}
      <div className="flex h-full min-h-[300px] flex-col gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-900">
        <ChatMessages messages={lead.messages} />
        <QuickReplies replies={quickReplies} onSelect={setDraft} />
        <ChatInput value={draft} onChange={setDraft} onSend={handleSend} />
      </div>
    </div>
  );
}
