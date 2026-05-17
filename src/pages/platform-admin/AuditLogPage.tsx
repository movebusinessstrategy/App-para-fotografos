import { useEffect, useState } from "react";
import { authFetch } from "../../utils/authFetch";

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

const ACTION_COLOR: Record<string, string> = {
  impersonate_start: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  impersonate_stop:  "bg-gray-100 text-gray-700  dark:bg-gray-800 dark:text-gray-300",
  tenant_update:     "bg-blue-100 text-blue-700   dark:bg-blue-900/30 dark:text-blue-300",
  tenant_delete:     "bg-red-100 text-red-700     dark:bg-red-900/30 dark:text-red-300",
  plan_create:       "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  plan_update:       "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  plan_delete:       "bg-red-100 text-red-700     dark:bg-red-900/30 dark:text-red-300",
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/platform/audit-log?limit=100")
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-1">Auditoria</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Últimas 100 ações administrativas</p>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">Nenhuma ação registrada ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Quando</th>
                <th className="text-left px-4 py-3 font-medium">Admin</th>
                <th className="text-left px-4 py-3 font-medium">Ação</th>
                <th className="text-left px-4 py-3 font-medium">Alvo</th>
                <th className="text-left px-4 py-3 font-medium">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">{r.admin_email ?? r.admin_user_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-mono ${ACTION_COLOR[r.action] ?? "bg-gray-100 text-gray-700"}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.target_email ?? "—"}</td>
                  <td className="px-4 py-3">
                    {Object.keys(r.metadata ?? {}).length > 0 ? (
                      <code className="text-xs bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded">
                        {JSON.stringify(r.metadata)}
                      </code>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
