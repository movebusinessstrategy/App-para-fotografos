import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { Gallery } from "../types";
import { formatBRL } from "../utils";
import { ToastKind } from "../Toast";

interface DadosSectionProps {
  gallery: Gallery;
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

// Edita os dados básicos da galeria: título, categoria, contatos do cliente
// e os campos do pacote (fotos incluídas, preço por extra).
export function DadosSection({ gallery, onChanged, onNotify }: DadosSectionProps) {
  const [form, setForm] = useState({
    title: gallery.title,
    category: gallery.category || "",
    client_name: gallery.client_name || "",
    client_email: gallery.client_email || "",
    client_phone: gallery.client_phone || "",
    included_count: String(gallery.included_count || 0),
    extra_price: String(gallery.extra_price || 0),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      title: gallery.title,
      category: gallery.category || "",
      client_name: gallery.client_name || "",
      client_email: gallery.client_email || "",
      client_phone: gallery.client_phone || "",
      included_count: String(gallery.included_count || 0),
      extra_price: String(gallery.extra_price || 0),
    });
  }, [gallery.id]);

  const update = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category.trim() || null,
        client_name: form.client_name.trim() || null,
        client_email: form.client_email.trim() || null,
        client_phone: form.client_phone.trim() || null,
        included_count: Number(form.included_count) || 0,
        extra_price: Number(form.extra_price) || 0,
      };
      const res = await authFetch(`/api/galleries/${gallery.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("falha");
      onNotify("success", "Salvo.");
      onChanged();
    } catch {
      onNotify("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SecaoHeader
        titulo="Dados da galeria"
        descricao="Informações do ensaio e do contato da cliente."
      />

      <Bloco titulo="Identificação">
        <Campo label="Nome / título" value={form.title} onChange={(v) => update("title", v)} placeholder="Ex.: Maria Silva — Gestante" />
        <Campo label="Categoria" value={form.category} onChange={(v) => update("category", v)} placeholder="Gestante / Newborn / Casamento..." />
      </Bloco>

      <Bloco titulo="Cliente">
        <Campo label="Nome" value={form.client_name} onChange={(v) => update("client_name", v)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo label="E-mail" type="email" value={form.client_email} onChange={(v) => update("client_email", v)} />
          <Campo label="Telefone (WhatsApp)" value={form.client_phone} onChange={(v) => update("client_phone", v)} placeholder="(11) 99999-9999" />
        </div>
      </Bloco>

      <Bloco titulo="Pacote">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo label="Fotos incluídas no pacote" type="number" value={form.included_count} onChange={(v) => update("included_count", v)} />
          <Campo label="Preço por foto extra (R$)" type="number" value={form.extra_price} onChange={(v) => update("extra_price", v)} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pacote atual: <strong>{form.included_count}</strong> fotos · extra a <strong>{formatBRL(Number(form.extra_price) || 0)}</strong>.
        </p>
      </Bloco>

      <div className="flex justify-end">
        <button
          onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar alterações
        </button>
      </div>
    </div>
  );
}

// ── Building blocks (sem CSS Modules — só Tailwind) ────────────────────────

export function SecaoHeader({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{titulo}</h2>
      {descricao && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{descricao}</p>}
    </div>
  );
}

export function Bloco({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      {titulo && <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{titulo}</h3>}
      {children}
    </div>
  );
}

export function Campo({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
      />
    </label>
  );
}
