import React, { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { useApi } from "../../../utils/useApi";
import { Gallery, GallerySettings } from "../types";
import { formatDateBR } from "../utils";
import { ToastKind } from "../Toast";
import { Bloco, SecaoHeader } from "./DadosSection";
import { DatePickerBonito } from "./DatePickerBonito";

interface PrazoSectionProps {
  gallery: Gallery;
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
}

export function PrazoSection({ gallery, onChanged, onNotify }: PrazoSectionProps) {
  const [deadline, setDeadline] = useState((gallery.selection_deadline || "").slice(0, 10));
  const [lockAfter, setLockAfter] = useState(true);
  const [saving, setSaving] = useState(false);

  // Presets de prazo padronizáveis pelo estúdio (configurações globais).
  const { data: settingsData } = useApi<{ settings: GallerySettings }>("/api/gallery-settings");
  const presets = settingsData?.settings?.deadline_presets || [7, 15, 30];

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
        <div className="flex flex-wrap items-center gap-3">
          <DatePickerBonito
            value={deadline}
            onChange={setNew}
            presets={presets}
            minDate={new Date().toISOString().slice(0, 10)}
          />
          {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
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
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Atalhos de prazo (Hoje, +{presets.join(", +")} dias) podem ser personalizados em <strong>Configurações → Padrões</strong>.
        </p>
      </Bloco>

      <Bloco titulo="Depois do prazo">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox" checked={lockAfter}
            onChange={(e) => { setLockAfter(e.target.checked); save({ lock_after_deadline: e.target.checked }); }}
            className="w-4 h-4 accent-brand-600"
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
          <CalendarClock size={16} className="text-brand-600 dark:text-brand-400 mt-0.5" />
          <span>
            Em breve: lembrete automático por WhatsApp / e-mail 3 dias e 1 dia antes do prazo.
            Por enquanto, dá pra reenviar a galeria pela ação "Enviar pra cliente".
          </span>
        </p>
      </Bloco>
    </div>
  );
}
