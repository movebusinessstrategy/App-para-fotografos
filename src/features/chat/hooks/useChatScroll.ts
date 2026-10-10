import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Message } from '../types';

/** Mantém o fim visível sem interromper quem está lendo mensagens antigas. */
export function useChatScroll(key: string, loading: boolean, messages: Message[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openedKey = useRef('');
  const initialized = useRef(false);
  const pinned = useRef(true);
  const lastSeenId = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lastMessage = messages.at(-1);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = containerRef.current;
    if (!el) return;
    pinned.current = true;
    if (behavior === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
    setShowScrollButton(false);
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance < 150;
    setShowScrollButton(distance > 200);
  }, []);

  useLayoutEffect(() => {
    if (openedKey.current !== key) {
      openedKey.current = key;
      initialized.current = false;
      lastSeenId.current = null;
      pinned.current = true;
      setShowScrollButton(false);
    }
    if (loading || !lastMessage) return;
    if (!initialized.current) {
      initialized.current = true;
      scrollToBottom();
    } else if (lastMessage.message_id !== lastSeenId.current) {
      if (pinned.current || lastMessage.from_me) scrollToBottom();
      else onScroll();
    }
    lastSeenId.current = lastMessage.message_id;
  }, [key, loading, lastMessage?.message_id, lastMessage?.from_me, scrollToBottom, onScroll]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (initialized.current && pinned.current) scrollToBottom();
    });
    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [key, scrollToBottom]);

  return { containerRef, contentRef, onScroll, scrollToBottom, showScrollButton };
}
