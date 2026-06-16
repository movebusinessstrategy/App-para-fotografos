import React, { useEffect, useRef, useState, useCallback } from "react";
import { Send, Loader2, Phone, MessageCircle, Check, CheckCheck, Clock, Paperclip, Mic, X, FileText, Smile } from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { startVisiblePoll } from "../../../utils/poll";

const EMOJI_LIST = [
  "😀","😂","🤣","😍","😘","🥰","😊","😉","😎","🤩","😢","😭","🥺","😱","🤔","🙄","😏","🤗","😤",
  "🙏","👍","👎","❤️","🔥","✨","💯","🎉","🎊","🙌","👏","💪","💕","💖","💗","💓","⭐","🌟","✅",
  "😅","😆","🤭","😋","😜","🤪","😝","🤑","🤠","🥳","🤡","💀","👻","💩","🌹","🌺","🌸","🍀","🌈",
  "🌙","☀️","🌊","🐶","🐱","🦋","🌻","🍕","🍔","🍦","☕","🎵","🎶","📷","📸","💎","🏆","🎁","📱",
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-3 z-30"
      style={{ width: 280 }}
    >
      <div className="grid grid-cols-10 gap-0.5">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="w-7 h-7 flex items-center justify-center text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Message {
  message_id: string;
  body: string;
  from_me: boolean;
  timestamp: string;
  type?: string;
  status?: string;
  media_url?: string | null;
}

interface Props {
  phone: string;
  contactName?: string | null;
  showHeader?: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toDateString();
  const dStr = d.toDateString();
  const yesterdayStr = new Date(now.getTime() - 86400000).toDateString();

  if (dStr === todayStr) return "Hoje";
  if (dStr === yesterdayStr) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function groupByDate(messages: Message[]) {
  const groups: { label: string; messages: Message[] }[] = [];
  let currentLabel = "";
  for (const msg of messages) {
    const label = formatDate(msg.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }
  return groups;
}

function MessageTick({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();

  if (s === "sending" || s === "pending") {
    return <Clock size={11} className="inline-block ml-1 opacity-60" />;
  }
  if (s === "sent" || s === "server_ack") {
    return <Check size={11} className="inline-block ml-1 opacity-70" />;
  }
  if (s === "delivered" || s === "delivery_ack") {
    return <CheckCheck size={11} className="inline-block ml-1 opacity-70" />;
  }
  if (s === "read" || s === "played") {
    return <CheckCheck size={11} className="inline-block ml-1 text-blue-300" />;
  }
  return null;
}

function Avatar({ name, phone, photoUrl }: { name?: string | null; phone: string; photoUrl?: string | null }) {
  const initials = (name || phone).slice(0, 2).toUpperCase();
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name || phone}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-gold-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatRecTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

function getMediaType(file: File): "image" | "video" | "audio" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function ChatView({ phone, contactName, showHeader = true }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [waveHeights, setWaveHeights] = useState<number[]>(Array(8).fill(4));

  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const pollRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const res = await authFetch(`/api/inbox/messages/${cleanPhone}?limit=80`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setMessages((prev) => {
            const dbIds = new Set(data.map((m: Message) => m.message_id));
            // Mantém mensagens otimistas (tmp-) que ainda não chegaram no banco
            const pendingOptimistic = prev.filter(
              (m) => m.message_id.startsWith("tmp-") && !dbIds.has(m.message_id)
            );
            return [...data, ...pendingOptimistic].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
        }
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [phone]);

  // Busca foto de perfil uma vez por contato
  useEffect(() => {
    setPhotoUrl(null);
    const cleanPhone = phone.replace(/\D/g, "");
    authFetch(`/api/inbox/profile-picture/${cleanPhone}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.url) setPhotoUrl(d.url); })
      .catch(() => {});
  }, [phone]);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    authFetch(`/api/inbox/mark-read/${phone}`, { method: "POST" }).catch(() => {});

    pollRef.current = startVisiblePoll(() => fetchMessages(true), 8000);
    return () => { if (pollRef.current) pollRef.current(); };
  }, [phone, fetchMessages]);

  useEffect(() => {
    // Só scrolla quando chegar mensagem nova (não em cada poll sem novidades)
    if (messages.length > prevMsgCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "42px";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview.url);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setText("");

    const tmpId = `tmp-${Date.now()}`;
    const now = new Date().toISOString();
    const tmpMsg: Message = { message_id: tmpId, body: msg, from_me: true, timestamp: now, status: "sending" };
    setMessages((prev) => [...prev, tmpMsg]);

    try {
      const res = await authFetch("/api/inbox/send", {
        method: "POST",
        body: JSON.stringify({ phone: phone.replace(/\D/g, ""), text: msg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
        setText(msg);
        alert(`Erro ao enviar: ${err.error || res.statusText}`);
        return;
      }
      setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
      fetchMessages(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
      setText(msg);
      alert("Erro de conexão ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  };

  const sendMedia = async (file: File, caption?: string) => {
    setSending(true);
    const previewUrl = URL.createObjectURL(file);
    const mediaType = getMediaType(file);
    const tmpId = `tmp-${Date.now()}`;
    const now = new Date().toISOString();
    const tmpMsg: Message = {
      message_id: tmpId, body: caption || "", from_me: true,
      timestamp: now, status: "sending", type: mediaType, media_url: previewUrl,
    };
    setMessages((prev) => [...prev, tmpMsg]);
    setMediaPreview(null);
    setText("");

    try {
      const mediaBase64 = await fileToBase64(file);
      const res = await authFetch("/api/inbox/send-media", {
        method: "POST",
        body: JSON.stringify({
          phone: phone.replace(/\D/g, ""),
          mediaBase64,
          mimetype: file.type,
          filename: file.name,
          caption: caption || "",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
        alert(`Erro ao enviar mídia: ${err.error || res.statusText}`);
        return;
      }
      setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
      fetchMessages(true);
    } catch {
      setMessages((prev) => prev.filter((m) => m.message_id !== tmpId));
      alert("Erro de conexão ao enviar mídia.");
    } finally {
      setSending(false);
      URL.revokeObjectURL(previewUrl);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMediaPreview({ file, url, type: getMediaType(file) });
    e.target.value = "";
  };

  const stopWaveform = () => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setWaveHeights(Array(8).fill(4));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Waveform real via AudioContext
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = audioCtx;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const heights = Array.from({ length: 8 }, (_, i) => {
          const val = data[Math.floor((i * data.length) / 8)] ?? 0;
          return Math.max(4, Math.round((val / 255) * 28));
        });
        setWaveHeights(heights);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopWaveform();
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = recorder.mimeType?.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type });
        await sendMedia(file);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      alert("Não foi possível acessar o microfone.");
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    stopWaveform();
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current!.ondataavailable = null;
      mediaRecorderRef.current!.onstop = null;
      mediaRecorderRef.current?.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const groups = groupByDate(messages);

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      {showHeader && (
        <div className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <Avatar name={contactName} phone={phone} photoUrl={photoUrl} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
              {contactName || phone}
            </p>
            {contactName && (
              <p className="text-xs text-gray-400">{phone}</p>
            )}
          </div>
          <a
            href={`https://wa.me/${phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gold-600 transition-colors"
            title="Abrir no WhatsApp"
          >
            <Phone size={16} />
          </a>
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-gold-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <MessageCircle size={32} strokeWidth={1.5} />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              {/* Separador de data */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full whitespace-nowrap">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {group.messages.map((msg) => (
                <div
                  key={msg.message_id}
                  className={`flex mb-1 ${msg.from_me ? "justify-end" : "justify-start"}`}
                >
                  {!msg.from_me && (
                    <div className="mr-1.5 mt-auto mb-0.5 flex-shrink-0">
                      <Avatar name={contactName} phone={phone} photoUrl={photoUrl} />
                    </div>
                  )}

                  <div
                    className={`max-w-[68%] rounded-2xl text-sm leading-relaxed shadow-sm overflow-hidden ${
                      msg.from_me
                        ? "bg-gold-600 text-white rounded-tr-sm"
                        : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700"
                    }`}
                  >
                    {/* Imagem */}
                    {msg.media_url && msg.type === "image" && (
                      <button
                        onClick={() => setLightboxUrl(msg.media_url!)}
                        className="block w-full cursor-zoom-in"
                      >
                        <img
                          src={msg.media_url}
                          alt="imagem"
                          className="max-w-full max-h-64 object-cover block w-full"
                          style={{ borderRadius: "12px 12px 0 0" }}
                        />
                      </button>
                    )}
                    {/* Áudio */}
                    {msg.media_url && msg.type === "audio" && (
                      <audio controls src={msg.media_url} className="w-full px-2 py-1" />
                    )}
                    {/* Documento */}
                    {msg.media_url && msg.type === "document" && (
                      <a
                        href={msg.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 hover:opacity-80 transition-opacity"
                      >
                        <FileText size={18} className={msg.from_me ? "text-gold-200" : "text-gray-400"} />
                        <span className="text-xs underline truncate max-w-[160px]">
                          {msg.body || "Documento"}
                        </span>
                      </a>
                    )}
                    {/* Texto / legenda */}
                    <div className="px-3.5 py-2">
                      {msg.body && msg.body !== `[${msg.type}]` && msg.type !== "document" && (
                        <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.body}</p>
                      )}
                      {!msg.body && !msg.media_url && (
                        <p className="italic opacity-60 text-xs">[{msg.type || "mensagem"}]</p>
                      )}
                      {/* Hora + tick */}
                      <p className={`text-[10px] mt-1 flex items-center justify-end gap-0.5 ${
                        msg.from_me ? "text-gold-200" : "text-gray-400"
                      }`}>
                        {formatTime(msg.timestamp)}
                        {msg.from_me && <MessageTick status={msg.status} />}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
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
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow-lg flex items-center justify-center text-gray-700 dark:text-gray-200 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Media preview */}
        {mediaPreview && (
          <div className="px-4 pt-3 pb-1">
            <div className="relative inline-block">
              {mediaPreview.type === "image" ? (
                <img
                  src={mediaPreview.url}
                  alt="preview"
                  className="max-h-32 rounded-xl object-cover shadow"
                />
              ) : mediaPreview.type === "audio" ? (
                <audio controls src={mediaPreview.url} className="max-w-full" />
              ) : (
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2.5">
                  <FileText size={20} className="text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 dark:text-gray-300 max-w-[200px] truncate">
                    {mediaPreview.file.name}
                  </span>
                </div>
              )}
              <button
                onClick={() => { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); }}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            {mediaPreview.type === "image" && (
              <p className="text-[10px] text-gray-400 mt-1">Legenda no campo abaixo (opcional)</p>
            )}
          </div>
        )}

        <div className="px-4 py-3">
          {recording ? (
            /* Recording UI with waveform */
            <div className="flex items-center gap-2">
              <button
                onClick={cancelRecording}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-red-500 transition-colors flex-shrink-0"
                title="Cancelar gravação"
              >
                <X size={16} />
              </button>
              <div className="flex-1 flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-2">
                {/* Waveform real via AudioContext */}
                <div className="flex items-end gap-[3px] h-8">
                  {waveHeights.map((h, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-full bg-red-500 transition-all duration-75"
                      style={{ height: h }}
                    />
                  ))}
                </div>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">
                  {formatRecTime(recordingTime)}
                </span>
              </div>
              <button
                onClick={stopRecording}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors flex-shrink-0"
                title="Parar e enviar"
              >
                <Send size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* Paperclip button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || recording}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors flex-shrink-0"
                title="Enviar arquivo ou imagem"
              >
                <Paperclip size={18} />
              </button>

              {/* Text input + emoji */}
              <div className="flex-1 relative flex items-end">
                {showEmoji && (
                  <EmojiPicker
                    onSelect={(emoji) => {
                      setText((t) => t + emoji);
                      textareaRef.current?.focus();
                    }}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
                <button
                  onClick={() => setShowEmoji(v => !v)}
                  className={`absolute right-3 bottom-2.5 p-0.5 rounded-lg transition-colors ${
                    showEmoji
                      ? "text-gold-500"
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                  title="Emojis"
                >
                  <Smile size={17} />
                </button>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (mediaPreview) {
                        sendMedia(mediaPreview.file, text.trim() || undefined);
                      } else {
                        handleSend();
                      }
                    }
                    if (e.key === "Escape") setShowEmoji(false);
                  }}
                  placeholder={mediaPreview ? "Adicionar legenda..." : "Digite uma mensagem..."}
                  rows={1}
                  className="w-full resize-none bg-gray-100 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-200 rounded-xl px-4 py-2.5 pr-10 outline-none placeholder-gray-400 overflow-hidden"
                  style={{ minHeight: "42px", maxHeight: "128px" }}
                />
              </div>

              {/* Send / Mic button */}
              {mediaPreview || text.trim() ? (
                <button
                  onClick={() => {
                    if (mediaPreview) {
                      sendMedia(mediaPreview.file, text.trim() || undefined);
                    } else {
                      handleSend();
                    }
                  }}
                  disabled={sending}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-40 text-white transition-colors flex-shrink-0"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  disabled={sending}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors flex-shrink-0"
                  title="Gravar áudio"
                >
                  <Mic size={18} />
                </button>
              )}
            </div>
          )}
          {!recording && (
            <p className="text-[10px] text-gray-400 mt-1 ml-1">
              Enter para enviar · Shift+Enter para nova linha
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
