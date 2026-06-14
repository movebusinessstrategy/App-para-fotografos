import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Check, CircleCheck, Download, Edit3, Eye, Loader2,
  Lock, LogIn, MessageSquare, Plus, ShieldCheck, ShieldOff, UserPlus, X,
} from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { ToastKind } from "../../galeria/Toast";

// Modal de Acesso (login/senha do cliente) + Atividades (auditoria) do álbum.
// Espelha o padrão da galeria, adaptado pro álbum.

interface AccessUser {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "guest";
  last_login_at: string | null;
  login_count: number | null;
}

interface AuditEvent {
  id: string;
  event: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  user: { id: string; email: string | null; name: string | null } | null;
}

interface AuditSummary {
  total_users: number;
  total_views: number;
  total_logins: number;
  total_login_fails: number;
  total_edits: number;
  last_event_at: string | null;
  approved_at: string | null;
}

const ROLE_LABEL: Record<AccessUser["role"], string> = {
  owner: "Cliente principal",
  guest: "Convidado",
};

const EVENT_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  login:      { label: "Entrou",          icon: LogIn,       color: "text-emerald-600 dark:text-emerald-400" },
  login_fail: { label: "Login falhou",    icon: ShieldOff,   color: "text-red-600 dark:text-red-400" },
  view_album: { label: "Abriu o álbum",   icon: Eye,           color: "text-blue-600 dark:text-blue-400" },
  edit_album: { label: "Editou o álbum",  icon: Edit3,         color: "text-amber-600 dark:text-amber-400" },
  comment:    { label: "Comentou",        icon: MessageSquare, color: "text-amber-600 dark:text-amber-400" },
  approve:    { label: "Aprovou o álbum", icon: CircleCheck,   color: "text-emerald-600 dark:text-emerald-400" },
};

interface AlbumComment {
  id: string;
  author_name: string | null;
  spread_position: number | null;
  body: string;
  resolved: boolean;
  created_at: string;
}

function formatBR(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch { return "—"; }
}

interface Props {
  albumId: string;
  onClose: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

export function AcessoAtividadesModal({ albumId, onClose, onNotify }: Props) {
  const [tab, setTab] = useState<"acesso" | "atividades" | "comentarios">("acesso");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-violet-600 dark:text-violet-400" />
            <h2 className="text-base font-semibold">Acesso & atividades</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-3 pt-3">
          {([["acesso", "Acesso e privacidade"], ["comentarios", "Comentários"], ["atividades", "Atividades do cliente"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors " +
                (tab === id
                  ? "bg-violet-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "acesso" ? (
            <AbaAcesso albumId={albumId} onNotify={onNotify} />
          ) : tab === "comentarios" ? (
            <AbaComentarios albumId={albumId} onNotify={onNotify} />
          ) : (
            <AbaAtividades albumId={albumId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Aba Acesso ───────────────────────────────────────────────────────────────

function AbaAcesso({ albumId, onNotify }: { albumId: string; onNotify: (k: ToastKind, m: string) => void }) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [requireLogin, setRequireLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingGate, setSavingGate] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<AccessUser | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/albums/${albumId}/access`);
      if (!res.ok) throw new Error("falha");
      const data = await res.json();
      setUsers(data.users || []);
      setRequireLogin(!!data.require_login);
    } catch {
      onNotify("error", "Não foi possível carregar os acessos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [albumId]);

  const toggleGate = async (next: boolean) => {
    if (next && users.length === 0) {
      onNotify("error", "Cadastre ao menos um login antes de exigir senha.");
      return;
    }
    setSavingGate(true);
    try {
      const res = await authFetch(`/api/albums/${albumId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_login: next }),
      });
      if (!res.ok) throw new Error("falha");
      setRequireLogin(next);
      onNotify("success", next ? "Login exigido pra acessar o álbum." : "Álbum voltou a ser link direto.");
    } catch {
      onNotify("error", "Não foi possível atualizar.");
    } finally {
      setSavingGate(false);
    }
  };

  const removeUser = async (u: AccessUser) => {
    try {
      const res = await authFetch(`/api/albums/${albumId}/access/${u.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("falha");
      onNotify("success", "Acesso removido.");
      reload();
    } catch {
      onNotify("error", "Não foi possível remover.");
    }
  };

  const hasOwner = users.some((u) => u.role === "owner");

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Controle quem entra no álbum. Com login ligado, a cliente entra com e-mail e senha e tudo fica registrado.
      </p>

      <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lock size={15} className={requireLogin ? "text-violet-600 dark:text-violet-400" : "text-gray-400"} />
          <div>
            <div className="text-sm font-medium">Exigir login pra acessar</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {requireLogin
                ? "Cliente entra com e-mail e senha."
                : "Álbum é link direto — quem tem o link entra."}
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
              {hasOwner ? "Cliente principal + convidados." : "Adicione o cliente principal pra começar."}
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
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddAccessModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); reload(); }}
        albumId={albumId}
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
    </div>
  );
}

function AddAccessModal({
  open, onClose, onCreated, albumId, defaultRole, onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  albumId: string;
  defaultRole: "owner" | "guest";
  onNotify: (kind: ToastKind, msg: string) => void;
  key?: React.Key | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"owner" | "guest">(defaultRole);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setEmail(""); setName(""); setPassword(""); setRole(defaultRole); }
  }, [open, defaultRole]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authFetch(`/api/albums/${albumId}/access`, {
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
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
          <input
            type="text"
            value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            placeholder="Mínimo 6 caracteres"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Você manda a senha pra cliente — ela entra com e-mail e senha.
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

// ── Aba Atividades ───────────────────────────────────────────────────────────

function AbaAtividades({ albumId }: { albumId: string }) {
  const [data, setData] = useState<{ events: AuditEvent[]; summary: AuditSummary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let ativo = true;
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/albums/${albumId}/audit`);
        if (!res.ok) throw new Error("falha");
        if (ativo) setData(await res.json());
      } catch {
        if (ativo) setData(null);
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [albumId]);

  const events = useMemo(() => {
    const all = data?.events || [];
    if (filter === "all") return all;
    return all.filter((e) => e.event === filter);
  }, [data, filter]);

  const exportCsv = () => {
    const headers = ["data", "hora", "usuário", "e-mail", "evento", "detalhe", "ip", "user_agent"];
    const lines = events.map((e) => {
      const d = e.created_at ? new Date(e.created_at) : null;
      return [
        d ? d.toLocaleDateString("pt-BR") : "",
        d ? d.toLocaleTimeString("pt-BR") : "",
        e.user?.name || "",
        e.user?.email || "",
        (EVENT_META[e.event] || { label: e.event }).label,
        e.detail || "",
        e.ip || "",
        e.user_agent || "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";");
    });
    const csv = "﻿" + [headers.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `historico-album-${albumId.slice(0, 8)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-2" />Carregando…</div>;
  }
  if (!data) {
    return <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2"><AlertTriangle size={14} /> Não foi possível carregar.</div>;
  }

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Acessos" value={s.total_logins} icon={LogIn} />
        <StatCard label="Visualizações" value={s.total_views} icon={Eye} />
        <StatCard label="Edições" value={s.total_edits} icon={Edit3} />
        <StatCard label="Cadastrados" value={s.total_users} icon={UserPlus} />
      </div>

      {(s.approved_at || s.total_login_fails > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {s.approved_at && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Check size={12} /> Aprovado em {formatBR(s.approved_at)}
            </span>
          )}
          {s.total_login_fails > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle size={12} /> {s.total_login_fails} login(s) com senha errada
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Filtrar:</span>
        {[
          { id: "all", label: "Tudo" },
          { id: "login", label: "Acessos" },
          { id: "view_album", label: "Visualizações" },
          { id: "edit_album", label: "Edições" },
          { id: "approve", label: "Aprovou" },
          { id: "login_fail", label: "Falhas" },
        ].map((f) => (
          <button
            key={f.id} onClick={() => setFilter(f.id)}
            className={
              "text-xs px-2.5 py-1 rounded-full transition-colors " +
              (filter === f.id
                ? "bg-violet-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700")
            }
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={exportCsv} disabled={events.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          <Download size={12} /> Exportar CSV
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
        {events.length === 0 ? (
          <p className="text-sm text-gray-500 py-3 text-center">Nenhum registro pra esse filtro.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e) => <EventRow key={e.id} event={e} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: {
  label: string; value: number; icon: React.ComponentType<{ size?: number; className?: string }>; key?: React.Key | null;
}) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Icon size={12} /> {label}
      </div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent; key?: React.Key | null }) {
  const meta = EVENT_META[event.event] || { label: event.event, icon: Activity, color: "text-gray-500" };
  const Icon = meta.icon;
  const who = event.user?.name || event.user?.email || (event.event === "login_fail" ? "—" : "Visitante");
  return (
    <li className="flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30">
      <Icon size={14} className={meta.color + " mt-0.5 flex-shrink-0"} />
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <span className="font-medium">{who}</span> <span className="text-gray-500">— {meta.label}</span>
        </div>
        {event.detail && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate italic mt-0.5">"{event.detail}"</div>
        )}
        <div className="text-[11px] text-gray-400 mt-0.5">
          {formatBR(event.created_at)}{event.ip ? ` · ${event.ip}` : ""}
        </div>
      </div>
    </li>
  );
}

// ── Aba Comentários ──────────────────────────────────────────────────────────

function AbaComentarios({ albumId, onNotify }: { albumId: string; onNotify: (k: ToastKind, m: string) => void }) {
  const [comments, setComments] = useState<AlbumComment[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/albums/${albumId}/comments`);
      if (!res.ok) throw new Error("falha");
      const data = await res.json();
      setComments(data.comments || []);
    } catch {
      setComments(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [albumId]);

  const toggleResolved = async (c: AlbumComment) => {
    try {
      const res = await authFetch(`/api/albums/${albumId}/comments/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: !c.resolved }),
      });
      if (!res.ok) throw new Error("falha");
      setComments((cs) => (cs || []).map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x)));
    } catch {
      onNotify("error", "Não foi possível atualizar.");
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-2" />Carregando…</div>;
  }
  if (!comments) {
    return <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2"><AlertTriangle size={14} /> Não foi possível carregar.</div>;
  }
  if (comments.length === 0) {
    return (
      <div className="py-10 text-center">
        <MessageSquare size={22} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500">Nenhum comentário do cliente ainda.</p>
        <p className="mt-1 text-xs text-gray-400">Quando o cliente pedir um ajuste na apresentação, aparece aqui.</p>
      </div>
    );
  }

  const pendentes = comments.filter((c) => !c.resolved).length;

  return (
    <div className="space-y-3">
      {pendentes > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          {pendentes} pedido{pendentes === 1 ? "" : "s"} de ajuste em aberto
        </div>
      )}
      <ul className="space-y-2">
        {comments.map((c) => (
          <li
            key={c.id}
            className={
              "rounded-xl border p-3 " +
              (c.resolved
                ? "border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 opacity-70"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900")
            }
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              {c.spread_position != null && (
                <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                  Lâmina {c.spread_position + 1}
                </span>
              )}
              <span className="font-medium text-gray-700 dark:text-gray-300">{c.author_name || "Cliente"}</span>
              <span>· {formatBR(c.created_at)}</span>
              <button
                onClick={() => toggleResolved(c)}
                className={
                  "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors " +
                  (c.resolved
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800")
                }
              >
                <Check size={11} /> {c.resolved ? "Resolvido" : "Marcar resolvido"}
              </button>
            </div>
            <p className={"whitespace-pre-wrap text-sm " + (c.resolved ? "text-gray-500 line-through" : "text-gray-800 dark:text-gray-100")}>
              {c.body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
