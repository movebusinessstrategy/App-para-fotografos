import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ToastKind } from "./Toast";

interface AccessUser {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "guest";
  last_login_at: string | null;
  login_count: number | null;
}

interface AccessResponse {
  users: AccessUser[];
  require_login: boolean;
}

type DownloadMode = "off" | "with_watermark" | "clean";

interface AcessoSectionProps {
  galleryId: string;
  initialRequireLogin: boolean;
  initialDownloadMode: DownloadMode;
  onNotify: (kind: ToastKind, msg: string) => void;
}

const ROLE_LABEL: Record<AccessUser["role"], string> = {
  owner: "Cliente principal",
  guest: "Convidado",
};

const DOWNLOAD_OPTIONS: { value: DownloadMode; label: string; hint: string }[] = [
  { value: "off", label: "Não permitir", hint: "Cliente vê online, sem baixar nada." },
  { value: "with_watermark", label: "Com marca d'água", hint: "Baixa o preview marcado (boa pra mostrar a família)." },
  { value: "clean", label: "Sem marca (após pagar)", hint: "Após finalizar / pagar, baixa as fotos limpas." },
];

function formatBR(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function AcessoSection({
  galleryId, initialRequireLogin, initialDownloadMode, onNotify,
}: AcessoSectionProps) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [requireLogin, setRequireLogin] = useState(initialRequireLogin);
  const [downloadMode, setDownloadMode] = useState<DownloadMode>(initialDownloadMode);
  const [loading, setLoading] = useState(true);
  const [savingGate, setSavingGate] = useState(false);
  const [savingDownload, setSavingDownload] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<AccessUser | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/access`);
      if (!res.ok) throw new Error("falha");
      const data: AccessResponse = await res.json();
      setUsers(data.users || []);
      setRequireLogin(!!data.require_login);
    } catch {
      onNotify("error", "Não foi possível carregar os acessos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [galleryId]);

  const toggleGate = async (next: boolean) => {
    if (next && users.length === 0) {
      onNotify("error", "Cadastre ao menos um login antes de exigir senha.");
      return;
    }
    setSavingGate(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_login: next }),
      });
      if (!res.ok) throw new Error("falha");
      setRequireLogin(next);
      onNotify("success", next ? "Login exigido pra acessar." : "Galeria voltou a ser link público.");
    } catch {
      onNotify("error", "Não foi possível atualizar.");
    } finally {
      setSavingGate(false);
    }
  };

  const updateDownloadMode = async (next: DownloadMode) => {
    setSavingDownload(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download_mode: next }),
      });
      if (!res.ok) throw new Error("falha");
      setDownloadMode(next);
    } catch {
      onNotify("error", "Não foi possível atualizar.");
    } finally {
      setSavingDownload(false);
    }
  };

  const removeUser = async (u: AccessUser) => {
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/access/${u.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("falha");
      onNotify("success", "Acesso removido.");
      reload();
    } catch {
      onNotify("error", "Não foi possível remover.");
    }
  };

  const hasOwner = users.some((u) => u.role === "owner");

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={18} className="text-violet-600 dark:text-violet-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Acesso e privacidade</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Controle quem entra e o que pode baixar.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lock size={15} className={requireLogin ? "text-violet-600 dark:text-violet-400" : "text-gray-400"} />
          <div>
            <div className="text-sm font-medium">Exigir login pra acessar</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {requireLogin
                ? "Cliente entra com e-mail e senha. Tudo fica registrado."
                : "Galeria é link público — quem tem o link entra direto."}
            </div>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox" className="sr-only peer"
            checked={requireLogin}
            disabled={savingGate}
            onChange={(e) => toggleGate(e.target.checked)}
          />
          <div className="w-10 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-violet-600 rounded-full peer transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium">Quem tem acesso</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {hasOwner ? "Inclui cliente principal + convidados." : "Adicione o cliente principal pra começar."}
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <UserPlus size={13} /> Adicionar
          </button>
        </div>
        {loading ? (
          <div className="py-6 text-center text-sm text-gray-500"><Loader2 size={14} className="inline animate-spin mr-2" />Carregando…</div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-4 text-center text-sm text-gray-500">
            Ninguém cadastrado. Adicione o cliente principal.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{u.name || u.email}</span>
                    <span className={
                      "text-[10px] px-1.5 py-0.5 rounded-full font-medium " +
                      (u.role === "owner"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300")
                    }>
                      {ROLE_LABEL[u.role]}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {u.email} · {u.login_count || 0} acesso{(u.login_count || 0) === 1 ? "" : "s"} · último {formatBR(u.last_login_at)}
                  </div>
                </div>
                <button
                  onClick={() => setConfirmRemove(u)}
                  className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                  aria-label="Remover"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Download das fotos</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          O que a cliente pode baixar na página dela.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DOWNLOAD_OPTIONS.map((opt) => {
            const active = downloadMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => updateDownloadMode(opt.value)}
                disabled={savingDownload}
                className={
                  "text-left p-3 rounded-lg border transition-colors " +
                  (active
                    ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-600/40"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                }
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{opt.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <AddAccessModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); reload(); }}
        galleryId={galleryId}
        defaultRole={hasOwner ? "guest" : "owner"}
        onNotify={onNotify}
      />

      <ConfirmModal
        open={!!confirmRemove}
        title="Remover acesso"
        message={`Remover o acesso de "${confirmRemove?.name || confirmRemove?.email || ""}"? Eles não conseguirão mais entrar.`}
        confirmText="Remover"
        variant="danger"
        onConfirm={() => {
          if (confirmRemove) removeUser(confirmRemove);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </section>
  );
}

// key?: React.Key tipado pro typecheck aceitar (padrão do projeto sem @types/react completo).
function AddAccessModal({
  open, onClose, onCreated, galleryId, defaultRole, onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  galleryId: string;
  defaultRole: "owner" | "guest";
  onNotify: (kind: ToastKind, msg: string) => void;
  key?: React.Key | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"owner" | "guest">(defaultRole);
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(""); setName(""); setPassword(""); setRole(defaultRole); setShowPwd(false);
    }
  }, [open, defaultRole]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/access`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "falha");
      onNotify("success", "Acesso criado.");
      onCreated();
    } catch (err: any) {
      onNotify("error", err?.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus size={18} className="text-violet-600 dark:text-violet-400" />
          <h3 className="text-base font-semibold">Adicionar acesso</h3>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Tipo de acesso</label>
          <div className="grid grid-cols-2 gap-2">
            {(["owner", "guest"] as const).map((r) => (
              <button
                key={r} type="button" onClick={() => setRole(r)}
                className={
                  "p-2.5 rounded-lg border text-sm font-medium transition-colors " +
                  (role === r
                    ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-600/40"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                }
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Maria Silva"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">E-mail *</label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="cliente@email.com"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Senha *</label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4}
              placeholder="Mínimo 4 caracteres"
              className="w-full pl-3 pr-10 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            />
            <button
              type="button" onClick={() => setShowPwd(!showPwd)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700"
              aria-label={showPwd ? "Ocultar" : "Mostrar"}
            >
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Tu vai mandar a senha pra cliente — ela entra com e-mail e senha.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Criar acesso
          </button>
        </div>
      </form>
    </div>
  );
}
