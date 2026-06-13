import React from "react";
import {
  Image as ImageIcon, Type, Shapes, Palette, LayoutTemplate, Square, Circle,
} from "lucide-react";

import { cn } from "../../../utils/cn";
import type { AlbumAsset } from "../types";
import { FREE_TEMPLATES } from "../templates";
import type { AlbumCanvasEditorHandle } from "./AlbumCanvasEditor";
import { BandejaFotos } from "./BandejaFotos";

export type Ferramenta = "fotos" | "texto" | "formas" | "fundo" | "modelos";

const TOOLS: { id: Ferramenta; icon: React.ReactNode; label: string }[] = [
  { id: "fotos", icon: <ImageIcon size={18} />, label: "Fotos" },
  { id: "texto", icon: <Type size={18} />, label: "Texto" },
  { id: "formas", icon: <Shapes size={18} />, label: "Formas" },
  { id: "fundo", icon: <Palette size={18} />, label: "Fundo" },
  { id: "modelos", icon: <LayoutTemplate size={18} />, label: "Modelos" },
];

const CORES_FUNDO = ["#ffffff", "#faf8f6", "#f3f0ec", "#1f2937", "#000000", "#D4537E", "#f5d0e0", "#e8e2d5"];

interface Props {
  ferramenta: Ferramenta;
  onFerramenta: (f: Ferramenta) => void;
  editor: AlbumCanvasEditorHandle | null;
  albumId: string;
  galleryId?: string | null;
  assets: AlbumAsset[];
  onChanged: () => void;
  onNotify: (kind: "success" | "error", msg: string) => void;
}

// Barra de ferramentas vertical + painel contextual (estúdio).
export function FerramentasPanel(p: Props) {
  return (
    <div className="flex h-full">
      <nav className="flex w-16 flex-shrink-0 flex-col items-center gap-1 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-2">
        {TOOLS.map((t) => (
          <ToolBtn key={t.id} active={p.ferramenta === t.id} icon={t.icon} label={t.label} onClick={() => p.onFerramenta(t.id)} />
        ))}
      </nav>
      <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        <Conteudo {...p} />
      </div>
    </div>
  );
}

function Conteudo(p: Props) {
  if (p.ferramenta === "fotos") {
    return (
      <BandejaFotos
        albumId={p.albumId}
        galleryId={p.galleryId}
        assets={p.assets}
        onAddPhoto={(a) => p.editor?.addPhoto(a)}
        onChanged={p.onChanged}
        onNotify={p.onNotify}
      />
    );
  }
  if (p.ferramenta === "texto") {
    return (
      <PainelSimples titulo="Texto">
        <BotaoAcao label="Adicionar texto" icon={<Type size={14} />} onClick={() => p.editor?.addText()} />
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Dois cliques no texto pra editar. A fonte e a cor ficam no painel da direita.</p>
      </PainelSimples>
    );
  }
  if (p.ferramenta === "formas") {
    return (
      <PainelSimples titulo="Formas">
        <BotaoAcao label="Retângulo" icon={<Square size={14} />} onClick={() => p.editor?.addShape("rect")} />
        <BotaoAcao label="Círculo" icon={<Circle size={14} />} onClick={() => p.editor?.addShape("circle")} />
      </PainelSimples>
    );
  }
  if (p.ferramenta === "fundo") {
    return (
      <PainelSimples titulo="Fundo da lâmina">
        <div className="grid grid-cols-4 gap-2">
          {CORES_FUNDO.map((c) => (
            <button
              key={c}
              onClick={() => p.editor?.setBackground(c)}
              className="h-9 w-full rounded-lg ring-1 ring-black/10 dark:ring-white/15"
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
      </PainelSimples>
    );
  }
  return (
    <PainelSimples titulo="Modelos de lâmina">
      <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">Aplica caixas de foto na lâmina atual. Clique numa caixa e troque pela foto.</p>
      <div className="grid grid-cols-2 gap-2">
        {FREE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => p.editor?.applyTemplate(t.id)}
            className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 hover:border-violet-400"
          >
            <Miniatura slots={t.slots} />
            <span className="text-[10px] text-gray-600 dark:text-gray-300">{t.name}</span>
          </button>
        ))}
      </div>
    </PainelSimples>
  );
}

// Mini preview do layout do template.
function Miniatura({ slots }: { slots: { x: number; y: number; w: number; h: number }[] }) {
  return (
    <div className="relative h-10 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
      {slots.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-sm bg-violet-300 dark:bg-violet-500/50"
          style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
        />
      ))}
    </div>
  );
}

function PainelSimples({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <h3 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">{titulo}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BotaoAcao({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-xs font-semibold text-white"
    >
      {icon} {label}
    </button>
  );
}

function ToolBtn({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-14 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors",
        active
          ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
      )}
    >
      {icon} {label}
    </button>
  );
}
