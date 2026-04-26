import { useState, useCallback, useRef, useEffect } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Message } from '../types';
import { fetchProfilePicture } from '../utils/profilePicture';

function getMediaType(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function useChat(phone: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const clean = phone.replace(/\D/g, '');
        const res = await authFetch(`/api/inbox/messages/${clean}?limit=80`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setMessages((prev) => {
              const dbIds = new Set(data.map((m: Message) => m.message_id));
              const pending = prev.filter(
                (m) => m.message_id.startsWith('tmp-') && !dbIds.has(m.message_id)
              );
              return [...data, ...pending].sort(
                (a, b) =>
                  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
            });
          }
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [phone]
  );

  useEffect(() => {
    setMessages([]);
    setLoading(true);
    fetchMessages();
    authFetch(`/api/inbox/mark-read/${phone}`, { method: 'POST' }).catch(() => {});
    pollRef.current = setInterval(() => fetchMessages(true), 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phone, fetchMessages]);

  useEffect(() => {
    setPhotoUrl(null);
    fetchProfilePicture(phone).then(setPhotoUrl);
  }, [phone]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setSending(true);

      const tmpId = `tmp-${Date.now()}`;
      const tmpMsg: Message = {
        message_id: tmpId,
        body: trimmed,
        from_me: true,
        timestamp: new Date().toISOString(),
        status: 'sending',
      };
      setMessages((prev) => [...prev, tmpMsg]);

      try {
        const res = await authFetch('/api/inbox/send', {
          method: 'POST',
          body: JSON.stringify({ phone: phone.replace(/\D/g, ''), text: trimmed }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
          throw new Error(err.error || res.statusText);
        }
        setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
        fetchMessages(true);
      } catch (err) {
        // mensagem otimista já removida acima
        throw err;
      } finally {
        setSending(false);
      }
    },
    [phone, sending, fetchMessages]
  );

  const sendMedia = useCallback(
    async (file: File, caption?: string) => {
      setSending(true);
      const previewUrl = URL.createObjectURL(file);
      const mediaType = getMediaType(file);
      const tmpId = `tmp-${Date.now()}`;
      const tmpMsg: Message = {
        message_id: tmpId,
        body: caption || '',
        from_me: true,
        timestamp: new Date().toISOString(),
        status: 'sending',
        type: mediaType,
        media_url: previewUrl,
      };
      setMessages((prev) => [...prev, tmpMsg]);

      try {
        const mediaBase64 = await fileToBase64(file);
        const res = await authFetch('/api/inbox/send-media', {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.replace(/\D/g, ''),
            mediaBase64,
            mimetype: file.type,
            filename: file.name,
            caption: caption || '',
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
          throw new Error(err.error || res.statusText);
        }
        setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
        fetchMessages(true);
      } catch (err) {
        throw err;
      } finally {
        setSending(false);
        URL.revokeObjectURL(previewUrl);
      }
    },
    [phone, fetchMessages]
  );

  return { messages, loading, sending, photoUrl, send, sendMedia };
}
