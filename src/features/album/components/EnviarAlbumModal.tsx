import { useState } from "react";
import {
  CheckCircle2, Copy, Loader2, Mail, MessageCircle, Send, X, XCircle,
} from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import type { Album, AlbumSendResult } from "../types";

interface EnviarAlbumModalProps {
  album: Album;
  onClose: () => void;
  onSent: () => void;
  onNotify: (kind: "success" | "error", msg: string) => void;
}

// Modal de envio da prévia do álbum pra cliente. Resultado REAL por canal.
export function EnviarAlbumModal({ album, onClose, onSent, onNotify }: EnviarAlbumModalProps) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AlbumSendResult | null>(null);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("success", `${label} copiado!`);
    } catch {
      onNotify("error", "Não foi possível copiar.");
    }
  };

  const enviar = async () => {
    setSending(true);
    try {
      const res = await authFetch(`/api/albums/${album.id}/send`, { method: "POST" });
      const data: AlbumSendResult | null = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data as { error?: string } | null)?.error || "O servidor está atualizando. Tente em 1–2 minutos.");
      }
      setResult(data);
      if (data.ok) onSent();
    } catch (e) {
      onNotify("error", e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setSending(false);
    }
  };

  const semContato = !album.client_email && !album.client_phone;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-transparent dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Send size={16} className="text-violet-600 dark:text-violet-400" />
            Enviar prévia pra cliente
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        {result ? (
          <div className="p-4 space-y-3">
            <CanalResultado icon={<MessageCircle size={14} />} label="WhatsApp" sent={result.whatsapp?.sent} error={result.whatsapp?.error} />
            <CanalResultado icon={<Mail size={14} />} label="E-mail" sent={result.email?.sent} error={result.email?.error} />
            <div className="flex items-center gap-2 text-xs">
              <input
                readOnly
                value={result.link}
                onFocus={(e) => e.target.select()}
                className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200"
              />
              <button onClick={() => copy(result.link, "Link")} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <Copy size={14} />
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100"
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              A cliente recebe um link pra ver a prévia do álbum e aprovar.
              {album.allow_client_edit && " Ela também pode reorganizar as fotos antes de aprovar."}
            </p>
            <div className="space-y-2 text-sm">
              <ContatoLinha icon={<MessageCircle size={14} className="text-emerald-600" />} label="WhatsApp" valor={album.client_phone} />
              <ContatoLinha icon={<Mail size={14} className="text-blue-600" />} label="E-mail" valor={album.client_email} />
            </div>
            {semContato && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Sem e-mail nem WhatsApp da cliente. Você ainda recebe o link pra mandar manualmente.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={enviar}
                disabled={sending}
                className="flex-1 py-2 inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? "Enviando..." : "Enviar agora"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContatoLinha({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
      {icon}
      <span className="font-medium">{label}</span>
      <span className="text-gray-500 dark:text-gray-400 truncate ml-auto">{valor || "não informado"}</span>
    </div>
  );
}

function CanalResultado({ icon, label, sent, error }: {
  icon: React.ReactNode; label: string; sent?: boolean; error?: string;
}) {
  return (
    <div className={
      "rounded-lg border p-3 flex items-start gap-3 " +
      (sent
        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
        : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20")
    }>
      {sent
        ? <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 mt-0.5" />
        : <XCircle size={16} className="text-red-500 dark:text-red-400 mt-0.5" />}
      <div className="min-w-0">
        <div className="text-sm font-medium flex items-center gap-1.5">{icon} {label}: {sent ? "enviado ✓" : "NÃO enviado"}</div>
        {!sent && error && <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">{error}</div>}
      </div>
    </div>
  );
}
