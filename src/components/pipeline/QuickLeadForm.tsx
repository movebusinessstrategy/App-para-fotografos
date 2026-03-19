import React, { useState } from "react";
import { Plus } from "lucide-react";

import { authFetch } from "../../utils/authFetch";

interface QuickLeadFormProps {
  onCreated: () => void;
  firstStageName?: string;
}

export function QuickLeadForm({ onCreated, firstStageName }: QuickLeadFormProps) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", value: "", source: "" });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    setSaving(true);
    await authFetch("/api/deals/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        value: form.value,
        source: form.source.trim() || undefined,
      }),
    });
    setForm({ name: "", phone: "", email: "", value: "", source: "" });
    setSaving(false);
    onCreated();
  };

  const inputClasses = "px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent";

  return (
    <form 
      onSubmit={submit} 
      className="flex flex-wrap items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 shadow-sm dark:shadow-black/20"
    >
      <input
        required
        value={form.name}
        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        placeholder={`Lead rápido (${firstStageName || "Lead Novo"})`}
        className={`${inputClasses} min-w-[150px]`}
      />
      <input
        required
        value={form.phone}
        onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
        placeholder="Telefone"
        className={`${inputClasses} min-w-[140px]`}
      />
      <input
        value={form.email}
        onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
        placeholder="Email (opcional)"
        className={`${inputClasses} min-w-[160px]`}
      />
      <input
        type="number"
        value={form.value}
        onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
        placeholder="Valor estimado"
        className={`${inputClasses} w-32 [color-scheme:light] dark:[color-scheme:dark]`}
      />
      <input
        value={form.source}
        onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
        placeholder="Origem do lead"
        className={`${inputClasses} min-w-[140px]`}
      />
      <button
        type="submit"
        disabled={saving}
        className="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 flex items-center gap-1 transition-colors"
      >
        <Plus size={16} /> Criar
      </button>
    </form>
  );
}
