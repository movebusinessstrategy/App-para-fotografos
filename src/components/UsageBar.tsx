import React from "react";
import { Link } from "react-router-dom";
import { useApi } from "../utils/useApi";

interface LimitInfo {
  current: number;
  max: number;
  allowed: boolean;
}

type Resource = "clients" | "jobs" | "team_members";

const LABEL: Record<Resource, string> = {
  clients: "clientes",
  jobs: "jobs",
  team_members: "vendedores",
};

interface UsageBarProps {
  resource: Resource;
  /** Compacto = só barrinha + texto. Default = card mais visível. */
  compact?: boolean;
}

export default function UsageBar({ resource, compact = false }: UsageBarProps) {
  const { data } = useApi<Record<Resource, LimitInfo>>("/api/billing/limits");
  const info = data?.[resource];
  if (!info) return null;
  if (info.max < 0) return null; // ilimitado - não mostra nada

  const pct = Math.min(100, Math.round((info.current / info.max) * 100));
  const nearLimit = pct >= 80;
  const atLimit = info.current >= info.max;
  const color = atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500";

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{info.current}/{info.max}</span>
        <div className="w-20 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {atLimit && (
          <Link to="/planos" className="text-gold-600 dark:text-gold-400 font-medium hover:underline">
            Upgrade
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm ${
      atLimit
        ? "border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/50"
        : nearLimit
        ? "border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-900/50"
        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
            {info.current} de {info.max} {LABEL[resource]}
          </span>
          {atLimit ? (
            <Link to="/planos" className="text-xs font-semibold text-gold-700 dark:text-gold-400 hover:underline whitespace-nowrap">
              Fazer upgrade →
            </Link>
          ) : nearLimit ? (
            <Link to="/planos" className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap">
              Limite próximo
            </Link>
          ) : null}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
