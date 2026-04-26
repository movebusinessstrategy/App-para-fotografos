import React from 'react';
import { Phone, ArrowLeft } from 'lucide-react';
import { Avatar } from './shared/Avatar';

interface Props {
  phone: string;
  contactName: string | null;
  photoUrl: string | null;
  onBack?: () => void;
}

export function ChatHeader({ phone, contactName, photoUrl, onBack }: Props) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
      style={{
        background: 'var(--color-chat-panel)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontFamily: "'Instrument Sans', sans-serif",
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg transition-colors md:hidden"
          style={{ color: '#9A9A93' }}
        >
          <ArrowLeft size={18} />
        </button>
      )}

      <Avatar phone={phone} name={contactName} photoUrl={photoUrl} size="md" />

      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold truncate"
          style={{ color: '#ECEAE3', fontFamily: "'Instrument Serif', serif" }}
        >
          {contactName || phone}
        </p>
        {contactName && (
          <p className="text-xs truncate" style={{ color: '#6A6A65' }}>
            {phone}
          </p>
        )}
      </div>

      <a
        href={`https://wa.me/${phone.replace(/\D/g, '')}`}
        target="_blank"
        rel="noopener noreferrer"
        className="p-2 rounded-lg transition-colors flex-shrink-0"
        style={{ color: '#6A6A65' }}
        title="Abrir no WhatsApp"
      >
        <Phone size={15} />
      </a>
    </div>
  );
}
