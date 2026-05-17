import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LogIn, Mail, Pause, Play, Trash2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { useImpersonation } from "../../contexts/ImpersonationContext";

type Detail = {
  owner_user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  account: {
    plan_id: string | null;
    status: "active" | "suspended" | "deleted";
    suspended_reason: string | null;
    trial_ends_at: string | null;
    notes: string | null;
  };
  plan: { id: string; slug: string; name: string } | null;
  metrics: { clients: number; jobs: number; deals: number; team_members: number };
};

type Plan = { id: string; slug: string; name: string };

type Member = {
  id: string;
  name: string | null;
  email: string | null;
  member_user_id: string | null;
  is_active: boolean;
  color: string | null;
  last_sign_in_at: string | null;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function TenantDetailPage() {
  const { ownerId } = useParams<{ ownerId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const { startAsOwner, startAsMember } = useImpersonation();

  const load = async () => {
    setLoading(true);
    const [d, p, m] = await Promise.all([
      authFetch(`/api/platform/tenants/${ownerId}`).then((r) => r.json()),
      authFetch(`/api/platform/plans`).then((r) => r.json()),
      authFetch(`/api/platform/tenants/${ownerId}/members`).then((r) => r.json()),
    ]);
    setData(d);
    setPlans(p);
    setMembers(Array.isArray(m) ? m : []);
    setNotes(d.account?.notes ?? "");
    setPlanId(d.account?.plan_id ?? "");
    setLoading(false);
  };

  useEffect(() => { if (ownerId) load(); }, [ownerId]);

  const update = async (body: Record<string, any>) => {
    setSaving(true);
    const r = await authFetch(`/api/platform/tenants/${ownerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) {
      const err = await r.json();
      alert(err.error ?? "Falha ao atualizar");
      return;
    }
    await load();
  };

  const suspend = async () => {
    const reason = prompt("Motivo da suspensão (visível no log):") ?? "";
    if (reason === null) return;
    await update({ status: "suspended", suspended_reason: reason });
  };
  const reactivate = () => update({ status: "active", suspended_reason: null });

  const extendTrial = async (extraDays: number) => {
    setSaving(true);
    const r = await authFetch(`/api/platform/tenants/${ownerId}/extend-trial`, {
      method: "POST",
      body: JSON.stringify({ extraDays }),
    });
    setSaving(false);
    if (!r.ok) {
      const err = await r.json();
      alert(err.error ?? "Falha ao estender trial");
      return;
    }
    await load();
  };

  const softDelete = async () => {
    if (!confirm("Marcar conta como EXCLUÍDA? O usuário ficará impedido de logar, mas os dados permanecem no banco.")) return;
    const reason = prompt("Motivo (opcional):") ?? "";
    const r = await authFetch(`/api/platform/tenants/${ownerId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) {
      alert("Falha ao excluir");
      return;
    }
    await load();
  };

  const impersonate = async () => {
    if (!data) return;
    if (!confirm(`Entrar como ${data.email}? Toda ação ficará registrada no audit log.`)) return;
    await startAsOwner(data.owner_user_id, data.email);
  };

  const impersonateMember = async (m: Member) => {
    if (!data) return;
    if (!m.member_user_id) {
      alert("Este membro ainda não acessou (sem login vinculado). Peça pra ele aceitar o convite primeiro.");
      return;
    }
    const label = m.name || m.email || m.id;
    if (!confirm(`Entrar como o membro "${label}"? Você verá o app com as permissões dele.`)) return;
    await startAsMember(m.id, label, data.owner_user_id, data.email);
  };

  if (loading || !data) return <div className="p-10 text-sm text-gray-500">Carregando…</div>;

  const isDeleted = data.account.status === "deleted";
  const isSuspended = data.account.status === "suspended";

  return (
    <div className="p-8 max-w-5xl">
      <Link to="/platform-admin/tenants" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Empresas
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{data.email}</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{data.owner_user_id}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={impersonate}
            disabled={isDeleted}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold"
          >
            <LogIn size={16} /> Entrar como
          </button>
          {isSuspended ? (
            <button onClick={reactivate} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm">
              <Play size={16} /> Reativar
            </button>
          ) : (
            <button onClick={suspend} disabled={isDeleted} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 text-white rounded-lg text-sm">
              <Pause size={16} /> Suspender
            </button>
          )}
          <button onClick={softDelete} disabled={isDeleted} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg text-sm">
            <Trash2 size={16} /> Excluir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Metric label="Clientes"  value={data.metrics.clients} />
        <Metric label="Jobs"      value={data.metrics.jobs} />
        <Metric label="Deals"     value={data.metrics.deals} />
        <Metric label="Membros"   value={data.metrics.team_members} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-sm mb-3">Conta</h3>
          <dl className="text-sm space-y-2">
            <Row label="Status"        value={data.account.status} />
            <Row label="Cadastro"      value={fmtDate(data.created_at)} />
            <Row label="Último login"  value={fmtDate(data.last_sign_in_at)} />
            <Row label="Trial até"     value={fmtDate(data.account.trial_ends_at)} />
            {data.account.suspended_reason && (
              <Row label="Motivo" value={data.account.suspended_reason} />
            )}
          </dl>
          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => extendTrial(7)}
              disabled={saving}
              className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              + 7 dias de trial
            </button>
            <button
              onClick={() => extendTrial(14)}
              disabled={saving}
              className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
              title="Estende até o máximo de 14 dias contados do início"
            >
              + 14 dias (negociação)
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-sm mb-3">Plano</h3>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm mb-3"
          >
            <option value="">Sem plano</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
            ))}
          </select>
          <button
            onClick={() => update({ plan_id: planId || null })}
            disabled={saving || planId === (data.account.plan_id ?? "")}
            className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg text-sm"
          >
            Salvar plano
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Equipe ({members.length})</h3>
        </div>
        {members.length === 0 ? (
          <div className="text-sm text-gray-500">Esta empresa ainda não tem membros de equipe.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 -mx-5">
            {members.map((m) => {
              const initial = (m.name || m.email || "?").trim().charAt(0).toUpperCase();
              const linked = !!m.member_user_id;
              return (
                <div key={m.id} className="px-5 py-3 flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                    style={{ backgroundColor: m.color || "#6366f1" }}
                  >
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{m.name || "(sem nome)"}</span>
                      {!m.is_active && (
                        <span className="text-[10px] uppercase bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">inativo</span>
                      )}
                      {!linked && (
                        <span className="text-[10px] uppercase bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded">convite pendente</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 truncate"><Mail size={11} /> {m.email}</span>
                      <span className="hidden md:inline whitespace-nowrap">Último login: {fmtDate(m.last_sign_in_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => impersonateMember(m)}
                    disabled={!linked}
                    title={linked ? "Entrar como este membro" : "Membro ainda não logou pela primeira vez"}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold"
                  >
                    <LogIn size={13} /> Entrar como
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 mt-4">
        <h3 className="font-semibold text-sm mb-3">Notas internas (visíveis apenas para admins)</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm mb-3"
          placeholder="Histórico de suporte, observações, etc."
        />
        <button
          onClick={() => update({ notes })}
          disabled={saving || notes === (data.account.notes ?? "")}
          className="px-3 py-2 bg-gray-900 hover:bg-black dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-40 text-white rounded-lg text-sm"
        >
          Salvar notas
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right text-gray-900 dark:text-gray-100 font-medium">{value ?? "—"}</dd>
    </div>
  );
}
