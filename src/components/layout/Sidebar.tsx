import React from "react";
import { NavLink } from "react-router-dom";
import {
  Calendar,
  Camera,
  DollarSign,
  FileText,
  LayoutDashboard,
  Settings,
  Settings2,
  Shield,
  Trello,
  TrendingUp,
  Users,
  X
} from "lucide-react";

import { cn } from "../../utils/cn";
import { useAuth } from "../../contexts/AuthContext";

const ALL_NAV_ITEMS = [
  { to: "/",              label: "Dashboard",       icon: LayoutDashboard, end: true,  module: "dashboard" },
  { to: "/clients",       label: "Clientes",         icon: Users,           module: "clients" },
  { to: "/jobs",          label: "Produção",         icon: Camera,          module: "jobs" },
  { to: "/vendas",        label: "Vendas",           icon: Trello,          module: "vendas" },
  { to: "/pipeline-settings", label: "Configurar Funil", icon: Settings2,  module: "vendas" },
  { to: "/calendar",      label: "Agenda",           icon: Calendar,        module: "calendar" },
  { to: "/finance",       label: "Financeiro",       icon: DollarSign,      module: "finance" },
  { to: "/oportunidades", label: "Oportunidades",    icon: TrendingUp,      module: "oportunidades" },
  { to: "/contratos",     label: "Contratos",        icon: FileText,        module: "contratos" },
];

// Admin e configurações — apenas para donos
const OWNER_ITEMS = [
  { to: "/admin",    label: "Administração",  icon: Shield },
  { to: "/settings", label: "Configurações",  icon: Settings },
];

// Membros só podem acessar configurações de conta própria (senha, perfil)
const MEMBER_BOTTOM_ITEMS = [
  { to: "/settings", label: "Configurações",  icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { canAccess, isMember } = useAuth();

  const navItems = ALL_NAV_ITEMS.filter(item => canAccess(item.module));
  const bottomItems = isMember ? MEMBER_BOTTOM_ITEMS : OWNER_ITEMS;

  return (
    <>
      {/* Overlay — apenas mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50",
          "w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col",
          "transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 dark:bg-indigo-500 rounded-xl flex items-center justify-center text-white">
              <Camera size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">FocalPoint</h1>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Badge de membro */}
        {isMember && (
          <div className="mx-4 mb-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center gap-2">
            <Shield size={13} className="text-indigo-500 flex-shrink-0" />
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Acesso de membro</span>
          </div>
        )}

        {/* Navegação */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 w-full px-4 py-3.5 rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-semibold"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                )
              }
            >
              <item.icon size={22} />
              <span className="text-[15px]">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Rodapé */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-1">
          {bottomItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 w-full px-4 py-3.5 rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-semibold"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                )
              }
            >
              <item.icon size={22} />
              <span className="text-[15px] font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </aside>
    </>
  );
}
