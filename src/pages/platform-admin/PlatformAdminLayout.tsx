import { Suspense } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { ArrowLeft, BarChart3, FileClock, Layers, ShieldCheck, Users2 } from "lucide-react";
import { cn } from "../../utils/cn";

const NAV = [
  { to: "/platform-admin",           label: "Visão geral", icon: BarChart3,   end: true },
  { to: "/platform-admin/tenants",   label: "Empresas",    icon: Users2 },
  { to: "/platform-admin/plans",     label: "Planos",      icon: Layers },
  { to: "/platform-admin/audit-log", label: "Auditoria",   icon: FileClock },
];

export default function PlatformAdminLayout() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold">Platform Admin</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">Console do SaaS</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm",
                  isActive
                    ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                )
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2"
          >
            <ArrowLeft size={14} /> Voltar ao app
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Suspense
          fallback={
            <div className="p-10 flex justify-center">
              <div className="animate-spin h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
