import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatComposer } from './ChatComposer';

interface Props {
  phone: string;
  contactName: string | null;
  onBack?: () => void;
}

export function ActiveChat({ phone, contactName, onBack }: Props) {
  const { messages, loading, sending, photoUrl, send, sendMedia } = useChat(phone);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleSendText = async (text: string) => {
    try {
      await send(text);
    } catch (err) {
      alert(`Erro ao enviar: ${err instanceof Error ? err.message : 'Tente novamente.'}`);
    }
  };

  const handleSendMedia = async (file: File, caption?: string) => {
    try {
      await sendMedia(file, caption);
    } catch (err) {
      alert(`Erro ao enviar mídia: ${err instanceof Error ? err.message : 'Tente novamente.'}`);
    }
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      style={{
        background: 'var(--color-chat-canvas)',
        fontFamily: "'Instrument Sans', sans-serif",
      }}
    >
      <ChatHeader
        phone={phone}
        contactName={contactName}
        photoUrl={photoUrl}
        onBack={onBack}
      />

      <MessageList
        messages={messages}
        loading={loading}
        contactName={contactName}
        phone={phone}
        photoUrl={photoUrl}
        onImageClick={setLightboxUrl}
      />

      <ChatComposer
        onSendText={handleSendText}
        onSendMedia={handleSendMedia}
        sending={sending}
      />

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-[90%] max-h-[85%]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxUrl}
              alt="imagem ampliada"
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg"
              style={{ background: '#1F1F1D', color: '#ECEAE3', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
