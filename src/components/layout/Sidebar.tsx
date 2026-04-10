import React from "react";
import { NavLink } from "react-router-dom";
import {
  Calendar,
  Camera,
  DollarSign,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Settings,
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
  { to: "/calendar",      label: "Agenda",           icon: Calendar,        module: "calendar" },
  { to: "/finance",       label: "Financeiro",       icon: DollarSign,      module: "finance" },
  { to: "/oportunidades", label: "Oportunidades",    icon: TrendingUp,      module: "oportunidades" },
  { to: "/contratos",     label: "Contratos",        icon: FileText,        module: "contratos" },
  { to: "/inbox",         label: "Inbox WhatsApp",   icon: MessageCircle,   module: "inbox" },
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
          <div className="flex items-center gap-2.5">
            {/* FotoMOVE icon — 4 curved quadrants */}
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 4C17 4 7 5.5 4.5 17H17V4Z" fill="#F1C665"/>
              <path d="M19 4C19 4 29 5.5 31.5 17H19V4Z" fill="#D4A94A"/>
              <path d="M17 32C17 32 7 30.5 4.5 19H17V32Z" fill="#D4A94A"/>
              <path d="M19 32C19 32 29 30.5 31.5 19H19V32Z" fill="#F1C665"/>
            </svg>
            <span className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
              Foto<span style={{ color: "#D4A94A" }}>MOVE</span>
            </span>
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
          <div className="mx-4 mb-2 px-3 py-1.5 bg-gold-50 dark:bg-gold-900/30 rounded-lg flex items-center gap-2">
            <Shield size={13} className="text-gold-500 flex-shrink-0" />
            <span className="text-xs font-medium text-gold-600 dark:text-gold-400">Acesso de membro</span>
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
                    ? "bg-gold-50 dark:bg-gold-500/20 text-gold-700 dark:text-gold-300 font-semibold"
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
                    ? "bg-gold-50 dark:bg-gold-500/20 text-gold-700 dark:text-gold-300 font-semibold"
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
