import React, { useEffect, useState } from "react";
import { Heart, Loader2, Save } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { Gallery } from "../types";
import { ToastKind } from "../Toast";
import { Bloco, SecaoHeader } from "./DadosSection";

interface DesignSectionProps {
  gallery: Gallery & { primary_color?: string; cover_layout?: string; font_family?: string };
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

const LAYOUTS = [
  { id: "classic",   name: "Clássico",   hint: "Capa centralizada com título grande." },
  { id: "cover",     name: "Capa cheia", hint: "Foto tomando a tela inteira." },
  { id: "paper",     name: "Paper",      hint: "Visual delicado, tipografia em destaque." },
  { id: "photobook", name: "Photobook",  hint: "Estilo álbum impresso." },
  { id: "artist",    name: "Artista",    hint: "Foto + assinatura, ideal pra editorial." },
];

const FONTS = [
  { id: "serifa",     name: "Serifa",     class: "font-serif" },
  { id: "sans",       name: "Sem serifa", class: "font-sans" },
  { id: "manuscrita", name: "Manuscrita", class: "italic" },
  { id: "slab",       name: "Slab",       class: "font-mono" },
];

const COLORS = ["#D4537E", "#7C3AED", "#0F766E", "#E11D48", "#0EA5E9", "#525252", "#A16207", "#1E3A8A"];

export function DesignSection({ gallery, onChanged, onNotify }: DesignSectionProps) {
  const [layout, setLayout] = useState((gallery as any).cover_layout || "classic");
  const [font, setFont] = useState((gallery as any).font_family || "sans");
  const [color, setColor] = useState((gallery as any).primary_color || "#D4537E");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLayout((gallery as any).cover_layout || "classic");
    setFont((gallery as any).font_family || "sans");
    setColor((gallery as any).primary_color || "#D4537E");
  }, [gallery.id]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/galleries/${gallery.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_layout: layout, font_family: font, primary_color: color }),
      });
      if (!res.ok) throw new Error();
      onNotify("success", "Design atualizado.");
      onChanged();
    } catch {
      onNotify("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const fontClass = FONTS.find((f) => f.id === font)?.class || "font-sans";

  return (
    <div className="space-y-5">
      <SecaoHeader titulo="Design" descricao="Como a galeria aparece pra cliente: capa, fonte, cor de destaque." />

      <Bloco titulo="Layout da capa">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {LAYOUTS.map((l) => {
            const active = layout === l.id;
            return (
              <button
                key={l.id} onClick={() => setLayout(l.id)}
                className={
                  "text-left p-3 rounded-lg border transition-colors " +
                  (active
                    ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-600/40"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                }
              >
                <div className="aspect-[4/3] rounded bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 mb-2 relative overflow-hidden">
                  <div
                    className="absolute inset-x-2 bottom-2 h-1 rounded"
                    style={{ background: color }}
                  />
                </div>
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{l.hint}</div>
              </button>
            );
          })}
        </div>
      </Bloco>

      <Bloco titulo="Tipografia">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FONTS.map((f) => {
            const active = font === f.id;
            return (
              <button
                key={f.id} onClick={() => setFont(f.id)}
                className={
                  "p-3 rounded-lg border transition-colors text-center " +
                  (active
                    ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20 ring-2 ring-brand-600/40"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                }
              >
                <div className={"text-xl mb-1 " + f.class}>Aa</div>
                <div className="text-xs font-medium">{f.name}</div>
              </button>
            );
          })}
        </div>
      </Bloco>

      <Bloco titulo="Cor de destaque">
        <div className="flex items-center gap-3 flex-wrap">
          {COLORS.map((c) => (
            <button
              key={c} onClick={() => setColor(c)}
              className={
                "w-9 h-9 rounded-full transition-transform " +
                (color === c ? "ring-2 ring-offset-2 ring-brand-600 scale-110" : "hover:scale-105")
              }
              style={{ background: c }}
              aria-label={c}
            />
          ))}
          <label className="ml-2 flex items-center gap-2 text-xs">
            Custom:
            <input
              type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
            />
          </label>
        </div>
      </Bloco>

      <Bloco titulo="Pré-visualização">
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-6 text-center text-neutral-900">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">{gallery.client_name || "Cliente"}</div>
          <div className={"text-2xl mb-3 " + fontClass}>{gallery.title}</div>
          <button
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-white text-sm font-medium"
            style={{ background: color }}
          >
            <Heart size={14} /> Escolher minhas fotos
          </button>
        </div>
      </Bloco>

      <div className="flex justify-end">
        <button
          onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar design
        </button>
      </div>
    </div>
  );
}
