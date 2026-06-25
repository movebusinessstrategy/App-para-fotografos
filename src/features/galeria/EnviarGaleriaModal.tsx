import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2, Copy, Loader2, Mail, MessageCircle, Send, X, XCircle,
} from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { Gallery, GallerySettings, SendResult } from "./types";
import { ToastKind } from "./Toast";

interface EnviarGaleriaModalProps {
  gallery: Gallery;
  onClose: () => void;
  onSent: () => void;
  onNotify: (kind: ToastKind, message: string) => void;
}

const PLACEHOLDERS = [
  { tag: "{cliente}", desc: "nome da cliente" },
  { tag: "{titulo}", desc: "título da galeria" },
  { tag: "{link}", desc: "link de acesso" },
  { tag: "{estudio}", desc: "nome do estúdio" },
  { tag: "{prazo}", desc: "prazo de seleção" },
  { tag: "{acesso_email}", desc: "e-mail de login" },
  { tag: "{senha}", desc: "senha de login" },
];

// Modal de envio: texto padrão editável + canais + dados de acesso.
// O resultado mostrado é REAL por canal — se falhou, aparece o motivo.
export function EnviarGaleriaModal({ gallery, onClose, onSent, onNotify }: EnviarGaleriaModalProps) {
  const { data: settingsData } = useApi<{ settings: GallerySettings }>("/api/gallery-settings");
  const template = settingsData?.settings?.send_message_template || "";

  const [message, setMessage] = useState("");
  const [channelEmail, setChannelEmail] = useState(!!gallery.client_email);
  const [channelWhatsApp, setChannelWhatsApp] = useState(!!gallery.client_phone);
  const [includeAccess, setIncludeAccess] = useState(!!gallery.require_login);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  // Semeia o texto com o padrão do estúdio assim que as settings chegarem.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!template || seededRef.current) return;
    seededRef.current = true;
    setMessage(template);
  }, [template]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("success", `${label} copiado!`);
    } catch {
      onNotify("error", "Não foi possível copiar.");
    }
  };

  const enviar = async () => {
    if (!channelEmail && !channelWhatsApp) {
      onNotify("error", "Escolha pelo menos um canal (e-mail ou WhatsApp).");
      return;
    }
    setSending(true);
    try {
      const res = await authFetch(`/api/galleries/${gallery.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim() || undefined,
          channel_email: channelEmail,
          channel_whatsapp: channelWhatsApp,
          include_access: includeAccess,
          save_as_default: saveAsDefault,
        }),
      });
      const data: SendResult | null = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data as any)?.error || "O servidor está atualizando. Tente em 1–2 minutos.");
      }
      setResult(data);
      if (data.ok) onSent();
    } catch (e: any) {
      onNotify("error", e?.message || "Não foi possível enviar.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg border border-transparent dark:border-gray-800 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Send size={16} className="text-brand-600 dark:text-brand-400" />
            Enviar galeria pra cliente
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        {result ? (
          <ResultadoEnvio result={result} onCopy={copy} onClose={onClose} />
        ) : (
          <div className="p-4 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Mensagem
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={9}
                className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-brand-400 resize-y leading-relaxed"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.tag}
                    type="button"
                    title={p.desc}
                    onClick={() => setMessage((m) => m + (m.endsWith("\n") || m === "" ? "" : " ") + p.tag)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/30 font-mono"
                  >
                    {p.tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <CanalCheckbox
                checked={channelWhatsApp}
                onChange={setChannelWhatsApp}
                icon={<MessageCircle size={14} className="text-emerald-600" />}
                label="WhatsApp"
                detail={gallery.client_phone || "sem telefone cadastrado"}
                disabled={!gallery.client_phone}
              />
              <CanalCheckbox
                checked={channelEmail}
                onChange={setChannelEmail}
                icon={<Mail size={14} className="text-blue-600" />}
                label="E-mail"
                detail={gallery.client_email || "sem e-mail cadastrado"}
                disabled={!gallery.client_email}
              />
            </div>

            <label className="flex items-start gap-2 cursor-pointer rounded-lg bg-brand-50/50 dark:bg-brand-900/10 border border-brand-100 dark:border-brand-900/30 p-3">
              <input
                type="checkbox"
                checked={includeAccess}
                onChange={(e) => setIncludeAccess(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand-600"
              />
              <span className="text-sm">
                Incluir dados de acesso (e-mail + senha)
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Gera uma senha nova pro acesso principal e coloca na mensagem — a anterior deixa de valer.
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
                className="w-3.5 h-3.5 accent-brand-600"
              />
              Salvar este texto como padrão do estúdio
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={sending}
                className="flex-1 py-2 inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
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

function CanalCheckbox({ checked, onChange, icon, label, detail, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  label: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label className={
      "flex items-center gap-3 rounded-lg border p-3 transition-colors " +
      (disabled
        ? "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
        : checked
          ? "border-brand-300 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/10 cursor-pointer"
          : "border-gray-200 dark:border-gray-700 cursor-pointer hover:border-gray-300")
    }>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-brand-600"
      />
      {icon}
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400 truncate ml-auto">{detail}</span>
    </label>
  );
}

function ResultadoEnvio({ result, onCopy, onClose }: {
  result: SendResult;
  onCopy: (text: string, label: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="p-4 space-y-3 overflow-y-auto">
      <CanalResultado
        icon={<MessageCircle size={14} />}
        label="WhatsApp"
        sent={result.whatsapp?.sent}
        error={result.whatsapp?.error}
      />
      <CanalResultado
        icon={<Mail size={14} />}
        label="E-mail"
        sent={result.email?.sent}
        error={result.email?.error}
      />

      {result.access && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Dados de acesso enviados (anote, a senha antiga deixou de valer):
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-mono">{result.access.email}</span>
            <button onClick={() => onCopy(result.access!.email, "E-mail")} className="p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded">
              <Copy size={12} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-mono font-bold tracking-wider">{result.access.password}</span>
            <button onClick={() => onCopy(result.access!.password, "Senha")} className="p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded">
              <Copy size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <input
          readOnly
          value={result.link}
          className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200"
          onFocus={(e) => e.target.select()}
        />
        <button onClick={() => onCopy(result.link, "Link")} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
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
  );
}

function CanalResultado({ icon, label, sent, error }: {
  icon: React.ReactNode;
  label: string;
  sent?: boolean;
  error?: string;
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
        {!sent && error && (
          <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">{error}</div>
        )}
      </div>
    </div>
  );
}
