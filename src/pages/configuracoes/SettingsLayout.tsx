import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Building2, CreditCard, Plug, Users, Shield, Target } from "lucide-react";

const SECTIONS = [
  { to: "/configuracoes/empresa",       label: "Empresa",                    icon: Building2 },
  { to: "/configuracoes/plano",         label: "Plano",                      icon: CreditCard },
  { to: "/configuracoes/integracoes",   label: "Integrações",                icon: Plug },
  { to: "/configuracoes/equipe",        label: "Equipe",                     icon: Users },
  { to: "/configuracoes/permissoes",    label: "Permissões",                 icon: Shield },
  { to: "/configuracoes/oportunidades", label: "Configurações de oportunidades", icon: Target },
];

export default function SettingsLayout() {
  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* Sidebar interna */}
      <aside className="lg:w-56 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">Configurações</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Gerencie sua conta, equipe e integrações.
        </p>
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-2 lg:mx-0 px-2 lg:px-0">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-300"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Conteúdo da seção ativa */}
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
