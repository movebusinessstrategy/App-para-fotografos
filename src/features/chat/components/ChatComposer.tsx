import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Loader2,
  Paperclip,
  Mic,
  Smile,
  X,
  FileText,
} from 'lucide-react';

const EMOJIS = [
  '😀','😂','🤣','😍','😘','🥰','😊','😉','😎','🤩','😢','😭','🥺','😱','🤔',
  '🙄','😏','🤗','😤','🙏','👍','👎','❤️','🔥','✨','💯','🎉','🎊','🙌','👏',
  '💪','💕','💖','💗','💓','⭐','🌟','✅','😅','😆','🤭','😋','😜','🤪','😝',
  '🤑','🤠','🥳','🌹','🌸','🍀','🌈','🌙','☀️','📷','📸','💎','🏆','🎁','📱',
];

function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (e: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 rounded-2xl shadow-2xl p-3 z-30"
      style={{
        width: 280,
        background: 'var(--color-chat-elevated)',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <div className="grid grid-cols-10 gap-0.5">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="w-7 h-7 flex items-center justify-center text-base rounded-lg transition-colors hover:bg-white/10"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  onSendText: (text: string) => void;
  onSendMedia: (file: File, caption?: string) => void;
  sending: boolean;
}

const formatRecTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60)
    .toString()
    .padStart(2, '0')}`;

export function ChatComposer({ onSendText, onSendMedia, sending }: Props) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{
    file: File;
    url: string;
    type: string;
  } | null>(null);

  // Gravação de áudio
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [waveHeights, setWaveHeights] = useState<number[]>(Array(8).fill(4));

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '42px';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview.url);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleSend = () => {
    if (mediaPreview) {
      onSendMedia(mediaPreview.file, text.trim() || undefined);
      setMediaPreview(null);
      setText('');
      return;
    }
    if (!text.trim()) return;
    onSendText(text.trim());
    setText('');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('audio/')
      ? 'audio'
      : 'document';
    setMediaPreview({ file, url: URL.createObjectURL(file), type });
    e.target.value = '';
  };

  const stopWaveform = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setWaveHeights(Array(8).fill(4));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = audioCtx;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        setWaveHeights(
          Array.from({ length: 8 }, (_, i) => {
            const val = data[Math.floor((i * data.length) / 8)] ?? 0;
            return Math.max(4, Math.round((val / 255) * 28));
          })
        );
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopWaveform();
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const ext = recorder.mimeType?.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `audio-${Date.now()}.${ext}`, {
          type: blob.type,
        });
        onSendMedia(file);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingTime((t) => t + 1),
        1000
      );
    } catch {
      alert('Não foi possível acessar o microfone.');
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
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current!.ondataavailable = null;
      mediaRecorderRef.current!.onstop = null;
      mediaRecorderRef.current?.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const canSend = !!(text.trim() || mediaPreview);

  return (
    <div
      className="flex-shrink-0"
      style={{
        background: 'var(--color-chat-panel)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Preview de mídia */}
      {mediaPreview && (
        <div className="px-4 pt-3 pb-1">
          <div className="relative inline-block">
            {mediaPreview.type === 'image' ? (
              <img
                src={mediaPreview.url}
                alt="preview"
                className="max-h-28 rounded-xl object-cover shadow-lg"
              />
            ) : mediaPreview.type === 'audio' ? (
              <audio controls src={mediaPreview.url} className="max-w-full" />
            ) : (
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <FileText size={18} className="flex-shrink-0" style={{ color: '#9A9A93' }} />
                <span
                  className="text-xs max-w-[180px] truncate"
                  style={{ color: '#ECEAE3' }}
                >
                  {mediaPreview.file.name}
                </span>
              </div>
            )}
            <button
              onClick={() => {
                URL.revokeObjectURL(mediaPreview.url);
                setMediaPreview(null);
              }}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-white transition-colors"
              style={{ background: '#6A6A65' }}
            >
              <X size={10} />
            </button>
          </div>
          {mediaPreview.type === 'image' && (
            <p className="text-[10px] mt-1" style={{ color: '#6A6A65' }}>
              Legenda no campo abaixo (opcional)
            </p>
          )}
        </div>
      )}

      <div className="px-4 py-3">
        {recording ? (
          /* UI de gravação */
          <div className="flex items-center gap-2">
            <button
              onClick={cancelRecording}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#9A9A93' }}
              title="Cancelar"
            >
              <X size={16} />
            </button>
            <div
              className="flex-1 flex items-center gap-3 rounded-xl px-4 py-2"
              style={{
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.25)',
              }}
            >
              <div className="flex items-end gap-[3px] h-7">
                {waveHeights.map((h, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-red-500 transition-all duration-75"
                    style={{ height: h }}
                  />
                ))}
              </div>
              <span className="text-sm font-semibold tabular-nums text-red-400">
                {formatRecTime(recordingTime)}
              </span>
            </div>
            <button
              onClick={stopRecording}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors flex-shrink-0"
              title="Enviar"
            >
              <Send size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Paperclip */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors flex-shrink-0 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#9A9A93' }}
              title="Enviar arquivo"
            >
              <Paperclip size={17} />
            </button>

            {/* Textarea + emoji */}
            <div className="flex-1 relative flex items-end">
              {showEmoji && (
                <EmojiPicker
                  onSelect={(e) => {
                    setText((t) => t + e);
                    textareaRef.current?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
              <button
                onClick={() => setShowEmoji((v) => !v)}
                className="absolute right-3 bottom-2.5 p-0.5 rounded-lg transition-colors"
                style={{ color: showEmoji ? '#B5C19D' : '#6A6A65' }}
                title="Emojis"
              >
                <Smile size={16} />
              </button>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                  if (e.key === 'Escape') setShowEmoji(false);
                }}
                placeholder={mediaPreview ? 'Adicionar legenda...' : 'Digite uma mensagem...'}
                rows={1}
                className="w-full resize-none text-sm rounded-xl px-4 py-2.5 pr-10 outline-none overflow-hidden placeholder-[#6A6A65]"
                style={{
                  minHeight: '42px',
                  maxHeight: '128px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#ECEAE3',
                  fontFamily: "'Instrument Sans', sans-serif",
                }}
              />
            </div>

            {/* Send / Mic */}
            {canSend ? (
              <button
                onClick={handleSend}
                disabled={sending}
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors flex-shrink-0 disabled:opacity-40"
                style={{ background: '#B5C19D', color: '#0E0E0C' }}
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={sending}
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors flex-shrink-0 disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#9A9A93' }}
                title="Gravar áudio"
              >
                <Mic size={17} />
              </button>
            )}
          </div>
        )}

        {!recording && (
          <p className="text-[10px] mt-1.5 ml-1" style={{ color: '#6A6A65' }}>
            Enter para enviar · Shift+Enter para nova linha
          </p>
        )}
      </div>
    </div>
  );
}
