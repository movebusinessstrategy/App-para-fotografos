import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { useApi, refreshApi } from "../../utils/useApi";
import { GallerySettings } from "./types";
import { ToastKind } from "./Toast";

const INPUT_CLS =
  "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600";

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

interface ConfiguracoesTabProps {
  onNotify: (kind: ToastKind, message: string) => void;
}

interface FormState {
  sender_email: string;
  notify_studio_whatsapp: boolean;
  watermark_type: "text" | "logo";
  watermark_text: string;
  watermark_opacity_pct: number; // 5–60 (%)
  watermark_include_client_name: boolean;
  categories: string[];
  protect_right_click: boolean;
  protect_download: boolean;
  custom_domain: string;
}

const DEFAULT_FORM: FormState = {
  sender_email: "",
  notify_studio_whatsapp: true,
  watermark_type: "text",
  watermark_text: "",
  watermark_opacity_pct: 30,
  watermark_include_client_name: false,
  categories: [],
  protect_right_click: true,
  protect_download: true,
  custom_domain: "",
};

function clampPct(v: number): number {
  return Math.min(60, Math.max(5, v));
}

function formFromSettings(s: GallerySettings): FormState {
  return {
    sender_email: s.sender_email || "",
    notify_studio_whatsapp: s.notify_studio_whatsapp !== false,
    watermark_type: s.watermark_type === "logo" ? "logo" : "text",
    watermark_text: s.watermark_text || "",
    watermark_opacity_pct: clampPct(Math.round((s.watermark_opacity ?? 0.3) * 100)),
    watermark_include_client_name: !!s.watermark_include_client_name,
    categories: s.categories ?? [],
    protect_right_click: s.protect_right_click !== false,
    protect_download: s.protect_download !== false,
    custom_domain: s.custom_domain || "",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

// ─── Aba de Configurações da galeria ──────────────────────────────────────────

export default function ConfiguracoesTab({ onNotify }: ConfiguracoesTabProps) {
  const { data, isLoading } = useApi<{ settings: GallerySettings }>("/api/gallery-settings");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [mpToken, setMpToken] = useState("");
  const [trocandoToken, setTrocandoToken] = useState(false);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Inicializa o form uma vez só — o refresh do SWR não pode sobrescrever edição.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!data?.settings || loadedRef.current) return;
    loadedRef.current = true;
    setForm(formFromSettings(data.settings));
  }, [data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      onNotify("error", "Envie um logo PNG ou JPG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onNotify("error", "O logo deve ter no máximo 2MB.");
      return;
    }
    try {
      setLogoBase64(await readFileAsDataUrl(file));
    } catch {
      onNotify("error", "Não foi possível ler o arquivo.");
    }
  };

  const buildSavePayload = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      sender_email: form.sender_email.trim() || null,
      notify_studio_whatsapp: form.notify_studio_whatsapp,
      watermark_type: form.watermark_type,
      watermark_text: form.watermark_text.trim() || null,
      watermark_opacity: form.watermark_opacity_pct / 100,
      watermark_include_client_name: form.watermark_include_client_name,
      categories: form.categories,
      protect_right_click: form.protect_right_click,
      protect_download: form.protect_download,
      custom_domain: form.custom_domain.trim() || null,
    };
    if (logoBase64) body.watermark_logo_base64 = logoBase64;
    if (mpToken.trim()) body.mp_access_token = mpToken.trim();
    return body;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch("/api/gallery-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSavePayload()),
      });
      if (!res.ok) throw new Error();
      setMpToken("");
      setTrocandoToken(false);
      refreshApi("/api/gallery-settings");
      onNotify("success", "Configurações salvas.");
    } catch {
      onNotify("error", "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  const settings = data?.settings;

  return (
    <div className="max-w-3xl space-y-4">
      <Section title="Notificações">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            E-mail remetente
          </label>
          <input
            type="email"
            value={form.sender_email}
            onChange={(e) => set("sender_email", e.target.value)}
            placeholder="contato@seuestudio.com.br"
            className={INPUT_CLS}
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Remetente dos e-mails enviados pra cliente.
          </p>
        </div>
        <CheckboxRow
          checked={form.notify_studio_whatsapp}
          onChange={(v) => set("notify_studio_whatsapp", v)}
          label="Me avisar no WhatsApp quando a cliente finalizar a seleção"
        />
      </Section>

      <Section title="Marca d'água">
        <div className="flex gap-5">
          <RadioRow
            checked={form.watermark_type === "text"}
            onChange={() => set("watermark_type", "text")}
            label="Texto"
          />
          <RadioRow
            checked={form.watermark_type === "logo"}
            onChange={() => set("watermark_type", "logo")}
            label="Logo"
          />
        </div>

        {form.watermark_type === "text" ? (
          <input
            value={form.watermark_text}
            onChange={(e) => set("watermark_text", e.target.value)}
            placeholder="Nome do estúdio"
            className={INPUT_CLS}
          />
        ) : (
          <LogoUpload preview={logoBase64 || settings?.watermark_logo_url || null} onFile={handleLogoFile} />
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Intensidade da marca
            </label>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {form.watermark_opacity_pct}%
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={60}
            value={form.watermark_opacity_pct}
            onChange={(e) => set("watermark_opacity_pct", clampPct(Number(e.target.value)))}
            className="w-full accent-gold-600"
          />
        </div>

        <CheckboxRow
          checked={form.watermark_include_client_name}
          onChange={(v) => set("watermark_include_client_name", v)}
          label="Incluir o nome da cliente na marca"
        />

        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
          A marca é gravada nas fotos no momento do upload — fotos já processadas mantêm a marca antiga.
        </p>
      </Section>

      <Section title="Categorias de ensaio">
        <CategoriasEditor categories={form.categories} onChange={(c) => set("categories", c)} />
      </Section>

      <Section title="Pagamentos">
        {settings?.mp_access_token_set && (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={12} />
              Mercado Pago conectado
            </span>
            {!trocandoToken && (
              <button
                onClick={() => setTrocandoToken(true)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
              >
                Trocar token
              </button>
            )}
          </div>
        )}
        {(!settings?.mp_access_token_set || trocandoToken) && (
          <input
            type="password"
            value={mpToken}
            onChange={(e) => setMpToken(e.target.value)}
            placeholder="Access Token de produção"
            autoComplete="new-password"
            className={INPUT_CLS}
          />
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Pegue o Access Token de produção em{" "}
          <a
            href="https://www.mercadopago.com.br/developers"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-gold-600 dark:text-gold-400 hover:underline"
          >
            mercadopago.com.br/developers
            <ExternalLink size={10} />
          </a>{" "}
          → Suas integrações → Credenciais.
        </p>
      </Section>

      <Section title="Proteção das fotos">
        <CheckboxRow
          checked={form.protect_right_click}
          onChange={(v) => set("protect_right_click", v)}
          label="Bloquear botão direito"
        />
        <CheckboxRow
          checked={form.protect_download}
          onChange={(v) => set("protect_download", v)}
          label="Bloquear arrastar/salvar imagem"
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          A proteção real é a marca d'água gravada na foto — esses bloqueios só dificultam o salvamento casual.
        </p>
      </Section>

      <Section title="Domínio personalizado">
        <input
          value={form.custom_domain}
          onChange={(e) => set("custom_domain", e.target.value)}
          placeholder="galeria.seuestudio.com.br"
          className={INPUT_CLS}
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Em breve — por enquanto o link da galeria usa crmtrilha.com.br/g/...
        </p>
      </Section>

      <div className="flex items-center justify-end pb-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

// ─── Pedacinhos da aba ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

interface CheckboxRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function CheckboxRow({ checked, onChange, label }: CheckboxRowProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 accent-gold-600"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  );
}

function RadioRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
      <input type="radio" checked={checked} onChange={onChange} className="h-4 w-4 accent-gold-600" />
      {label}
    </label>
  );
}

function LogoUpload({ preview, onFile }: { preview: string | null; onFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {preview ? (
        <img
          src={preview}
          alt="Logo da marca d'água"
          className="h-14 w-14 rounded-lg object-contain bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 p-1"
        />
      ) : (
        <div className="h-14 w-14 rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 flex items-center justify-center text-gray-400">
          <ImageIcon size={18} />
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-xl transition-colors"
        >
          <Upload size={13} />
          Enviar logo
        </button>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">PNG ou JPG, até 2MB.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function CategoriasEditor({ categories, onChange }: { categories: string[]; onChange: (c: string[]) => void }) {
  const [nova, setNova] = useState("");

  const add = () => {
    const v = nova.trim();
    setNova("");
    if (!v) return;
    if (categories.some((c) => c.toLowerCase() === v.toLowerCase())) return;
    onChange([...categories, v]);
  };

  const remove = (cat: string) => onChange(categories.filter((c) => c !== cat));

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <span
            key={cat}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200"
          >
            {cat}
            <button
              onClick={() => remove(cat)}
              className="text-gray-400 hover:text-red-500"
              title={`Remover ${cat}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {categories.length === 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Nenhuma categoria ainda — adicione abaixo (ex.: Gestante, Newborn).
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
          placeholder="Nova categoria"
          className={INPUT_CLS}
        />
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
        >
          <Plus size={13} />
          Adicionar
        </button>
      </div>
    </>
  );
}
