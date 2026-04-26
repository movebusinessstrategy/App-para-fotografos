import React from 'react';

export function TypingIndicator() {
  return (
    <div
      className="inline-flex items-center gap-1 px-3.5 py-2.5 rounded-2xl rounded-tl-sm"
      style={{ background: 'var(--color-chat-panel2)' }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: '#9A9A93',
            animation: 'typing-dot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
