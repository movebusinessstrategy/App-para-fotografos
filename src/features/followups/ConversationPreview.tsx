import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle, MessagesSquare } from 'lucide-react';
import { cn } from '../../utils/cn';
import { api, errorMessage } from './api';
import { formatDayTime, phoneDigits } from './format';
import { MESSAGE_TYPE_LABELS } from './labels';
import type { PreviewMessage } from './types';

function bubbleText(m: PreviewMessage): string {
  const body = String(m.body ?? '').trim();
  if (body) return body;
  return MESSAGE_TYPE_LABELS[m.type] ?? 'Mensagem sem texto';
}

function Bubble({ message }: { message: PreviewMessage }) {
  const mine = message.from_me;
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12px] leading-snug',
        mine
          ? 'bg-gold-50 text-gray-800 dark:bg-gold-900/30 dark:text-gray-100'
          : 'bg-gray-100 text-gray-800 dark:bg-gray-700/70 dark:text-gray-100',
      )}>
        <p className="whitespace-pre-wrap break-words">{bubbleText(message)}</p>
        <p className="mt-0.5 text-right text-[10px] text-gray-400">{formatDayTime(message.timestamp)}</p>
      </div>
    </div>
  );
}

interface Props {
  taskId: number;
  preview: PreviewMessage[];
  phone: string;
}

export function ConversationPreview({ taskId, preview, phone }: Props) {
  const navigate = useNavigate();
  const [full, setFull] = useState<PreviewMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadFull = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.conversation(taskId, 30);
      setFull(Array.isArray(res.messages) ? res.messages : []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const messages = full ?? preview;
  const digits = phoneDigits(phone);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {messages.length === 0
          ? <p className="text-[11px] text-gray-400">Sem prévia da conversa.</p>
          : messages.map((m, i) => <Bubble key={`${m.timestamp}-${i}`} message={m} />)}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2 dark:border-gray-700">
        {!full && (
          <button type="button" onClick={loadFull} disabled={loading}
            className="flex items-center gap-1 text-[11px] font-semibold text-gold-700 hover:text-gold-600 disabled:opacity-60 dark:text-gold-400">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <MessagesSquare size={12} />}
            Ver conversa completa
          </button>
        )}
        {digits && (
          <button type="button" onClick={() => navigate(`/vendas?tab=inbox&phone=${digits}`)}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
            <MessageCircle size={12} />
            Abrir no chat
          </button>
        )}
      </div>
    </div>
  );
}
