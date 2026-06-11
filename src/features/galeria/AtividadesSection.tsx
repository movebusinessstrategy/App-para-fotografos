import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Check, ChevronRight, CircleCheck, Eye, Heart,
  LogIn, MessageSquare, Receipt, ShieldOff, X,
} from "lucide-react";

import { authFetch } from "../../utils/authFetch";

interface AuditEvent {
  id: string;
  event: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  photo_id: string | null;
  photo_name: string | null;
  user: { id: string; email: string | null; name: string | null } | null;
}

interface AuditSummary {
  total_users: number;
  total_views: number;
  total_logins: number;
  total_login_fails: number;
  selected_count: number;
  comments_count: number;
  last_event_at: string | null;
  finalized_at: string | null;
}

interface AtividadesSectionProps {
  galleryId: string;
}

const EVENT_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  login:           { label: "Entrou",             icon: LogIn,         color: "text-emerald-600 dark:text-emerald-400" },
  login_fail:      { label: "Login falhou",       icon: ShieldOff,     color: "text-red-600 dark:text-red-400" },
  view_gallery:    { label: "Abriu a galeria",    icon: Eye,           color: "text-blue-600 dark:text-blue-400" },
  select_photo:    { label: "Marcou foto",        icon: Heart,         color: "text-pink-600 dark:text-pink-400" },
  unselect_photo:  { label: "Desmarcou foto",     icon: X,             color: "text-gray-500" },
  comment_photo:   { label: "Comentou",           icon: MessageSquare, color: "text-amber-600 dark:text-amber-400" },
  finalize:        { label: "Finalizou seleção",  icon: CircleCheck,   color: "text-emerald-600 dark:text-emerald-400" },
  pay_success:     { label: "Pagou",              icon: Receipt,       color: "text-emerald-600 dark:text-emerald-400" },
};

function formatBR(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function eventInfo(e: AuditEvent) {
  return EVENT_META[e.event] || { label: e.event, icon: Activity, color: "text-gray-500" };
}

function downloadCsv(events: AuditEvent[], galleryId: string) {
  const headers = ["data", "hora", "usuário", "e-mail", "evento", "foto", "detalhe", "ip", "user_agent"];
  const lines = events.map((e) => {
    const d = e.created_at ? new Date(e.created_at) : null;
    return [
      d ? d.toLocaleDateString("pt-BR") : "",
      d ? d.toLocaleTimeString("pt-BR") : "",
      e.user?.name || "",
      e.user?.email || "",
      eventInfo(e).label,
      e.photo_name || "",
      e.detail || "",
      e.ip || "",
      e.user_agent || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";");
  });
  const csv = "﻿" + [headers.join(";"), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `auditoria-${galleryId.slice(0, 8)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function AtividadesSection({ galleryId }: AtividadesSectionProps) {
  const [data, setData] = useState<{ events: AuditEvent[]; summary: AuditSummary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/galleries/${galleryId}/audit`);
        if (!res.ok) throw new Error("falha");
        setData(await res.json());
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [galleryId]);

  const events = useMemo(() => {
    const all = data?.events || [];
    if (filter === "all") return all;
    return all.filter((e) => e.event === filter);
  }, [data, filter]);

  if (loading) {
    return (
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Activity size={16} className="text-violet-600 dark:text-violet-400" /> Atividades do cliente
        </h3>
        <div className="text-sm text-gray-500 py-3">Carregando…</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Activity size={16} /> Atividades do cliente
        </h3>
        <div className="text-sm text-gray-500 py-3 flex items-center gap-2">
          <AlertTriangle size={14} /> Não foi possível carregar.
        </div>
      </section>
    );
  }

  const visible = showAll ? events : events.slice(0, 8);
  const s = data.summary;

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Activity size={18} className="text-violet-600 dark:text-violet-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Atividades do cliente</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tudo o que aconteceu na galeria — registrado pra valor jurídico.
            </p>
          </div>
        </div>
        {events.length > 0 && (
          <button
            onClick={() => downloadCsv(events, galleryId)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Exportar CSV
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Acessos" value={s.total_logins} icon={LogIn} />
        <StatCard label="Visualizações" value={s.total_views} icon={Eye} />
        <StatCard label="Selecionadas" value={s.selected_count} icon={Heart} />
        <StatCard label="Comentários" value={s.comments_count} icon={MessageSquare} />
      </div>

      {(s.total_login_fails > 0 || s.finalized_at) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {s.finalized_at && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Check size={12} /> Finalizada em {formatBR(s.finalized_at)}
            </span>
          )}
          {s.total_login_fails > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle size={12} /> {s.total_login_fails} tentativa{s.total_login_fails === 1 ? "" : "s"} de login com senha errada
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Filtrar:</span>
        {[
          { id: "all", label: "Tudo" },
          { id: "login", label: "Acessos" },
          { id: "select_photo", label: "Marcou" },
          { id: "comment_photo", label: "Comentou" },
          { id: "finalize", label: "Finalizou" },
        ].map((f) => (
          <button
            key={f.id} onClick={() => setFilter(f.id)}
            className={
              "text-xs px-2.5 py-1 rounded-full transition-colors " +
              (filter === f.id
                ? "bg-violet-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="text-sm text-gray-500 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          Sem registros ainda. Eles aparecem aqui assim que a cliente entrar.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((e) => <EventRow key={e.id} event={e} />)}
        </ul>
      )}

      {events.length > 8 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-violet-600 hover:underline inline-flex items-center gap-1"
        >
          {showAll ? "Mostrar menos" : `Mostrar todos (${events.length})`}
          <ChevronRight size={12} className={showAll ? "rotate-90 transition-transform" : "transition-transform"} />
        </button>
      )}
    </section>
  );
}

function StatCard({ label, value, icon: Icon }: {
  label: string; value: number; icon: React.ComponentType<{ size?: number; className?: string }>; key?: React.Key | null;
}) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Icon size={12} /> {label}
      </div>
      <div className="text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent; key?: React.Key | null }) {
  const info = eventInfo(event);
  const Icon = info.icon;
  const who = event.user?.name || event.user?.email || (event.event === "login_fail" ? "—" : "Anônimo");
  return (
    <li className="flex items-start gap-3 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30">
      <Icon size={14} className={info.color + " mt-0.5 flex-shrink-0"} />
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <span className="font-medium">{who}</span> <span className="text-gray-500">— {info.label}</span>
          {event.photo_name && (
            <span className="text-gray-500"> · {event.photo_name}</span>
          )}
        </div>
        {event.detail && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate italic mt-0.5">
            “{event.detail}”
          </div>
        )}
        <div className="text-[11px] text-gray-400 mt-0.5">
          {formatBR(event.created_at)}{event.ip ? ` · ${event.ip}` : ""}
        </div>
      </div>
    </li>
  );
}
