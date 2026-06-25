import React, { useEffect, useState } from "react";
import { Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { GalleryPreset, GalleryPresetConfig } from "./types";
import { formatBRL } from "./utils";
import { ToastKind } from "./Toast";

const INPUT_CLS =
  "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-brand-400 dark:focus:border-brand-500 focus:ring-1 focus:ring-brand-400";
const LABEL_CLS = "block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1";

type DiscountMode = NonNullable<GalleryPresetConfig["discount_mode"]>;
type PricingMode = NonNullable<GalleryPresetConfig["pricing_mode"]>;

interface EditorState {
  id: string | null;
  name: string;
  category: string;
  included_count: string;
  extra_price: string;
  deadline_days: string;
  pricing_mode: PricingMode;
  discount_mode: DiscountMode;
  discount_single_pct: string;
  discount_rules: { min_photos: string; percent: string }[];
}

const PRICING_OPTIONS: { v: PricingMode; label: string }[] = [
  { v: "extra_avulso", label: "Cobrar foto extra avulsa" },
  { v: "upgrade_packs", label: "Pacotes de upgrade" },
  { v: "sell_all", label: "Vender todas as fotos" },
  { v: "no_charge", label: "Sem cobrança (cortesia)" },
];

function emptyEditor(): EditorState {
  return {
    id: null, name: "", category: "", included_count: "20", extra_price: "35",
    deadline_days: "", pricing_mode: "extra_avulso", discount_mode: "none",
    discount_single_pct: "10", discount_rules: [{ min_photos: "10", percent: "10" }],
  };
}

function editorFromPreset(p: GalleryPreset): EditorState {
  const cfg = p.config || {};
  return {
    id: p.id,
    name: p.name,
    category: p.category || "",
    included_count: String(p.included_count ?? 0),
    extra_price: String(p.extra_price ?? 0),
    deadline_days: p.deadline_days != null ? String(p.deadline_days) : "",
    pricing_mode: cfg.pricing_mode || "extra_avulso",
    discount_mode: cfg.discount_mode || "none",
    discount_single_pct: String(cfg.discount_single_pct ?? 10),
    discount_rules: (cfg.discount_rules && cfg.discount_rules.length)
      ? cfg.discount_rules.map((r) => ({ min_photos: String(r.min_photos), percent: String(r.percent) }))
      : [{ min_photos: "10", percent: "10" }],
  };
}

function buildPayload(e: EditorState) {
  const config: GalleryPresetConfig = { pricing_mode: e.pricing_mode, discount_mode: e.discount_mode };
  if (e.discount_mode === "single_pct") {
    config.discount_single_pct = Math.min(100, Math.max(0, Number(e.discount_single_pct) || 0));
  }
  if (e.discount_mode === "progressive") {
    config.discount_rules = e.discount_rules
      .map((r) => ({ min_photos: Math.max(1, Math.floor(Number(r.min_photos) || 0)), percent: Math.min(100, Math.max(0, Number(r.percent) || 0)) }))
      .filter((r) => r.percent > 0 && r.min_photos >= 1);
  }
  return {
    name: e.name.trim(),
    category: e.category || null,
    included_count: Math.max(0, parseInt(e.included_count, 10) || 0),
    extra_price: Math.max(0, parseFloat(e.extra_price.replace(",", ".")) || 0),
    deadline_days: e.deadline_days ? Math.max(1, parseInt(e.deadline_days, 10) || 0) : null,
    config,
  };
}

function discountLabel(cfg: GalleryPresetConfig): string | null {
  if (cfg.discount_mode === "single_pct") return `${cfg.discount_single_pct || 0}% no total`;
  if (cfg.discount_mode === "progressive") return `desconto progressivo (${(cfg.discount_rules || []).length} faixa(s))`;
  return null;
}

export function GalleryPresetsManager({ categories, onNotify }: {
  categories: string[]; onNotify: (k: ToastKind, m: string) => void;
}) {
  const [presets, setPresets] = useState<GalleryPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await authFetch("/api/gallery-presets");
      const j = await res.json();
      setTableMissing(!!j.tableMissing);
      setPresets(Array.isArray(j.presets) ? j.presets : []);
    } catch {
      onNotify("error", "Não foi possível carregar os presets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!editor) return;
    if (!editor.name.trim()) { onNotify("error", "Dê um nome ao preset."); return; }
    setSaving(true);
    try {
      const payload = buildPayload(editor);
      const url = editor.id ? `/api/gallery-presets/${editor.id}` : "/api/gallery-presets";
      const res = await authFetch(url, {
        method: editor.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "falha");
      }
      onNotify("success", editor.id ? "Preset atualizado." : "Preset criado.");
      setEditor(null);
      load();
    } catch (e: any) {
      onNotify("error", e?.message || "Não foi possível salvar o preset.");
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (p: GalleryPreset) => {
    try {
      const res = await authFetch(`/api/gallery-presets/${p.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      onNotify("success", "Preset duplicado.");
      load();
    } catch {
      onNotify("error", "Não foi possível duplicar.");
    }
  };

  const remove = async (p: GalleryPreset) => {
    if (!window.confirm(`Excluir o preset "${p.name}"?`)) return;
    try {
      const res = await authFetch(`/api/gallery-presets/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onNotify("success", "Preset excluído.");
      load();
    } catch {
      onNotify("error", "Não foi possível excluir.");
    }
  };

  if (loading) return <div className="text-sm text-gray-500 py-2">Carregando…</div>;

  if (tableMissing) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
        Para usar presets, rode a migration <strong>055_gallery_presets.sql</strong> no Supabase.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
        Crie categorias prontas (ex.: Gestante Basic, Gestante Premium) com nº de fotos, prazo, valores e descontos.
        Ao criar uma galeria, escolha o preset e tudo já vem preenchido.
      </p>

      {presets.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 py-1">Nenhum preset ainda.</div>
      ) : (
        <ul className="space-y-2">
          {presets.map((p) => {
            const disc = discountLabel(p.config || {});
            return (
              <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {p.name}
                    {p.category && <span className="ml-2 text-[11px] font-medium text-brand-700 dark:text-brand-300">· {p.category}</span>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {p.included_count} foto(s) incluídas · extra {formatBRL(p.extra_price)}
                    {p.deadline_days ? ` · prazo ${p.deadline_days} dia(s)` : ""}
                    {disc ? ` · ${disc}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <IconBtn title="Editar" onClick={() => setEditor(editorFromPreset(p))}><Pencil size={14} /></IconBtn>
                  <IconBtn title="Duplicar" onClick={() => duplicate(p)}><Copy size={14} /></IconBtn>
                  <IconBtn title="Excluir" onClick={() => remove(p)} danger><Trash2 size={14} /></IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={() => setEditor(emptyEditor())}
        className="inline-flex items-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg"
      >
        <Plus size={14} /> Novo preset
      </button>

      {editor && (
        <PresetEditorModal
          editor={editor} setEditor={setEditor} categories={categories}
          onSave={save} saving={saving} onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title}
      className={
        "p-1.5 rounded-lg transition-colors " +
        (danger
          ? "text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800")
      }
    >
      {children}
    </button>
  );
}

function PresetEditorModal({ editor, setEditor, categories, onSave, saving, onClose }: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>;
  categories: string[];
  onSave: () => void;
  saving: boolean;
  onClose: () => void;
}) {
  const set = (patch: Partial<EditorState>) => setEditor((e) => (e ? { ...e, ...patch } : e));
  const setRule = (i: number, patch: Partial<{ min_photos: string; percent: string }>) =>
    setEditor((e) => {
      if (!e) return e;
      const rules = e.discount_rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      return { ...e, discount_rules: rules };
    });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-transparent dark:border-gray-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">{editor.id ? "Editar preset" : "Novo preset"}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className={LABEL_CLS}>Nome do preset *</label>
            <input value={editor.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Gestante Premium" className={INPUT_CLS} />
          </div>

          <div>
            <label className={LABEL_CLS}>Categoria</label>
            <select value={editor.category} onChange={(e) => set({ category: e.target.value })} className={INPUT_CLS}>
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Fotos incluídas</label>
              <input type="number" min={0} value={editor.included_count} onChange={(e) => set({ included_count: e.target.value })} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Preço foto extra (R$)</label>
              <input value={editor.extra_price} onChange={(e) => set({ extra_price: e.target.value })} placeholder="35" className={INPUT_CLS} />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Prazo de seleção (dias após criar)</label>
            <input type="number" min={1} max={365} value={editor.deadline_days} onChange={(e) => set({ deadline_days: e.target.value })} placeholder="sem prazo" className={INPUT_CLS} />
          </div>

          <div>
            <label className={LABEL_CLS}>Cobrança</label>
            <select value={editor.pricing_mode} onChange={(e) => set({ pricing_mode: e.target.value as PricingMode })} className={INPUT_CLS}>
              {PRICING_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Desconto</label>
            <select value={editor.discount_mode} onChange={(e) => set({ discount_mode: e.target.value as DiscountMode })} className={INPUT_CLS}>
              <option value="none">Sem desconto</option>
              <option value="single_pct">% fixo sobre o total</option>
              <option value="progressive">Progressivo (quanto mais fotos, mais desconto)</option>
            </select>
          </div>

          {editor.discount_mode === "single_pct" && (
            <div>
              <label className={LABEL_CLS}>Desconto (%)</label>
              <input type="number" min={0} max={100} value={editor.discount_single_pct} onChange={(e) => set({ discount_single_pct: e.target.value })} className={INPUT_CLS} />
            </div>
          )}

          {editor.discount_mode === "progressive" && (
            <div className="space-y-2">
              <label className={LABEL_CLS}>Faixas (a partir de X fotos no total → Y% de desconto)</label>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">
                Conta o <strong>total</strong> de fotos que a cliente escolher (incluídas + extras), igual à venda da galeria. Vale a maior faixa atingida.
              </p>
              {editor.discount_rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="number" min={1} value={r.min_photos} onChange={(e) => setRule(i, { min_photos: e.target.value })} className={INPUT_CLS + " w-24"} placeholder="total" />
                  <span className="text-xs text-gray-400">→</span>
                  <input type="number" min={0} max={100} value={r.percent} onChange={(e) => setRule(i, { percent: e.target.value })} className={INPUT_CLS + " w-20"} placeholder="%" />
                  <button
                    onClick={() => set({ discount_rules: editor.discount_rules.filter((_, idx) => idx !== i) })}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Remover faixa"
                  ><Trash2 size={13} /></button>
                </div>
              ))}
              <button
                onClick={() => set({ discount_rules: [...editor.discount_rules, { min_photos: "", percent: "" }] })}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              ><Plus size={12} /> Adicionar faixa</button>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={onSave} disabled={saving} className="flex-1 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editor.id ? "Salvar" : "Criar preset"}
          </button>
        </div>
      </div>
    </div>
  );
}
