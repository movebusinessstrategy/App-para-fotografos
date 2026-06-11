import React, { useEffect, useRef, useState } from "react";
import { Droplet, Image as ImageIcon, Loader2, Save, Type } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { GallerySettings } from "../types";
import { ToastKind } from "../Toast";
import { Bloco, Campo, SecaoHeader } from "./DadosSection";

interface MarcaDaguaSectionProps {
  onNotify: (kind: ToastKind, msg: string) => void;
}

// A marca d'água é GLOBAL por estúdio (não por galeria), porque é gravada
// nas fotos no upload. Essa seção edita exatamente o mesmo recurso da aba
// Configurações principal — só que mostrada aqui dentro da galeria pra
// quem quiser ajustar sem sair daqui.
export function MarcaDaguaSection({ onNotify }: MarcaDaguaSectionProps) {
  const [settings, setSettings] = useState<GallerySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/gallery-settings");
        if (res.ok) {
          const j = await res.json();
          setSettings(j.settings || {});
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = <K extends keyof GallerySettings>(k: K, v: GallerySettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  const handleLogoFile = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      onNotify("error", "Logo precisa ter no máximo 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update("watermark_logo_path", "pending");
        setSettings((s) => (s ? { ...s, watermark_logo_url: reader.result as string } : s));
      }
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const payload: any = {
        watermark_type: settings.watermark_type || "text",
        watermark_text: settings.watermark_text || null,
        watermark_opacity: Number(settings.watermark_opacity ?? 0.3),
        watermark_include_client_name: !!settings.watermark_include_client_name,
      };
      if (settings.watermark_logo_path === "pending" && settings.watermark_logo_url?.startsWith("data:")) {
        payload.watermark_logo_base64 = settings.watermark_logo_url;
      }
      const res = await authFetch("/api/gallery-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      onNotify("success", "Marca d'água atualizada. As próximas fotos enviadas usam essa configuração.");
    } catch {
      onNotify("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="space-y-5">
        <SecaoHeader titulo="Marca d'água" />
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-sm text-gray-500">Carregando…</div>
      </div>
    );
  }

  const type = settings.watermark_type || "text";
  const opacity = Math.round((Number(settings.watermark_opacity ?? 0.3)) * 100);

  return (
    <div className="space-y-5">
      <SecaoHeader
        titulo="Marca d'água"
        descricao="Aplicada nas fotos no momento do upload. Vale pra todas as galerias do estúdio."
      />

      <Bloco titulo="Tipo de marca">
        <div className="grid grid-cols-2 gap-2">
          {([
            { v: "text" as const, icon: Type, label: "Texto" },
            { v: "logo" as const, icon: ImageIcon, label: "Logo" },
          ]).map(({ v, icon: Icon, label }) => (
            <button
              key={v} onClick={() => update("watermark_type", v)}
              className={
                "p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 " +
                (type === v
                  ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-600/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
              }
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </Bloco>

      {type === "text" && (
        <Bloco titulo="Texto">
          <Campo
            label="Texto da marca"
            value={settings.watermark_text || ""}
            onChange={(v) => update("watermark_text", v)}
            placeholder="Nome do estúdio"
          />
        </Bloco>
      )}

      {type === "logo" && (
        <Bloco titulo="Logo">
          <div className="flex items-start gap-4">
            <div className="w-28 h-28 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
              {settings.watermark_logo_url ? (
                <img src={settings.watermark_logo_url} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <ImageIcon size={28} className="text-gray-300" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <button
                onClick={() => logoInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm font-semibold rounded-lg"
              >
                <ImageIcon size={14} /> {settings.watermark_logo_url ? "Trocar logo" : "Enviar logo"}
              </button>
              <input
                ref={logoInputRef} type="file" accept="image/png,image/jpeg" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                PNG ou JPG, até 2MB. Fundo transparente fica melhor pra PNG.
              </p>
            </div>
          </div>
        </Bloco>
      )}

      <Bloco titulo="Intensidade">
        <div className="space-y-2">
          <input
            type="range" min={5} max={60} step={5} value={opacity}
            onChange={(e) => update("watermark_opacity", Number(e.target.value) / 100)}
            className="w-full accent-violet-600"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>Discreta · 5%</span>
            <strong>{opacity}%</strong>
            <span>Bem visível · 60%</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
          <input
            type="checkbox" checked={!!settings.watermark_include_client_name}
            onChange={(e) => update("watermark_include_client_name", e.target.checked)}
            className="w-4 h-4 accent-violet-600"
          />
          <span>Incluir o nome da cliente na marca (rastreável)</span>
        </label>
      </Bloco>

      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
        <strong>Atenção:</strong> a marca é gravada nas fotos no upload. As que já foram processadas mantêm a marca antiga — só vale pras próximas que você subir.
      </div>

      <div className="flex justify-end">
        <button
          onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar marca d'água
        </button>
      </div>
      <span className="hidden"><Droplet /></span>
    </div>
  );
}
