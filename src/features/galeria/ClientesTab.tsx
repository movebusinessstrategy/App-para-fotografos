import React, { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { useApi, refreshApi } from "../../utils/useApi";
import { normalizeText } from "../../utils/normalizeText";
import { Client } from "../../types";
import { Gallery } from "./types";
import { ToastKind } from "./Toast";

const INPUT_CLS =
  "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600";

interface ClientesTabProps {
  onNotify: (kind: ToastKind, message: string) => void;
}

interface ClientRow {
  key: string;
  name: string;
  email: string;
  phone: string;
  galleryCount: number;
  avulso: boolean;
}

function buildRows(clients: Client[], galleries: Gallery[]): ClientRow[] {
  const countById = new Map<number, number>();
  galleries.forEach((g) => {
    if (g.client_id != null) countById.set(g.client_id, (countById.get(g.client_id) || 0) + 1);
  });

  const rows: ClientRow[] = clients.map((c) => ({
    key: `c-${c.id}`,
    name: c.name || "Sem nome",
    email: c.email || "",
    phone: c.phone || "",
    galleryCount: countById.get(c.id) || 0,
    avulso: false,
  }));

  // Clientes "avulsos": só existem nas galerias (nome digitado, sem cadastro).
  const avulsoMap = new Map<string, ClientRow>();
  galleries
    .filter((g) => g.client_id == null && (g.client_name || g.client_email))
    .forEach((g) => {
      const key = `a-${normalizeText(g.client_name || "")}|${(g.client_email || "").toLowerCase()}`;
      const existing = avulsoMap.get(key);
      if (existing) {
        existing.galleryCount += 1;
        return;
      }
      avulsoMap.set(key, {
        key,
        name: g.client_name || "Sem nome",
        email: g.client_email || "",
        phone: g.client_phone || "",
        galleryCount: 1,
        avulso: true,
      });
    });

  return [...rows, ...avulsoMap.values()];
}

export default function ClientesTab({ onNotify }: ClientesTabProps) {
  const { data: clientsData, isLoading } = useApi<Client[]>("/api/clients");
  const { data: galleriesData } = useApi<{ galleries: Gallery[] }>("/api/galleries");
  const clients = useMemo(() => (Array.isArray(clientsData) ? clientsData : []), [clientsData]);
  const galleries = useMemo(() => galleriesData?.galleries ?? [], [galleriesData]);

  const [search, setSearch] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);

  const rows = useMemo(() => {
    const all = buildRows(clients, galleries);
    const q = normalizeText(search);
    if (!q) return all;
    return all.filter(
      (r) =>
        normalizeText(r.name).includes(q) ||
        normalizeText(r.email).includes(q) ||
        r.phone.includes(search.trim()),
    );
  }, [clients, galleries, search]);

  if (isLoading && !clientsData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome, e-mail ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:border-gold-400 outline-none transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => setNovoOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Plus size={14} />
          Novo cliente
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold hidden sm:table-cell">Contato</th>
              <th className="px-4 py-3 font-semibold text-right">Galerias</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{r.name}</span>
                  {r.avulso && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      avulso
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                  {[r.email, r.phone].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-200 font-medium">
                  {r.galleryCount}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-sm text-gray-400">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {novoOpen && (
        <NovoClienteModal
          onClose={() => setNovoOpen(false)}
          onCreated={() => {
            setNovoOpen(false);
            refreshApi("/api/clients");
            onNotify("success", "Cliente criado.");
          }}
          onNotify={onNotify}
        />
      )}
    </>
  );
}

// ─── Modal de novo cliente (POST /api/clients existente) ────────────────────

interface NovoClienteModalProps {
  onClose: () => void;
  onCreated: () => void;
  onNotify: (kind: ToastKind, message: string) => void;
}

function NovoClienteModal({ onClose, onCreated, onNotify }: NovoClienteModalProps) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      onCreated();
    } catch {
      onNotify("error", "Não foi possível criar o cliente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-transparent dark:border-gray-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Novo cliente</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">WhatsApp</label>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50"
            >
              {loading ? "Salvando..." : "Criar cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
