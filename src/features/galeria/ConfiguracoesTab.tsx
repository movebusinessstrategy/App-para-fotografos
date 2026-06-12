import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ExternalLink, Image as ImageIcon, Link2, Link2Off, Loader2, Plus, Upload, X } from "lucide-react";

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
  deadline_presets: number[];
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
  deadline_presets: [7, 15, 30],
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
    deadline_presets: Array.isArray(s.deadline_presets) && s.deadline_presets.length > 0
      ? s.deadline_presets : [7, 15, 30],
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
      deadline_presets: form.deadline_presets,
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

      <Section title="Armazenamento">
        <ArmazenamentoCard />
      </Section>

      <Section title="Atalhos de prazo">
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1 mb-2">
          Botões rápidos que aparecem no calendário do prazo de seleção (além de "Hoje", que é fixo). Até 6 valores, em dias.
        </p>
        <PresetsEditor presets={form.deadline_presets} onChange={(p) => set("deadline_presets", p)} />
      </Section>

      <Section title="Pagamentos">
        <MercadoPagoConnect
          settings={settings || null}
          onNotify={onNotify}
          onReload={() => refreshApi("/api/gallery-settings")}
        />
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

// ── Armazenamento usado pelas fotos ────────────────────────────────────────

interface StorageInfo {
  total_bytes: number;
  photo_count: number;
  galleries: { id: string; title: string; client_name: string | null; bytes: number; photo_count: number }[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function ArmazenamentoCard() {
  const { data, isLoading } = useApi<StorageInfo>("/api/galleries/storage");

  if (isLoading && !data) {
    return <div className="text-sm text-gray-500 py-2">Calculando…</div>;
  }
  if (!data) {
    return <div className="text-sm text-gray-500 py-2">Não foi possível carregar.</div>;
  }

  const top = data.galleries.slice(0, 5);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="text-3xl font-semibold text-gray-900 dark:text-white">{formatBytes(data.total_bytes)}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 pb-1">
          em {data.photo_count} foto{data.photo_count === 1 ? "" : "s"} · {data.galleries.length} galeria{data.galleries.length === 1 ? "" : "s"}
        </div>
      </div>

      {top.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Maiores galerias</div>
          <ul className="space-y-1">
            {top.map((g) => {
              const pct = data.total_bytes > 0 ? Math.round((g.bytes / data.total_bytes) * 100) : 0;
              return (
                <li key={g.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{g.title}{g.client_name ? ` · ${g.client_name}` : ""}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0">{formatBytes(g.bytes)} ({g.photo_count})</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mt-0.5">
                    <div className="h-full bg-violet-500" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Soma dos originais enviados. Previews com marca d'água adicionam ~10%. Excluir uma galeria libera o espaço dela. Dica: envie em resolução Média ou Baixa pra economizar.
      </p>
    </div>
  );
}

// ── Editor de presets de prazo (dias) ─────────────────────────────────────

function PresetsEditor({ presets, onChange }: { presets: number[]; onChange: (p: number[]) => void }) {
  const [novo, setNovo] = useState("");

  const add = () => {
    const n = parseInt(novo, 10);
    if (!n || n <= 0 || n > 365) return;
    if (presets.includes(n)) { setNovo(""); return; }
    if (presets.length >= 6) return;
    onChange([...presets, n].sort((a, b) => a - b));
    setNovo("");
  };

  const remove = (n: number) => onChange(presets.filter((p) => p !== n));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {presets.length === 0 && (
          <span className="text-xs text-gray-400">Nenhum atalho — só "Hoje" vai aparecer.</span>
        )}
        {presets.map((n) => (
          <span
            key={n}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-semibold"
          >
            +{n} dias
            <button onClick={() => remove(n)} className="hover:text-red-600">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          max={365}
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="Dias (ex.: 7)"
          disabled={presets.length >= 6}
          className="w-32 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={presets.length >= 6}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-lg disabled:opacity-40"
        >
          <Plus size={12} /> Adicionar
        </button>
      </div>
    </div>
  );
}

// ── Botão "Conectar Mercado Pago" via OAuth ────────────────────────────────
//
// Cada estúdio autoriza o CRM Trilha a criar cobranças na conta MP dele.
// Não pede Access Token — só clica e faz login no MP. Token renova
// sozinho via refresh_token.

interface MercadoPagoConnectProps {
  settings: GallerySettings | null;
  onNotify: (kind: ToastKind, message: string) => void;
  onReload: () => void;
}

function MercadoPagoConnect({ settings, onNotify, onReload }: MercadoPagoConnectProps) {
  const [working, setWorking] = useState(false);

  // Detecta retorno do callback do MP (?mp_connected=1 ou ?mp_error=...).
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get("mp_connected");
    const err = url.searchParams.get("mp_error");
    if (ok) {
      onNotify("success", "Mercado Pago conectado!");
      onReload();
      url.searchParams.delete("mp_connected");
      window.history.replaceState({}, "", url.toString());
    } else if (err) {
      const motivos: Record<string, string> = {
        parametros: "Faltaram parâmetros do Mercado Pago.",
        expirou: "A sessão de conexão expirou. Tente de novo.",
        troca: "O Mercado Pago não aceitou a autorização. Tente de novo.",
        storage: "Erro interno ao salvar a conexão.",
        erro: "Erro ao conectar. Tente novamente.",
      };
      onNotify("error", motivos[err] || "Falha ao conectar Mercado Pago.");
      url.searchParams.delete("mp_error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conectar = async () => {
    setWorking(true);
    try {
      const res = await authFetch("/api/oauth/mp/start");
      // Servidor antigo (mid-deploy) devolve a página HTML em vez de JSON —
      // o parse falha. Tratamos como "atualizando" em vez de vazar erro cru.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(
          data?.error ||
          "O servidor está atualizando. Aguarde 1–2 minutos e tente de novo.",
        );
      }
      window.location.href = data.url;
    } catch (e: any) {
      const msg = e?.message?.includes("JSON")
        ? "O servidor está atualizando. Aguarde 1–2 minutos e tente de novo."
        : e?.message || "Não foi possível iniciar a conexão.";
      onNotify("error", msg);
      setWorking(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm("Desconectar o Mercado Pago? Você precisará conectar de novo pra receber pagamentos.")) return;
    setWorking(true);
    try {
      const res = await authFetch("/api/oauth/mp/disconnect", { method: "POST" });
      if (!res.ok) throw new Error();
      onNotify("success", "Mercado Pago desconectado.");
      onReload();
    } catch {
      onNotify("error", "Não foi possível desconectar.");
    } finally {
      setWorking(false);
    }
  };

  // Servidor avisa quando o OAuth não tá configurado (env vars faltando).
  if (settings && settings.mp_oauth_available === false) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
        Pagamentos pela galeria ainda não estão habilitados neste servidor. Avise o suporte.
      </div>
    );
  }

  const connected = !!settings?.mp_connected;

  if (connected) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={12} />
            Mercado Pago conectado
          </span>
          {settings?.mp_email && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Conta: <strong>{settings.mp_email}</strong>
            </span>
          )}
        </div>
        <button
          onClick={desconectar}
          disabled={working}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
        >
          {working ? <Loader2 size={12} className="animate-spin" /> : <Link2Off size={12} />}
          Desconectar
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Os pagamentos das fotos extras caem direto na sua conta. O token renova sozinho.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={conectar}
        disabled={working}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#009EE3] hover:bg-[#008ACA] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
      >
        {working ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
        Conectar Mercado Pago
      </button>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Vamos abrir o site do Mercado Pago. Você faz login com sua conta e autoriza o CRM Trilha a criar cobranças. Os pagamentos caem direto na sua conta.
      </p>
    </div>
  );
}
