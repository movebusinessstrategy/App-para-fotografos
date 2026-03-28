import React, { useEffect, useMemo, useRef } from "react";
import { Check, CheckCheck } from "lucide-react";
import { Message } from "../../types/vendas";

interface ChatMessagesProps {
  messages: Message[];
}

const formatDateLabel = (date: Date) => {
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isSameDay) return "Hoje";
  if (isYesterday) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function ChatMessages({ messages }: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    [messages]
  );

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [sortedMessages]);

  const renderStatus = (status?: Message["status"]) => {
    if (!status) return null;
    if (status === "sent") return <Check size={14} className="text-blue-100" />;
    if (status === "delivered") return <CheckCheck size={14} className="text-blue-100" />;
    return <CheckCheck size={14} className="text-blue-300" />;
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin"
    >
      {sortedMessages.map((message, index) => {
        const previous = sortedMessages[index - 1];
        const currentLabel = formatDateLabel(message.timestamp);
        const needsSeparator =
          !previous ||
          formatDateLabel(previous.timestamp) !== currentLabel;

        return (
          <React.Fragment key={message.id}>
            {needsSeparator && (
              <div className="py-2 text-center text-xs font-medium text-gray-400 dark:text-gray-500">
                {currentLabel}
              </div>
            )}
            <div
              className={`flex ${
                message.isFromClient ? "justify-start" : "justify-end"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm ${
                  message.isFromClient
                    ? "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-50"
                    : "bg-blue-500 text-white"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {message.content}
                </p>
                <div
                  className={`mt-1 flex items-center gap-1 text-[11px] ${
                    message.isFromClient ? "text-gray-500 dark:text-gray-300" : "text-blue-100"
                  }`}
                >
                  <span>{formatTime(message.timestamp)}</span>
                  {!message.isFromClient && renderStatus(message.status)}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
