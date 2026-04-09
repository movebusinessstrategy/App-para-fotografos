import React, { useState } from 'react';
import { X, MessageCircle, Copy, ExternalLink } from 'lucide-react';
import { Aniversariante } from '../../types';

interface EnviarMensagemModalProps {
  aniversariante: Aniversariante | null;
  cupom?: string;
  onClose: () => void;
}

const gerarLinkWhatsApp = (telefone: string, mensagem: string) => {
  const n = telefone.replace(/\D/g, '');
  const numero = n.startsWith('55') ? n : `55${n}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
};

export function EnviarMensagemModal({ aniversariante, cupom, onClose }: EnviarMensagemModalProps) {
  if (!aniversariante) return null;

  const desconto = cupom ? `\n\n🎟️ Cupom exclusivo: *${cupom}*\n10% de desconto no seu próximo ensaio!` : '';
  const defaultMsg = `Olá ${aniversariante.clienteNome}! 🎂\n\nPassando para desejar um FELIZ ANIVERSÁRIO para ${aniversariante.tipo === 'MAE' ? 'você' : aniversariante.nome}! 🎉${desconto}\n\nUm grande abraço! ✨`;
  const [mensagem, setMensagem] = useState(defaultMsg);
  const [copied, setCopied] = useState(false);

  const link = gerarLinkWhatsApp(aniversariante.telefone, mensagem);

  const handleCopy = () => {
    navigator.clipboard.writeText(mensagem);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <MessageCircle size={20} className="text-emerald-500" />
            <h2 className="font-bold text-gray-900 dark:text-white">Enviar WhatsApp</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Para: <span className="font-semibold text-gray-900 dark:text-white">{aniversariante.clienteNome}</span></p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{aniversariante.telefone}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Mensagem</label>
            <textarea
              value={mensagem}
              onChange={e => setMensagem(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Copy size={15} />
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <ExternalLink size={15} />
              Abrir WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
