import React from "react";
import { NavLink } from "react-router-dom";
import { Calendar, Camera, DollarSign, LayoutDashboard, Settings, Trello, Users } from "lucide-react";

import { cn } from "../../utils/cn";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/clients", label: "Clientes", icon: Users },
  { to: "/jobs", label: "Jobs", icon: Camera },
  { to: "/pipeline", label: "Pipeline", icon: Trello },
  { to: "/calendar", label: "Agenda", icon: Calendar },
  { to: "/finance", label: "Financeiro", icon: DollarSign },
];

const settingsItem = { to: "/settings", label: "Configurações", icon: Settings };

export default function Sidebar() {
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
          <Camera size={24} />
        </div>
        <h1 className="text-xl font-bold tracking-tight">FocalPoint</h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
                isActive
                  ? "bg-indigo-50 text-indigo-700 font-semibold"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              )
            }
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <NavLink
          to={settingsItem.to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
              isActive
                ? "bg-indigo-50 text-indigo-700 font-semibold"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            )
          }
        >
          <settingsItem.icon size={20} />
          <span className="font-medium">{settingsItem.label}</span>
        </NavLink>
      </div>
    </aside>
  );
}
