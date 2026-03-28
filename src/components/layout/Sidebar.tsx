import React from "react";
import { NavLink } from "react-router-dom";
import {
  Calendar,
  Camera,
  DollarSign,
  LayoutDashboard,
  Settings,
  Settings2,
  Trello,
  Users,
  Video,
  X
} from "lucide-react";

import { cn } from "../../utils/cn";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/clients", label: "Clientes", icon: Users },
  { to: "/jobs", label: "Jobs", icon: Camera },
  { to: "/vendas", label: "Vendas", icon: Trello },
  { to: "/pipeline-settings", label: "Configurar Funil", icon: Settings2 },
  { to: "/calendar", label: "Agenda", icon: Calendar },
  { to: "/finance", label: "Financeiro", icon: DollarSign },
  { to: "/video-editor", label: "Editor de Vídeo", icon: Video },
];

const settingsItem = { to: "/settings", label: "Configurações", icon: Settings };

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* Overlay - apenas mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          // Base styles
          "fixed lg:static inset-y-0 left-0 z-50",
          "w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col",
          "transform transition-transform duration-300 ease-in-out",
          // Mobile: escondido por padrão, visível quando isOpen
          isOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: sempre visível
          "lg:translate-x-0"
        )}
      >
        {/* Header da Sidebar */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 dark:bg-indigo-500 rounded-xl flex items-center justify-center text-white">
              <Camera size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">FocalPoint</h1>
          </div>
          
          {/* Botão fechar - apenas mobile */}
          <button 
            onClick={onClose}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

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

        {/* Configurações */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <NavLink
            to={settingsItem.to}
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
            <settingsItem.icon size={22} />
            <span className="text-[15px] font-medium">{settingsItem.label}</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}
