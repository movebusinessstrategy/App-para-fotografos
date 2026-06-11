import React, { useEffect, useState } from "react";
import { CalendarClock, Loader2, Save } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { Gallery } from "../types";
import { formatDateBR } from "../utils";
import { ToastKind } from "../Toast";
import { Bloco, SecaoHeader } from "./DadosSection";

interface PrazoSectionProps {
  gallery: Gallery;
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(base: string | null, days: number): string {
  const start = base ? new Date(base) : new Date();
  if (isNaN(start.getTime())) start.setTime(Date.now());
  start.setDate(start.getDate() + days);
  return start.toISOString().slice(0, 10);
}

export function PrazoSection({ gallery, onChanged, onNotify }: PrazoSectionProps) {
  const [deadline, setDeadline] = useState((gallery.selection_deadline || "").slice(0, 10));
  const [lockAfter, setLockAfter] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDeadline((gallery.selection_deadline || "").slice(0, 10));
  }, [gallery.id]);

  const save = async (payload: any) => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/galleries/${gallery.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      onNotify("success", "Salvo.");
      onChanged();
    } catch {
      onNotify("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const setNew = (iso: string) => {
    setDeadline(iso);
    save({ selection_deadline: iso || null });
  };

  const expired = deadline && new Date(deadline + "T23:59:59") < new Date();

  return (
    <div className="space-y-5">
      <SecaoHeader titulo="Prazo e lembrete" descricao="Quanto tempo a cliente tem pra selecionar." />

      <Bloco titulo="Prazo de seleção">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[180px]">
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Data limite</span>
            <input
              type="date" value={deadline}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setNew(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            />
          </label>
          <div className="flex gap-2">
            {[7, 15, 30].map((d) => (
              <button
                key={d} onClick={() => setNew(addDaysIso(deadline || null, d))}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                +{d} dias
              </button>
            ))}
            <button
              onClick={() => setNew(todayPlus(0))}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              Hoje
            </button>
          </div>
        </div>
        {deadline ? (
          <div className={
            "text-xs " +
            (expired ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400")
          }>
            {expired ? "Prazo vencido em " : "Vence em "} {formatDateBR(deadline)}.
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">Sem prazo definido — a cliente pode selecionar a qualquer hora.</p>
        )}
      </Bloco>

      <Bloco titulo="Depois do prazo">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox" checked={lockAfter}
            onChange={(e) => { setLockAfter(e.target.checked); save({ lock_after_deadline: e.target.checked }); }}
            className="w-4 h-4 accent-violet-600"
          />
          <span className="text-sm">
            Bloquear seleção após o prazo
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Quando vencer, a cliente não consegue mais marcar/desmarcar fotos — só vê o que selecionou.
            </span>
          </span>
        </label>
      </Bloco>

      <Bloco titulo="Lembrete (em breve)">
        <p className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
          <CalendarClock size={16} className="text-violet-600 dark:text-violet-400 mt-0.5" />
          <span>
            Em breve: lembrete automático por WhatsApp / e-mail 3 dias e 1 dia antes do prazo.
            Por enquanto, dá pra reenviar a galeria pela ação "Enviar pra cliente" na seção de Fotos.
          </span>
        </p>
      </Bloco>

      {saving && (
        <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Salvando…</div>
      )}
      <span className="hidden"><Save /></span>
    </div>
  );
}
