import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

type Tenant = {
  owner_user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  status: "active" | "suspended" | "deleted";
  plan_slug: string | null;
  plan_name: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  active:    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  suspended: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  deleted:   "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function TenantsListPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    authFetch("/api/platform/tenants?page_size=100")
      .then((r) => r.json())
      .then((d) => setTenants(d.tenants ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (search && !(t.email ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tenants, search, statusFilter]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Todas as empresas cadastradas na plataforma</p>
        </div>
        <div className="text-sm text-gray-500">{filtered.length} de {tenants.length}</div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="suspended">Suspensos</option>
          <option value="deleted">Excluídos</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">Nenhuma empresa encontrada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left px-4 py-3 font-medium">E-mail</th>
                <th className="text-left px-4 py-3 font-medium">Plano</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Cadastro</th>
                <th className="text-left px-4 py-3 font-medium">Último login</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((t) => (
                <tr key={t.owner_user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <Link to={`/platform-admin/tenants/${t.owner_user_id}`} className="font-medium text-purple-700 dark:text-purple-400 hover:underline">
                      {t.email ?? "(sem e-mail)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.plan_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] ?? ""}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(t.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtDate(t.last_sign_in_at)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/platform-admin/tenants/${t.owner_user_id}`} className="text-gray-400 hover:text-gray-700">
                      <ChevronRight size={16} />
                    </Link>
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
