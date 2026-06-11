import { useRef, useState } from "react";

import { cn } from "../../utils/cn";
import ProjetosTab from "./ProjetosTab";
import ClientesTab from "./ClientesTab";
import ReceitaTab from "./ReceitaTab";
import ConfiguracoesTab from "./ConfiguracoesTab";
import { Toast, ToastKind, ToastState } from "./Toast";

const TABS = [
  { id: "projetos", label: "Projetos" },
  { id: "clientes", label: "Clientes" },
  { id: "receita", label: "Receita" },
  { id: "config", label: "Configurações" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Página do módulo de Galerias de seleção (proofing): kanban de projetos +
// clientes (cadastrados e avulsos). As abas recebem onNotify pro toast comum.
export default function GaleriasPage() {
  const [tab, setTab] = useState<TabId>("projetos");
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = (kind: ToastKind, message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Galeria</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Envie as fotos do ensaio e deixe a cliente escolher as favoritas.
          </p>
        </div>
        <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {tab === "projetos" && <ProjetosTab onNotify={notify} />}
        {tab === "clientes" && <ClientesTab onNotify={notify} />}
        {tab === "receita" && <ReceitaTab onNotify={notify} />}
        {tab === "config" && <ConfiguracoesTab onNotify={notify} />}
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
