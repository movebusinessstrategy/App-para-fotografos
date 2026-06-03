import { useEffect, useState } from "react";
import { authFetch } from "../../utils/authFetch";
import { ChevronDown, ChevronRight } from "lucide-react";

type AuditRow = {
  id: number;
  admin_user_id: string;
  admin_email: string | null;
  action: string;
  target_owner_id: string | null;
  target_email: string | null;
  metadata: Record<string, any>;
  created_at: string;
  ip: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  impersonate_start: "Entrou como (impersonação)",
  impersonate_stop:  "Encerrou impersonação",
  tenant_update:     "Atualizou conta",
  tenant_delete:     "Excluiu conta",
  trial_extended:    "Estendeu trial",
  plan_create:       "Criou plano",
  plan_update:       "Atualizou plano",
  plan_delete:       "Excluiu plano",
  admin_grant:       "Concedeu acesso admin",
  admin_revoke:      "Removeu acesso admin",
};

const ACTION_COLOR: Record<string, string> = {
  impersonate_start: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  impersonate_stop:  "bg-gray-100 text-gray-700  dark:bg-gray-800 dark:text-gray-300",
  tenant_update:     "bg-blue-100 text-blue-700   dark:bg-blue-900/30 dark:text-blue-300",
  tenant_delete:     "bg-red-100 text-red-700     dark:bg-red-900/30 dark:text-red-300",
  trial_extended:    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  plan_create:       "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  plan_update:       "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  plan_delete:       "bg-red-100 text-red-700     dark:bg-red-900/30 dark:text-red-300",
  admin_grant:       "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  admin_revoke:      "bg-red-100 text-red-700     dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_LABEL: Record<string, string> = {
  active: "ativa",
  suspended: "suspensa",
  deleted: "excluída",
};

// Converte metadata em descrição PT-BR legível baseada no tipo da ação.
function describeMetadata(action: string, meta: Record<string, any> | null | undefined): string[] {
  if (!meta || typeof meta !== "object") return [];
  const out: string[] = [];

  if (action === "tenant_update") {
    if (typeof meta.status === "string") {
      out.push(`Status → ${STATUS_LABEL[meta.status] ?? meta.status}`);
    }
    if (typeof meta.suspended_reason === "string" && meta.suspended_reason.trim()) {
      out.push(`Motivo: "${meta.suspended_reason.trim()}"`);
    } else if (meta.suspended_reason === null) {
      out.push("Motivo removido");
    }
    if (typeof meta.plan_id === "string") {
      out.push(`Plano alterado (id: ${meta.plan_id.slice(0, 8)}…)`);
    } else if (meta.plan_id === null) {
      out.push("Plano removido");
    }
    if (typeof meta.notes === "string") {
      const preview = meta.notes.length > 60 ? meta.notes.slice(0, 60) + "…" : meta.notes;
      out.push(`Notas atualizadas: "${preview}"`);
    }
    if (typeof meta.trial_ends_at === "string") {
      out.push(`Trial até ${new Date(meta.trial_ends_at).toLocaleDateString("pt-BR")}`);
    }
  } else if (action === "trial_extended") {
    if (meta.extraDays) out.push(`+${meta.extraDays} dias`);
    if (meta.newEndsAt) out.push(`Novo fim: ${new Date(meta.newEndsAt).toLocaleDateString("pt-BR")}`);
  } else if (action === "tenant_delete") {
    if (meta.reason) out.push(`Motivo: "${meta.reason}"`);
  } else if (action === "impersonate_start") {
    if (meta.as_member_id) out.push(`Entrou como membro (id ${String(meta.as_member_id).slice(0, 8)}…)`);
    if (meta.label) out.push(`Identificação: ${meta.label}`);
  } else if (action === "plan_create" || action === "plan_update") {
    if (meta.slug) out.push(`Slug: ${meta.slug}`);
    if (meta.name) out.push(`Nome: ${meta.name}`);
    if (typeof meta.price_cents === "number") out.push(`Preço: R$ ${(meta.price_cents / 100).toFixed(2)}`);
  } else if (action === "admin_grant") {
    if (meta.email) out.push(`E-mail: ${meta.email}`);
    if (meta.role) out.push(`Função: ${meta.role}`);
  }

  return out;
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    authFetch("/api/platform/audit-log?limit=100")
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-1">Histórico de Ações</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Últimas 100 ações administrativas (a mais recente primeiro)</p>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">Nenhuma ação registrada ainda.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => {
              const isOpen = expanded.has(r.id);
              const description = describeMetadata(r.action, r.metadata);
              const hasMeta = Object.keys(r.metadata ?? {}).length > 0;
              return (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleExpand(r.id)}
                      disabled={!hasMeta}
                      className="mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      aria-label={isOpen ? "Esconder detalhes" : "Mostrar detalhes"}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ACTION_COLOR[r.action] ?? "bg-gray-100 text-gray-700"}`}>
                          {ACTION_LABEL[r.action] ?? r.action}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          {new Date(r.created_at).toLocaleString("pt-BR")}
                        </span>
                        <span className="text-gray-600 dark:text-gray-300">
                          por <strong>{r.admin_email ?? r.admin_user_id.slice(0, 8)}</strong>
                        </span>
                        {r.target_email && (
                          <span className="text-gray-600 dark:text-gray-300">
                            em <strong>{r.target_email}</strong>
                          </span>
                        )}
                      </div>
                      {description.length > 0 && (
                        <div className="mt-1.5 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                          {description.map((line, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                              <span className="text-gray-400 mt-0.5">·</span>
                              <span>{line}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isOpen && hasMeta && (
                        <details open className="mt-2">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">JSON cru</summary>
                          <pre className="mt-1.5 text-[11px] bg-gray-50 dark:bg-gray-800 p-3 rounded overflow-x-auto text-gray-700 dark:text-gray-300">
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
