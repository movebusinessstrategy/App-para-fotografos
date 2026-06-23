import React, { useEffect, useState } from "react";
import { Loader2, Plus, Save, Tag, Trash2 } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { Gallery } from "../types";
import { formatBRL } from "../utils";
import { ToastKind } from "../Toast";
import { Bloco, Campo, SecaoHeader } from "./DadosSection";

interface VendaSectionProps {
  gallery: Gallery;
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

type PricingMode = "no_charge" | "extra_avulso" | "upgrade_packs" | "sell_all";

interface ModeOption {
  value: PricingMode;
  title: string;
  desc: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "no_charge",     title: "Só seleção",            desc: "Cliente escolhe, sem cobrança online. Pacote inclui tudo." },
  { value: "extra_avulso",  title: "Extras avulsas",         desc: "N fotos incluídas + cada extra cobrada à parte." },
  { value: "upgrade_packs", title: "Pacotes de upgrade",     desc: "Cliente compra um pacote (ex.: +10 fotos = R$200)." },
  { value: "sell_all",      title: "Tudo à venda",           desc: "Cada foto tem preço; cliente paga as que escolher." },
];

type DiscountMode = "none" | "flat" | "single_pct" | "progressive";

const DISCOUNT_MODES: { value: DiscountMode; title: string; desc: string }[] = [
  { value: "none",        title: "Sem desconto",   desc: "Cliente paga o valor cheio." },
  { value: "flat",        title: "Abatimento R$",  desc: "Tira um valor fixo do total." },
  { value: "single_pct",  title: "Desconto único", desc: "Um % sobre o total." },
  { value: "progressive", title: "Progressivo",    desc: "% maior conforme escolhe mais fotos." },
];

// Quantas regras de desconto progressivo o estúdio pode cadastrar.
const MAX_DISCOUNT_RULES = 6;

export function VendaSection({ gallery, onChanged, onNotify }: VendaSectionProps) {
  const [mode, setMode] = useState<PricingMode>((gallery.pricing_mode as PricingMode) || "extra_avulso");
  const [included, setIncluded] = useState(String(gallery.included_count || 0));
  const [extraPrice, setExtraPrice] = useState(String(gallery.extra_price || 0));
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("flat");
  const [singlePct, setSinglePct] = useState("0");
  const [rules, setRules] = useState<{ percent: string; min_photos: string }[]>([]);
  const [packs, setPacks] = useState<{ id?: string; name: string; photo_count: string; price: string; sort_order: number }[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carrega cart_discount + packs do banco quando muda de galeria.
  useEffect(() => {
    setMode((gallery.pricing_mode as PricingMode) || "extra_avulso");
    setIncluded(String(gallery.included_count || 0));
    setExtraPrice(String(gallery.extra_price || 0));
    (async () => {
      try {
        const res = await authFetch(`/api/galleries/${gallery.id}/packs`);
        if (res.ok) {
          const j = await res.json();
          setPacks((j.packs || []).map((p: any) => ({
            id: p.id, name: p.name, photo_count: String(p.photo_count), price: String(p.price), sort_order: p.sort_order || 0,
          })));
          setDiscount(String(j.cart_discount || 0));
          setDiscountMode((j.discount_mode as DiscountMode) || "flat");
          setSinglePct(String(j.discount_single_pct || 0));
          setRules((j.discount_rules || []).map((r: any) => ({
            percent: String(r.percent ?? ""), min_photos: String(r.min_photos ?? ""),
          })));
        }
      } catch { /* sem packs ou rota nova ainda — segue mostrando vazio */ }
    })();
  }, [gallery.id]);

  const saveBasics = async () => {
    setSaving(true);
    try {
      // Normaliza igual ao backend (% 0..100, min_photos ≥ 1) pra UI não
      // "derivar" do que foi salvo de fato.
      const normSinglePct = Math.min(100, Math.max(0, Number(singlePct) || 0));
      const normRules = rules
        .map((r) => ({
          percent: Math.min(100, Math.max(0, Number(r.percent) || 0)),
          min_photos: Math.max(1, Math.floor(Number(r.min_photos) || 0)),
        }))
        .filter((r) => r.percent > 0 && r.min_photos >= 1);
      const payload: any = {
        pricing_mode: mode,
        cart_discount: Number(discount) || 0,
        discount_mode: discountMode,
        discount_single_pct: normSinglePct,
        discount_rules: normRules,
      };
      if (mode === "extra_avulso") {
        payload.included_count = Number(included) || 0;
        payload.extra_price = Number(extraPrice) || 0;
      }
      const res = await authFetch(`/api/galleries/${gallery.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setSinglePct(String(normSinglePct));
      setRules(normRules.map((r) => ({ percent: String(r.percent), min_photos: String(r.min_photos) })));
      onNotify("success", "Configuração salva.");
      onChanged();
    } catch {
      onNotify("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  // ── Packs ────────────────────────────────────────────────────────────────

  const addPack = () => setPacks((arr) => [...arr, { name: "", photo_count: "10", price: "0", sort_order: arr.length }]);
  const removePack = async (idx: number) => {
    const p = packs[idx];
    if (p.id) {
      try { await authFetch(`/api/galleries/${gallery.id}/packs/${p.id}`, { method: "DELETE" }); } catch { /* ignore */ }
    }
    setPacks((arr) => arr.filter((_, i) => i !== idx));
  };
  const updatePack = (idx: number, k: "name" | "photo_count" | "price", v: string) =>
    setPacks((arr) => arr.map((p, i) => (i === idx ? { ...p, [k]: v } : p)));

  // ── Regras de desconto progressivo ─────────────────────────────────────────

  const addRule = () =>
    setRules((arr) => (arr.length >= MAX_DISCOUNT_RULES ? arr : [...arr, { percent: "10", min_photos: "10" }]));
  const removeRule = (idx: number) => setRules((arr) => arr.filter((_, i) => i !== idx));
  const updateRule = (idx: number, k: "percent" | "min_photos", v: string) =>
    setRules((arr) => arr.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));

  const savePacks = async () => {
    setPacksLoading(true);
    try {
      for (const p of packs) {
        const body = {
          name: p.name.trim(),
          photo_count: Number(p.photo_count) || 0,
          price: Number(p.price) || 0,
          sort_order: p.sort_order,
        };
        if (!body.name || body.photo_count <= 0) continue;
        const url = p.id
          ? `/api/galleries/${gallery.id}/packs/${p.id}`
          : `/api/galleries/${gallery.id}/packs`;
        await authFetch(url, {
          method: p.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      onNotify("success", "Pacotes salvos.");
      onChanged();
    } catch {
      onNotify("error", "Não foi possível salvar os pacotes.");
    } finally {
      setPacksLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <SecaoHeader titulo="Seleção e venda" descricao="Como a cliente vai escolher (e o que ela paga, se for cobrar)." />

      <Bloco titulo="Modo de cobrança">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value} onClick={() => setMode(opt.value)}
                className={
                  "text-left p-3 rounded-lg border transition-colors " +
                  (active
                    ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-600/40"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                }
              >
                <div className="text-sm font-medium">{opt.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </Bloco>

      {mode === "extra_avulso" && (
        <Bloco titulo="Pacote + extras">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Fotos incluídas" type="number" value={included} onChange={setIncluded} />
            <Campo label="R$ por foto extra" type="number" value={extraPrice} onChange={setExtraPrice} />
          </div>
          <p className="text-xs text-gray-500">
            Cliente escolhe à vontade — paga {formatBRL(Number(extraPrice) || 0)} pra cada uma que passar das {included || 0}.
          </p>
        </Bloco>
      )}

      {mode === "upgrade_packs" && (
        <Bloco titulo="Pacotes de upgrade">
          <div className="space-y-2">
            {packs.length === 0 && (
              <p className="text-sm text-gray-500">Sem pacotes ainda. Adicione abaixo (ex.: "+10 fotos = R$200").</p>
            )}
            {packs.map((p, idx) => (
              <PackRow
                key={idx}
                pack={p}
                onChange={(k, v) => updatePack(idx, k, v)}
                onRemove={() => removePack(idx)}
              />
            ))}
            <div className="flex justify-between items-center pt-2">
              <button onClick={addPack} className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg">
                <Plus size={13} /> Adicionar pacote
              </button>
              <button
                onClick={savePacks} disabled={packsLoading || packs.length === 0}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg disabled:opacity-60"
              >
                {packsLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Salvar pacotes
              </button>
            </div>
          </div>
        </Bloco>
      )}

      {mode === "sell_all" && (
        <Bloco titulo="Preço por foto">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            No modo "Tudo à venda", o preço padrão de cada foto é o <strong>R$ por extra</strong> abaixo. Pra cobrar diferente em fotos específicas, use o botão na grade (em breve).
          </p>
          <Campo label="R$ padrão por foto" type="number" value={extraPrice} onChange={setExtraPrice} />
        </Bloco>
      )}

      {mode === "no_charge" && (
        <Bloco>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Sem cobrança online. A cliente só seleciona, e o estúdio cobra por fora (ou nem cobra — quando o pacote já tá pago).
          </p>
        </Bloco>
      )}

      {mode !== "no_charge" && (
        <Bloco titulo="Desconto no carrinho (opcional)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DISCOUNT_MODES.map((opt) => {
              const active = discountMode === opt.value;
              return (
                <button
                  key={opt.value} type="button" onClick={() => setDiscountMode(opt.value)}
                  className={
                    "text-left p-3 rounded-lg border transition-colors " +
                    (active
                      ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-600/40"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                  }
                >
                  <div className="text-sm font-medium">{opt.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{opt.desc}</div>
                </button>
              );
            })}
          </div>

          {discountMode === "flat" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Campo label="Abatimento (R$)" type="number" value={discount} onChange={setDiscount} />
              <div className="text-xs text-gray-500 self-end pb-2">
                Esse valor em reais é subtraído do total no final.
              </div>
            </div>
          )}

          {discountMode === "single_pct" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Campo label="Desconto (%)" type="number" value={singlePct} onChange={setSinglePct} />
              <div className="text-xs text-gray-500 self-end pb-2">
                Aplica esse percentual sobre o total do carrinho.
              </div>
            </div>
          )}

          {discountMode === "progressive" && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-500">
                Quanto mais fotos a cliente escolher, maior o desconto. Vale a regra com o maior
                "a partir de" que ela atingir.
              </p>
              {rules.length === 0 && (
                <p className="text-sm text-gray-500">Nenhuma regra ainda. Adicione abaixo (ex.: 13% a partir de 11 fotos).</p>
              )}
              {rules.map((r, idx) => (
                <DiscountRuleRow
                  key={idx}
                  rule={r}
                  onChange={(k, v) => updateRule(idx, k, v)}
                  onRemove={() => removeRule(idx)}
                />
              ))}
              <button
                type="button" onClick={addRule} disabled={rules.length >= MAX_DISCOUNT_RULES}
                className="w-full py-2 text-sm font-medium text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 rounded-lg disabled:opacity-50"
              >
                Adicionar regra de desconto
              </button>
              <p className="text-xs text-gray-500">
                Você adicionou {rules.length} de {MAX_DISCOUNT_RULES} regras de desconto progressivo.
              </p>
            </div>
          )}
        </Bloco>
      )}

      <div className="flex justify-end">
        <button
          onClick={saveBasics} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar configuração
        </button>
      </div>
    </div>
  );
}

function PackRow({ pack, onChange, onRemove }: {
  pack: { name: string; photo_count: string; price: string };
  onChange: (k: "name" | "photo_count" | "price", v: string) => void;
  onRemove: () => void;
  key?: React.Key | null;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-end">
      <div className="col-span-5">
        <Campo label="Nome" value={pack.name} onChange={(v) => onChange("name", v)} placeholder='+10 fotos' />
      </div>
      <div className="col-span-3">
        <Campo label="Qtd fotos" type="number" value={pack.photo_count} onChange={(v) => onChange("photo_count", v)} />
      </div>
      <div className="col-span-3">
        <Campo label="Preço (R$)" type="number" value={pack.price} onChange={(v) => onChange("price", v)} />
      </div>
      <div className="col-span-1 pb-1">
        <button onClick={onRemove} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function DiscountRuleRow({ rule, onChange, onRemove }: {
  rule: { percent: string; min_photos: string };
  onChange: (k: "percent" | "min_photos", v: string) => void;
  onRemove: () => void;
  key?: React.Key | null;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="w-24">
        <Campo label="Desconto %" type="number" value={rule.percent} onChange={(v) => onChange("percent", v)} />
      </div>
      <span className="pb-2.5 text-xs text-gray-500 whitespace-nowrap">a partir de</span>
      <div className="w-24">
        <Campo label="Qtd fotos" type="number" value={rule.min_photos} onChange={(v) => onChange("min_photos", v)} />
      </div>
      <button onClick={onRemove} className="p-2 mb-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// Reexport pro Tag/icon não dar unused.
export const _icon = Tag;
