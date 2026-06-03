import { useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { authFetch } from "../../utils/authFetch";

type Admin = {
  user_id: string;
  email: string | null;
  role: string;
  created_at: string;
  created_by: string | null;
  last_sign_in_at: string | null;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await authFetch("/api/platform/admins");
    if (r.ok) setAdmins(await r.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    setError(null);
    setSaving(true);
    try {
      const r = await authFetch("/api/platform/admins", {
        method: "POST",
        body: JSON.stringify({ email: newEmail.trim().toLowerCase() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setError(err.error ?? `Falha ao adicionar (HTTP ${r.status})`);
        return;
      }
      setNewEmail("");
      setAdding(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Admin) => {
    if (!confirm(`Remover acesso super-admin de ${a.email ?? a.user_id}? Ele perde o painel imediatamente.`)) return;
    const r = await authFetch(`/api/platform/admins/${a.user_id}`, { method: "DELETE" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error ?? "Falha ao remover");
      return;
    }
    await load();
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Super-admins</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Quem tem acesso a este painel administrativo. Toda ação fica registrada na auditoria.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null); }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold"
          >
            <Plus size={16} /> Adicionar admin
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-purple-200 dark:border-purple-800/40 mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <UserPlus size={16} className="text-purple-600" />
            Conceder acesso super-admin
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Digite o e-mail de uma conta que JÁ existe no app. O acesso é concedido na hora.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@exemplo.com"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && newEmail.trim()) add(); }}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
            />
            <button
              onClick={add}
              disabled={saving || !newEmail.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold"
            >
              {saving ? "Adicionando…" : "Adicionar"}
            </button>
            <button
              onClick={() => { setAdding(false); setNewEmail(""); setError(null); }}
              className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
          </div>
          {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-10 text-sm text-gray-500 text-center">Carregando…</div>
        ) : admins.length === 0 ? (
          <div className="p-10 text-sm text-gray-500 text-center">Nenhum admin cadastrado.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {admins.map((a) => (
              <div key={a.user_id} className="px-5 py-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck size={16} className="text-purple-600 dark:text-purple-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{a.email ?? "(sem e-mail)"}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-mono">{a.user_id.slice(0, 8)}…</span>
                    <span>Função: {a.role}</span>
                    <span>Desde {fmtDate(a.created_at)}</span>
                    <span>Último login: {fmtDate(a.last_sign_in_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => remove(a)}
                  className="px-3 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 hover:bg-red-100 rounded-lg flex items-center gap-1.5 text-xs font-semibold"
                  title="Remover acesso super-admin"
                >
                  <Trash2 size={13} /> Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Travas de segurança: não dá pra remover o último admin (o painel ficaria inacessível) nem remover você mesmo.
        Pra adicionar alguém, peça pra essa pessoa criar conta no app primeiro — aqui só funciona com e-mail já cadastrado.
      </p>
    </div>
  );
}
