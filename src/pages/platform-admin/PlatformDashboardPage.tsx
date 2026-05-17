import { useEffect, useState } from "react";
import { Activity, DollarSign, TrendingUp, Users2 } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

type Metrics = {
  total_users: number;
  accounts_by_status: { active: number; suspended: number; deleted: number };
  accounts_by_plan: Record<string, number>;
  mrr_cents: number;
  new_last_30_days: number;
};

const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PlatformDashboardPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/platform/metrics")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Falha ao carregar");
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-10 text-sm text-gray-500">Carregando métricas…</div>;
  if (err) return <div className="p-10 text-sm text-red-500">{err}</div>;
  if (!data) return null;

  const cards = [
    { label: "Usuários totais",   value: data.total_users.toString(),               icon: Users2,     color: "from-blue-500 to-blue-600"  },
    { label: "Contas ativas",     value: data.accounts_by_status.active.toString(), icon: Activity,   color: "from-green-500 to-green-600" },
    { label: "MRR estimado",      value: fmtMoney(data.mrr_cents),                  icon: DollarSign, color: "from-purple-500 to-purple-600" },
    { label: "Novos (30 dias)",   value: data.new_last_30_days.toString(),          icon: TrendingUp, color: "from-orange-500 to-orange-600" },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-1">Visão geral</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Saúde da plataforma em tempo real</p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${c.color} flex items-center justify-center mb-3`}>
              <c.icon size={20} className="text-white" />
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{c.label}</div>
            <div className="text-2xl font-bold mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold mb-3 text-sm">Contas por status</h3>
          <div className="space-y-2 text-sm">
            <Row label="Ativas"     value={data.accounts_by_status.active}    color="text-green-600" />
            <Row label="Suspensas"  value={data.accounts_by_status.suspended} color="text-yellow-600" />
            <Row label="Excluídas" value={data.accounts_by_status.deleted}   color="text-red-600" />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold mb-3 text-sm">Contas por plano</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(data.accounts_by_plan).map(([slug, count]) => (
              <div key={slug}>
                <Row label={slug} value={count as number} />
              </div>
            ))}
            {Object.keys(data.accounts_by_plan).length === 0 && (
              <div className="text-xs text-gray-400">Sem contas registradas ainda.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="capitalize text-gray-700 dark:text-gray-300">{label}</span>
      <span className={`font-semibold ${color ?? ""}`}>{value}</span>
    </div>
  );
}
