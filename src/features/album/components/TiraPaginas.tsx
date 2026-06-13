import React from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "../../../utils/cn";
import type { AlbumSpread, SpreadKind } from "../types";
import { SpreadThumb } from "./SpreadThumb";

const KIND_LABEL: Record<SpreadKind, string> = {
  cover: "Capa",
  spread: "Lâmina",
  backcover: "Contracapa",
};

interface Props {
  spreads: AlbumSpread[];
  size: string;
  currentIndex: number;
  onSelect: (index: number) => void;
  onAdd: (kind: SpreadKind) => void;
  onDelete: (index: number) => void;
}

// Tira de páginas embaixo do editor: capa, lâminas, contracapa e +.
export function TiraPaginas(p: Props) {
  const label = (s: AlbumSpread, i: number) => {
    const kind = s.kind || "spread";
    if (kind === "spread") {
      const lamNum = p.spreads.slice(0, i + 1).filter((x) => (x.kind || "spread") === "spread").length;
      return `Lâmina ${lamNum}`;
    }
    return KIND_LABEL[kind];
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
      {p.spreads.map((s, i) => (
        <PaginaCard
          key={s.id}
          label={label(s, i)}
          spread={s}
          size={p.size}
          active={i === p.currentIndex}
          onSelect={() => p.onSelect(i)}
          onDelete={() => p.onDelete(i)}
        />
      ))}

      <div className="flex flex-shrink-0 flex-col gap-1">
        <AddBtn label="+ Lâmina" onClick={() => p.onAdd("spread")} />
        <AddBtn label="+ Capa/Contra" onClick={() => p.onAdd(p.spreads.some((s) => s.kind === "cover") ? "backcover" : "cover")} />
      </div>
    </div>
  );
}

function PaginaCard({
  label, spread, size, active, onSelect, onDelete,
}: {
  label: string;
  spread: AlbumSpread;
  size: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  key?: React.Key | null;
}) {
  return (
    <div className="group relative flex-shrink-0">
      <button
        onClick={onSelect}
        className={cn(
          "block h-14 w-24 overflow-hidden rounded-lg ring-1 transition-all",
          active ? "ring-2 ring-violet-500" : "ring-gray-200 dark:ring-gray-700 hover:ring-violet-300",
        )}
        title={label}
      >
        <SpreadThumb spread={spread} size={size} />
      </button>
      <span className="mt-0.5 block text-center text-[9px] text-gray-500 dark:text-gray-400">{label}</span>
      <button
        onClick={onDelete}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
        title="Remover página"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-2 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600"
    >
      <Plus size={11} /> {label.replace("+ ", "")}
    </button>
  );
}
