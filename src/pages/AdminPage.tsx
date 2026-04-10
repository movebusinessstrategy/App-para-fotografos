import React, { useEffect, useState } from "react";
import {
  Check, Edit2, Eye, EyeOff, KeyRound, Mail, Plus, Shield, Trash2, Users, X,
} from "lucide-react";
import { authFetch } from "../utils/authFetch";
import { TeamMember } from "../types";
import { ConfirmModal } from "../components/ui/ConfirmModal";

// ── Módulos disponíveis para controle de acesso ──────────────────────────────

const MODULES = [
  { key: "dashboard",   label: "Dashboard" },
  { key: "clients",     label: "Clientes" },
  { key: "jobs",        label: "Produção" },
  { key: "vendas",      label: "Vendas" },
  { key: "calendar",    label: "Agenda" },
  { key: "finance",     label: "Financeiro" },
  { key: "oportunidades", label: "Oportunidades" },
  { key: "contratos",   label: "Contratos" },
];

const COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#0ea5e9", "#f43f5e", "#8b5cf6", "#22c55e",
  "#f97316", "#06b6d4",
];

function getInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ── Modal de adicionar/editar membro ─────────────────────────────────────────

interface MemberModalProps {
  member: Partial<TeamMember> | null;
  onSave: (data: Partial<TeamMember> & { password?: string }) => void;
  onClose: () => void;
  saving: boolean;
}

function MemberModal({ member, onSave, onClose, saving }: MemberModalProps) {
  const [name, setName] = useState(member?.name || "");
  const [email, setEmail] = useState(member?.email || "");
  const [color, setColor] = useState(member?.color || COLORS[0]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isEdit = !!member?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white">{isEdit ? "Editar membro" : "Novo membro"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Avatar preview */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg"
              style={{ backgroundColor: color }}
            >
              {name ? getInitials(name) : "?"}
            </div>
          </div>

          {/* Nome */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Nome *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome do membro"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">E-mail</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              type="email"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
            />
          </div>

          {/* Senha */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              {isEdit ? "Nova senha (deixe em branco para manter)" : "Senha de acesso *"}
            </label>
            <div className="relative">
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isEdit ? "••••••••" : "Mínimo 6 caracteres"}
                type={showPassword ? "text" : "password"}
                className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-gold-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {!isEdit && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                O funcionário usará essa senha para entrar no sistema.
              </p>
            )}
          </div>

          {/* Cor */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Cor do avatar</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check size={13} className="text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ ...member, name, email, color, ...(password ? { password } : {}) })}
            disabled={!name.trim() || saving || (!isEdit && password.length > 0 && password.length < 6)}
            className="flex-1 py-2 text-sm bg-gold-600 hover:bg-gold-700 text-white rounded-xl font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? "Salvando..." : isEdit ? "Salvar" : "Adicionar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null); // id do membro sendo convidado
  const [inviteStatus, setInviteStatus] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [tab, setTab] = useState<"members" | "permissions">("members");
  const [modal, setModal] = useState<Partial<TeamMember> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });

  const fetchMembers = async () => {
    try {
      const res = await authFetch("/api/team-members");
      if (res.ok) setMembers(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMembers(); }, []);

  const handleSave = async (data: Partial<TeamMember> & { password?: string }) => {
    setSaving(true);
    try {
      if (data.id) {
        const res = await authFetch(`/api/team-members/${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Erro ao salvar membro");
          return;
        }
        setMembers(prev => prev.map(m => m.id === data.id ? { ...m, ...data } as TeamMember : m));
      } else {
        const res = await authFetch("/api/team-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Erro ao criar membro");
          return;
        }
        const created = await res.json();
        setMembers(prev => [...prev, created]);
      }
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await authFetch(`/api/team-members/${confirmDelete.id}`, { method: "DELETE" });
      setMembers(prev => prev.filter(m => m.id !== confirmDelete.id));
    } finally {
      setSaving(false);
      setConfirmDelete({ open: false, id: "", name: "" });
    }
  };

  const handleInvite = async (member: TeamMember) => {
    if (!member.email) return;
    setInviting(member.id);
    setInviteStatus(null);
    try {
      const res = await authFetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_member_id: member.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteStatus({ id: member.id, ok: true, msg: "Convite enviado! Verifique o e-mail." });
      } else {
        setInviteStatus({ id: member.id, ok: false, msg: data.error || "Erro ao enviar convite" });
      }
    } catch {
      setInviteStatus({ id: member.id, ok: false, msg: "Erro de conexão" });
    } finally {
      setInviting(null);
      setTimeout(() => setInviteStatus(null), 5000);
    }
  };

  const togglePermission = async (member: TeamMember, moduleKey: string) => {
    const newPerms = { ...member.permissions, [moduleKey]: !member.permissions[moduleKey] };
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, permissions: newPerms } : m));
    await authFetch(`/api/team-members/${member.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...member, permissions: newPerms }),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Shield size={22} className="text-gold-500" />
              Administração
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
              Gerencie membros da equipe e controle de acesso.
            </p>
          </div>
          {tab === "members" && (
            <button
              onClick={() => setModal({})}
              className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              <Plus size={15} />
              Novo membro
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          {[
            { id: "members" as const, label: "Membros da equipe", icon: Users },
            { id: "permissions" as const, label: "Permissões de acesso", icon: Shield },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === id
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Aba: Membros ── */}
        {tab === "members" && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Users size={36} className="text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">Nenhum membro adicionado.</p>
                <button
                  onClick={() => setModal({})}
                  className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  <Plus size={15} />
                  Adicionar primeiro membro
                </button>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Membro</th>
                    <th className="px-6 py-3 font-semibold">E-mail</th>
                    <th className="px-6 py-3 font-semibold">Permissões</th>
                    <th className="px-6 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {members.map(member => {
                    const allowed = Object.values(member.permissions || {}).filter(Boolean).length;
                    const total = MODULES.length;
                    return (
                      <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
                              style={{ backgroundColor: member.color }}
                            >
                              {getInitials(member.name)}
                            </div>
                            <span className="font-semibold text-gray-900 dark:text-white text-sm">{member.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {member.email || <span className="text-gray-300 dark:text-gray-600 italic">Não informado</span>}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {allowed}/{total} módulos
                          </span>
                          <div className="mt-1 h-1.5 w-24 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gold-500 transition-all"
                              style={{ width: `${(allowed / total) * 100}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Botão Convidar */}
                            {member.email && (
                              <button
                                onClick={() => handleInvite(member)}
                                disabled={inviting === member.id}
                                title="Enviar convite por e-mail"
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors bg-gold-50 dark:bg-gold-900/30 text-gold-600 dark:text-gold-400 hover:bg-gold-100 dark:hover:bg-gold-900/50 disabled:opacity-60"
                              >
                                {inviting === member.id ? (
                                  <div className="w-3 h-3 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Mail size={13} />
                                )}
                                Convidar
                              </button>
                            )}
                            <button
                              onClick={() => setModal(member)}
                              className="p-2 text-gray-400 hover:text-gold-600 dark:hover:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 rounded-lg transition-colors"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmDelete({ open: true, id: member.id, name: member.name })}
                              className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {/* Status do convite */}
                          {inviteStatus?.id === member.id && (
                            <p className={`text-xs mt-1 text-right ${inviteStatus.ok ? "text-green-600" : "text-red-500"}`}>
                              {inviteStatus.msg}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Aba: Permissões ── */}
        {tab === "permissions" && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Shield size={36} className="text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">Adicione membros para configurar permissões.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-40">
                        Módulo
                      </th>
                      {members.map(m => (
                        <th key={m.id} className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                              style={{ backgroundColor: m.color }}
                            >
                              {getInitials(m.name)}
                            </div>
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 max-w-[80px] truncate">
                              {m.name.split(" ")[0]}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {MODULES.map(mod => (
                      <tr key={mod.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                        <td className="px-6 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                          {mod.label}
                        </td>
                        {members.map(member => {
                          const allowed = member.permissions?.[mod.key] !== false;
                          return (
                            <td key={member.id} className="px-4 py-3 text-center">
                              <button
                                onClick={() => togglePermission(member, mod.key)}
                                className={`w-6 h-6 rounded-md flex items-center justify-center mx-auto transition-all border-2 ${
                                  allowed
                                    ? "border-transparent text-white shadow-sm"
                                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                                }`}
                                style={allowed ? { backgroundColor: member.color } : {}}
                              >
                                {allowed && <Check size={13} strokeWidth={3} />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal !== null && (
        <MemberModal
          member={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}

      <ConfirmModal
        open={confirmDelete.open}
        title="Remover membro"
        message={`Remover "${confirmDelete.name}" da equipe? Os trabalhos atribuídos a ele serão desvinculados.`}
        confirmText="Remover"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, id: "", name: "" })}
      />
    </>
  );
}
