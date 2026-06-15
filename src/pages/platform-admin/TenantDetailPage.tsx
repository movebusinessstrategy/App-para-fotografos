import { type ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, CheckCircle2, FileSignature, LogIn, Mail, MessageCircle, Pause, Play, Trash2, XCircle } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { useImpersonation } from "../../contexts/ImpersonationContext";
import { ConfirmModal } from "../../components/ui/ConfirmModal";

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
    subscription_status?: string | null;
    trial_started_at?: string | null;
  };
  plan: { id: string; slug: string; name: string } | null;
  metrics: { clients: number; jobs: number; deals: number; team_members: number; contracts?: number };
  integrations?: {
    google_calendar: { connected: boolean; expires_at: string | null };
    autentique: { connected: boolean };
    asaas: { customer_id: string | null };
    whatsapp: { phone_number_id: string | null; status: string | null; display_phone_number: string | null };
    studio_name: string | null;
  };
  recent?: {
    jobs: Array<{ id: number; job_name: string | null; job_date: string | null; status: string; created_at: string; client_id: number | null }>;
    deals: Array<{ id: number; title: string | null; value: number | null; stage: string | null; created_at: string }>;
    contracts: Array<{ id: number; status: string; created_at: string; signed_at: string | null; client_id: number | null }>;
  };
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  deleted: "Excluída",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  suspended: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  deleted: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
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
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";

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

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const confirmSuspend = async () => {
    setSuspendOpen(false);
    await update({ status: "suspended", suspended_reason: suspendReason || null });
    setSuspendReason("");
  };
  const confirmReactivate = async () => {
    setReactivateOpen(false);
    await update({ status: "active", suspended_reason: null });
  };

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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{data.email}</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[data.account.status] ?? STATUS_BADGE.active}`}>
              {STATUS_LABEL[data.account.status] ?? data.account.status}
            </span>
            {data.integrations?.studio_name && (
              <span className="text-sm text-gray-500 dark:text-gray-400">· {data.integrations.studio_name}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-mono mt-1">{data.owner_user_id}</p>
          {data.account.suspended_reason && isSuspended && (
            <p className="mt-2 text-sm text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2">
              <strong>Motivo da suspensão:</strong> {data.account.suspended_reason}
            </p>
          )}
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
            <button onClick={() => setReactivateOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm">
              <Play size={16} /> Reativar
            </button>
          ) : (
            <button onClick={() => setSuspendOpen(true)} disabled={isDeleted} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 text-white rounded-lg text-sm">
              <Pause size={16} /> Suspender
            </button>
          )}
          <button onClick={softDelete} disabled={isDeleted} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg text-sm">
            <Trash2 size={16} /> Excluir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Metric label="Clientes"  value={data.metrics.clients} />
        <Metric label="Trabalhos" value={data.metrics.jobs} />
        <Metric label="Vendas"    value={data.metrics.deals} />
        <Metric label="Contratos" value={data.metrics.contracts ?? 0} />
        <Metric label="Membros"   value={data.metrics.team_members} />
      </div>

      {data.integrations && (
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800 mb-4">
          <h3 className="font-semibold text-sm mb-3">Integrações</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <IntegrationStatus
              icon={<Calendar size={16} />}
              label="Google Calendar"
              connected={data.integrations.google_calendar.connected}
              detail={data.integrations.google_calendar.connected
                ? (data.integrations.google_calendar.expires_at
                    ? `Token até ${fmtDate(data.integrations.google_calendar.expires_at)}`
                    : "Conectado")
                : "Não conectado"}
            />
            <IntegrationStatus
              icon={<MessageCircle size={16} />}
              label="WhatsApp Cloud"
              connected={!!data.integrations.whatsapp.phone_number_id}
              detail={data.integrations.whatsapp.display_phone_number
                ? `${data.integrations.whatsapp.display_phone_number} (${data.integrations.whatsapp.status ?? "—"})`
                : "Não conectado"}
            />
            <IntegrationStatus
              icon={<FileSignature size={16} />}
              label="Autentique"
              connected={data.integrations.autentique.connected}
              detail={data.integrations.autentique.connected ? "API key configurada" : "Sem API key"}
            />
            <IntegrationStatus
              icon={<CheckCircle2 size={16} />}
              label="Asaas (cobrança)"
              connected={!!data.integrations.asaas.customer_id}
              detail={data.integrations.asaas.customer_id ?? "Sem cliente Asaas"}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-sm mb-3">Conta</h3>
          <dl className="text-sm space-y-2">
            <Row label="Status"        value={STATUS_LABEL[data.account.status] ?? data.account.status} />
            <Row label="Cadastro"      value={fmtDate(data.created_at)} />
            <Row label="Último login"  value={fmtDate(data.last_sign_in_at)} />
            <Row label="Trial iniciado" value={fmtDate(data.account.trial_started_at ?? null)} />
            <Row label="Trial até"     value={fmtDate(data.account.trial_ends_at)} />
            {data.account.subscription_status && (
              <Row label="Assinatura" value={data.account.subscription_status} />
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

      {data.recent && (data.recent.jobs.length + data.recent.deals.length + data.recent.contracts.length) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <RecentList
            title="Últimos trabalhos"
            empty="Sem trabalhos recentes."
            items={data.recent.jobs.map((j) => ({
              key: j.id,
              primary: j.job_name || `Trabalho #${j.id}`,
              secondary: `${j.status} · ${j.job_date ? fmtDate(j.job_date).split(",")[0] : "sem data"}`,
              when: j.created_at,
            }))}
          />
          <RecentList
            title="Últimas vendas (deals)"
            empty="Sem vendas recentes."
            items={data.recent.deals.map((d) => ({
              key: d.id,
              primary: d.title || `Venda #${d.id}`,
              secondary: `${d.stage ?? "—"} · R$ ${(d.value ?? 0).toLocaleString("pt-BR")}`,
              when: d.created_at,
            }))}
          />
          <RecentList
            title="Últimos contratos"
            empty="Sem contratos recentes."
            items={data.recent.contracts.map((c) => ({
              key: c.id,
              primary: `Contrato #${c.id}`,
              secondary: `${c.status}${c.signed_at ? ` · assinado ${fmtDate(c.signed_at).split(",")[0]}` : ""}`,
              when: c.created_at,
            }))}
          />
        </div>
      )}

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

      {/* Modal de suspensão com campo motivo (UX melhor que prompt nativo) */}
      {suspendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setSuspendOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold mb-2">Suspender conta</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              O usuário <strong>{data.email}</strong> não vai conseguir acessar o app até reativar. O motivo fica visível no histórico de ações.
            </p>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Motivo (opcional)</label>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              rows={3}
              placeholder="Ex: Inadimplência confirmada, comportamento abusivo, solicitação do cliente, etc."
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSuspendOpen(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={confirmSuspend} className="px-4 py-2 rounded-lg text-sm bg-yellow-600 hover:bg-yellow-700 text-white font-semibold">
                Suspender
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={reactivateOpen}
        onCancel={() => setReactivateOpen(false)}
        onConfirm={confirmReactivate}
        title="Reativar conta?"
        message={`O usuário ${data.email ?? ""} vai voltar a acessar o app imediatamente.`}
        confirmText="Reativar"
        variant="default"
      />
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

function IntegrationStatus({ icon, label, connected, detail }: { icon: ReactNode; label: string; connected: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${connected ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-xs">
          {label}
          {connected ? <CheckCircle2 size={13} className="text-green-600" /> : <XCircle size={13} className="text-gray-400" />}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={detail}>{detail}</div>
      </div>
    </div>
  );
}

function RecentList({ title, empty, items }: {
  title: string;
  empty: string;
  items: Array<{ key: number; primary: string; secondary: string; when: string }>;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-500">{empty}</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800 -mx-5">
          {items.map((it) => (
            <div key={it.key} className="px-5 py-2.5">
              <div className="text-sm font-medium truncate" title={it.primary}>{it.primary}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                <span className="truncate">{it.secondary}</span>
                <span className="flex-shrink-0">· {fmtDate(it.when).split(",")[0]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right text-gray-900 dark:text-gray-100 font-medium">{value ?? "-"}</dd>
    </div>
  );
}
