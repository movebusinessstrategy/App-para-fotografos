import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Calendar,
  Workflow,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Receipt,
  FileText,
  Images,
  BookImage,
  LayoutDashboard,
  Layers,
  ListChecks,
  Package,
  Settings,
  Shield,
  ShieldCheck,
  Trello,
  TrendingUp,
  Users,
  X,
  Briefcase,
  BookOpen,
  Bot,
  HeartHandshake,
} from "lucide-react";

import { cn } from "../../utils/cn";
import { useAuth } from "../../contexts/AuthContext";

const ALL_NAV_ITEMS = [
  { to: "/dashboard",     label: "Dashboard",       icon: LayoutDashboard, end: true,  module: "dashboard" },
  { to: "/vendas",        label: "Vendas",           icon: Trello,          module: "vendas" },
  { to: "/oportunidades", label: "Oportunidades",    icon: TrendingUp,      module: "oportunidades" },
  { to: "/clients",       label: "Clientes",         icon: Users,           module: "clients" },
  { to: "/jobs",          label: "Produção",         icon: Workflow,        module: "jobs" },
  { to: "/pos-venda",     label: "Pós-venda",        icon: HeartHandshake,  module: "posvenda" },
  { to: "/tarefas",       label: "Tarefas",          icon: ListChecks,      module: "jobs" },
  { to: "/galeria",       label: "Galeria",          icon: Images,          module: "jobs", feature: "gallery" },
  { to: "/album",         label: "Álbuns",           icon: BookImage,       module: "jobs", feature: "album" },
  { to: "/finance",       label: "Financeiro",       icon: DollarSign,      module: "finance" },
  { to: "/fiscal",        label: "Nota Fiscal",      icon: Receipt,         module: "finance", feature: "nota_fiscal" },
  { to: "/calendar",      label: "Agenda",           icon: Calendar,        module: "calendar" },
  { to: "/agente",        label: "Agente IA",        icon: Bot,             module: "agente" },
  { to: "/contratos",     label: "Contratos",        icon: FileText,        module: "contratos" },
];

// Item único de configurações - leva pra central com sidebar interna
const OWNER_ITEMS = [
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const MEMBER_BOTTOM_ITEMS = [
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const CATALOGO_SUBITEMS = [
  { to: "/catalogo?aba=produtos", label: "Produtos",   icon: Package,   aba: "produtos"   },
  { to: "/catalogo?aba=servicos", label: "Serviços",   icon: Briefcase, aba: "servicos"   },
  { to: "/catalogo?aba=combos",   label: "Combos",     icon: Layers,    aba: "combos"     },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { canAccess, isMember, isPlatformAdmin, isProductionOnly, features } = useAuth();
  const location = useLocation();

  const isCatalogo = location.pathname === "/catalogo";
  const [catalogoOpen, setCatalogoOpen] = useState(isCatalogo);

  // Esconde itens não liberados pelo plano (galeria/álbum só Studio/Premium).
  const planAllowsItem = (item: { feature?: string }) =>
    !item.feature || features[item.feature as keyof typeof features] !== false;

  // Papel de produção: vê SÓ "Produção", nada mais (sem catálogo/config/tarefas).
  const navItems = isProductionOnly
    ? ALL_NAV_ITEMS.filter(item => item.to === "/jobs")
    : ALL_NAV_ITEMS.filter(item => canAccess(item.module) && planAllowsItem(item));
  const bottomItems = isProductionOnly ? [] : (isMember ? MEMBER_BOTTOM_ITEMS : OWNER_ITEMS);

  const currentAba = new URLSearchParams(location.search).get("aba") ?? "produtos";

  return (
    <>
      {/* Overlay - apenas mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50",
          "w-64 bg-white dark:bg-[#0d0d0d] border-r border-black/5 dark:border-white/5 flex flex-col",
          "transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center">
            <img src="/logo-light.png" alt="CRM Trilha" className="h-9 w-auto dark:hidden" />
            <img src="/logo-dark.png" alt="CRM Trilha" className="h-9 w-auto hidden dark:block" />
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

          {/* Pasta Catálogo */}
          {!isProductionOnly && canAccess("catalogo") && (
            <div>
              <button
                onClick={() => setCatalogoOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-3.5 rounded-xl transition-all duration-200",
                  isCatalogo
                    ? "bg-gold-50 dark:bg-gold-500/20 text-gold-700 dark:text-gold-300 font-semibold"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                <BookOpen size={22} />
                <span className="text-[15px] flex-1 text-left">Catálogo</span>
                {catalogoOpen
                  ? <ChevronDown size={15} className="opacity-50" />
                  : <ChevronRight size={15} className="opacity-50" />
                }
              </button>

              {catalogoOpen && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l-2 border-black/5 dark:border-white/10 pl-3">
                  {CATALOGO_SUBITEMS.map((sub) => {
                    const isActive = isCatalogo && currentAba === sub.aba;
                    return (
                      <NavLink
                        key={sub.aba}
                        to={sub.to}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg transition-all duration-200 text-[14px]",
                          isActive
                            ? "bg-gold-50 dark:bg-gold-500/20 text-gold-700 dark:text-gold-300 font-semibold"
                            : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                        )}
                      >
                        <sub.icon size={16} />
                        {sub.label}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Rodapé */}
        <div className="p-4 border-t border-black/5 dark:border-white/5 space-y-1">
          {isPlatformAdmin && (
            <NavLink
              to="/platform-admin"
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 w-full px-4 py-3.5 rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold"
                    : "text-purple-600 dark:text-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/20"
                )
              }
            >
              <ShieldCheck size={22} />
              <span className="text-[15px] font-medium">Platform Admin</span>
            </NavLink>
          )}
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
