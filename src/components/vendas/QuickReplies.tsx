import React from "react";
import { QuickReply } from "../../types/vendas";

interface QuickRepliesProps {
  replies: QuickReply[];
  onSelect: (content: string) => void;
}

export function QuickReplies({ replies, onSelect }: QuickRepliesProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
      {replies.map((reply) => (
        <button
          key={reply.id}
          onClick={() => onSelect(reply.content)}
          className="whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {reply.title}
        </button>
      ))}
    </div>
  );
}
