import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ShieldCheck, X } from "lucide-react";

import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { Client } from "../../types";
import { Gallery, GallerySettings } from "./types";
import { ToastKind } from "./Toast";

const INPUT_CLS =
  "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-gray-400 dark:focus:border-gray-600 focus:ring-1 focus:ring-gray-400 dark:focus:ring-gray-600";
const LABEL_CLS = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

interface NovaGaleriaModalProps {
  onClose: () => void;
  onCreated: (gallery: Gallery) => void;
  onNotify: (kind: ToastKind, message: string) => void;
}

interface FormState {
  title: string;
  category: string;
  clientMode: "existing" | "manual";
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  includedCount: string;
  extraPrice: string;
  createAccess: boolean;
  accessEmail: string;
  accessPassword: string;
  requireLogin: boolean;
}

// Senha legível e curta — 8 chars, sem caracteres confusos (0/O, 1/l).
function gerarSenha(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const crypto = (window as any).crypto || (window as any).msCrypto;
  if (crypto?.getRandomValues) {
    const buf = new Uint32Array(8);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 8; i++) s += chars[buf[i] % chars.length];
  } else {
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function buildClientFields(form: FormState, clients: Client[]) {
  if (form.clientMode === "manual") {
    return {
      client_name: form.clientName.trim() || undefined,
      client_email: form.clientEmail.trim() || undefined,
      client_phone: form.clientPhone.trim() || undefined,
    };
  }
  const client = clients.find((c) => String(c.id) === form.clientId);
  if (!client) return {};
  return {
    client_id: client.id,
    client_name: client.name || undefined,
    client_email: client.email || undefined,
    client_phone: client.phone || undefined,
  };
}

export function NovaGaleriaModal({ onClose, onCreated, onNotify }: NovaGaleriaModalProps) {
  const { data: clientsData } = useApi<Client[]>("/api/clients");
  const { data: settingsData } = useApi<{ settings: GallerySettings }>("/api/gallery-settings");
  const clients = useMemo(() => (Array.isArray(clientsData) ? clientsData : []), [clientsData]);
  const settings = settingsData?.settings;
  const categories = settings?.categories || [];

  const [form, setForm] = useState<FormState>({
    title: "",
    category: "",
    clientMode: "existing",
    clientId: "",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    includedCount: String(settings?.default_included_count ?? 20),
    extraPrice: String(settings?.default_extra_price ?? 35),
    createAccess: true,
    accessEmail: "",
    accessPassword: gerarSenha(),
    requireLogin: true,
  });
  const [loading, setLoading] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Settings chegam async: semeia os defaults uma única vez quando carregarem.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setForm((f) => ({
      ...f,
      includedCount: String(settings.default_included_count ?? f.includedCount),
      extraPrice: String(settings.default_extra_price ?? f.extraPrice),
    }));
  }, [settings]);

  const clientOptions = useMemo(
    () => clients.map((c) => ({ value: String(c.id), label: c.name || c.email || c.phone || `#${c.id}` })),
    [clients],
  );

  // Sincroniza accessEmail com o e-mail do cliente — muda quando troca cliente.
  // Só sobrescreve se o usuário não tiver editado manualmente.
  const accessEditedRef = useRef(false);
  const selectedClient = clients.find((c) => String(c.id) === form.clientId);
  const clientEmailNow = form.clientMode === "existing"
    ? selectedClient?.email || ""
    : form.clientEmail;
  useEffect(() => {
    if (accessEditedRef.current) return;
    setForm((f) => ({ ...f, accessEmail: clientEmailNow }));
  }, [clientEmailNow]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authFetch("/api/galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category || undefined,
          ...buildClientFields(form, clients),
          included_count: Math.max(0, parseInt(form.includedCount, 10) || 0),
          extra_price: Math.max(0, parseFloat(form.extraPrice.replace(",", ".")) || 0),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Auto-cria acesso da cliente (e-mail + senha) se foi pedido.
      const wantsAccess = form.createAccess && form.accessEmail.trim() && form.accessPassword.trim().length >= 4;
      if (wantsAccess) {
        try {
          const accRes = await authFetch(`/api/galleries/${data.gallery.id}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: form.accessEmail.trim(),
              password: form.accessPassword,
              name: data.gallery.client_name || undefined,
              role: "owner",
            }),
          });
          if (accRes.ok && form.requireLogin) {
            // Liga "exigir login" na galeria.
            await authFetch(`/api/galleries/${data.gallery.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ require_login: true }),
            });
          }
          if (accRes.ok) {
            onNotify(
              "success",
              `Acesso criado: ${form.accessEmail.trim()} · senha ${form.accessPassword}. Anote!`,
            );
          } else {
            onNotify("error", "Galeria criada, mas não consegui criar o acesso da cliente.");
          }
        } catch {
          onNotify("error", "Galeria criada, mas não consegui criar o acesso da cliente.");
        }
      }

      onCreated(data.gallery);
    } catch {
      onNotify("error", "Não foi possível criar a galeria.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-transparent dark:border-gray-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Nova galeria</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className={LABEL_CLS}>Título *</label>
            <input
              required
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Ex.: Ensaio gestante — Maria"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Categoria</label>
            <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={INPUT_CLS}>
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Cliente</label>
            <div className="flex gap-2 mb-2">
              {(["existing", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => set({ clientMode: mode })}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.clientMode === mode
                      ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {mode === "existing" ? "Cliente cadastrado" : "Digitar dados"}
                </button>
              ))}
            </div>

            {form.clientMode === "existing" ? (
              <SearchableSelect
                value={form.clientId}
                onChange={(v) => set({ clientId: v })}
                options={clientOptions}
                placeholder="Buscar cliente..."
                searchPlaceholder="Nome, e-mail ou telefone"
                emptyMessage="Nenhum cliente encontrado"
              />
            ) : (
              <div className="space-y-2">
                <input
                  value={form.clientName}
                  onChange={(e) => set({ clientName: e.target.value })}
                  placeholder="Nome da cliente"
                  className={INPUT_CLS}
                />
                <input
                  type="email"
                  value={form.clientEmail}
                  onChange={(e) => set({ clientEmail: e.target.value })}
                  placeholder="E-mail (opcional)"
                  className={INPUT_CLS}
                />
                <input
                  value={form.clientPhone}
                  onChange={(e) => set({ clientPhone: e.target.value })}
                  placeholder="WhatsApp (opcional)"
                  className={INPUT_CLS}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Fotos incluídas</label>
              <input
                type="number"
                min={0}
                value={form.includedCount}
                onChange={(e) => set({ includedCount: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Preço da foto extra (R$)</label>
              <input
                value={form.extraPrice}
                onChange={(e) => set({ extraPrice: e.target.value })}
                placeholder="35"
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Acesso da cliente — login + senha já saem prontos */}
          <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 bg-violet-50/40 dark:bg-violet-900/10 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.createAccess}
                onChange={(e) => set({ createAccess: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-violet-600"
              />
              <span className="text-sm font-medium flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-violet-600 dark:text-violet-400" />
                Criar acesso pra cliente já
              </span>
            </label>
            {form.createAccess && (
              <div className="space-y-2 pl-6">
                <div>
                  <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">E-mail de acesso</label>
                  <input
                    type="email"
                    value={form.accessEmail}
                    onChange={(e) => { accessEditedRef.current = true; set({ accessEmail: e.target.value }); }}
                    placeholder="cliente@email.com"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Senha (anote pra mandar pra ela)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.accessPassword}
                      onChange={(e) => set({ accessPassword: e.target.value })}
                      className={INPUT_CLS + " font-mono tracking-wider"}
                    />
                    <button
                      type="button"
                      onClick={() => set({ accessPassword: gerarSenha() })}
                      title="Gerar nova senha"
                      className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.requireLogin}
                    onChange={(e) => set({ requireLogin: e.target.checked })}
                    className="w-3.5 h-3.5 accent-violet-600"
                  />
                  Exigir login pra acessar (recomendado)
                </label>
              </div>
            )}
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
              {loading ? "Criando..." : "Criar galeria"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
