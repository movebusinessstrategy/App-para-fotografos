import React, { useState } from "react";
import { Canvas } from "fabric";
import {
  Bold, ChevronUp, ChevronDown, Trash2, Replace, Image as ImageIcon, Palette,
} from "lucide-react";

import { cn } from "../../../utils/cn";
import type { AlbumAsset } from "../types";
import type { FabricSelection } from "./useFabricCanvas";
import { FONTS, FabricObjAny } from "./canvasHelpers";

interface Props {
  selection: FabricSelection;
  bgColor: string;
  fabricRef: React.RefObject<Canvas | null>;
  assets: AlbumAsset[];
  onChanged: () => void;
  onBackground: (color: string) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDelete: () => void;
  onReplacePhoto: (asset: AlbumAsset) => void;
}

const SECTION = "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3";
const ROW_LABEL = "text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1";

// Painel de propriedades do objeto selecionado no canvas.
export function PropriedadesPainel(p: Props) {
  const { selection } = p;

  const apply = (fn: () => void) => {
    fn();
    p.fabricRef.current?.requestRenderAll();
    p.onChanged();
  };

  return (
    <div className="space-y-3">
      <div className={SECTION}>
        <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <Palette size={13} /> Fundo da página
        </div>
        <ColorInput value={p.bgColor} onChange={p.onBackground} />
      </div>

      {selection.type === "none" ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Selecione um objeto na lâmina pra editar.
        </div>
      ) : (
        <>
          {selection.type === "textbox" && (
            <TextProps obj={selection.obj as FabricObjAny} apply={apply} />
          )}
          {selection.type === "image" && (
            <FotoProps
              obj={selection.obj as FabricObjAny}
              apply={apply}
              assets={p.assets}
              onReplace={p.onReplacePhoto}
            />
          )}
          {(selection.type === "rect" || selection.type === "circle") && (
            <FormaProps obj={selection.obj as FabricObjAny} apply={apply} />
          )}
          <GeralProps
            obj={selection.obj as FabricObjAny}
            apply={apply}
            onBringForward={p.onBringForward}
            onSendBackward={p.onSendBackward}
            onDelete={p.onDelete}
          />
        </>
      )}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-gray-700 bg-transparent"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400">{value}</span>
    </div>
  );
}

function TextProps({ obj, apply }: { obj: FabricObjAny; apply: (fn: () => void) => void }) {
  return (
    <div className={SECTION + " space-y-3"}>
      <div>
        <div className={ROW_LABEL}>Fonte</div>
        <select
          value={(obj.fontFamily as string) || "Playfair Display"}
          onChange={(e) => apply(() => obj.set({ fontFamily: e.target.value }))}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none"
        >
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <div className={ROW_LABEL}>Tamanho</div>
          <input
            type="number"
            min={6}
            max={400}
            value={Math.round((obj.fontSize as number) || 24)}
            onChange={(e) => apply(() => obj.set({ fontSize: Number(e.target.value) || 24 }))}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none"
          />
        </div>
        <button
          onClick={() => apply(() => obj.set({ fontWeight: obj.fontWeight === "bold" ? "normal" : "bold" }))}
          className={cn(
            "flex h-[34px] w-10 items-center justify-center rounded-lg border",
            obj.fontWeight === "bold"
              ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
              : "border-gray-200 dark:border-gray-700 text-gray-500",
          )}
          title="Negrito"
        >
          <Bold size={14} />
        </button>
      </div>
      <div>
        <div className={ROW_LABEL}>Cor do texto</div>
        <ColorInput value={(obj.fill as string) || "#222222"} onChange={(v) => apply(() => obj.set({ fill: v }))} />
      </div>
    </div>
  );
}

function FotoProps({
  obj, apply, assets, onReplace,
}: {
  obj: FabricObjAny;
  apply: (fn: () => void) => void;
  assets: AlbumAsset[];
  onReplace: (asset: AlbumAsset) => void;
}) {
  const [trocar, setTrocar] = useState(false);
  const scaleNow = (obj.scaleX as number) || 1;
  return (
    <div className={SECTION + " space-y-3"}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
        <ImageIcon size={13} /> Foto
      </div>
      <div>
        <div className={ROW_LABEL}>Zoom</div>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.02}
          value={scaleNow}
          onChange={(e) => apply(() => obj.scale(Number(e.target.value)))}
          className="w-full accent-violet-600"
        />
      </div>
      <div>
        <div className={ROW_LABEL}>Opacidade</div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={(obj.opacity as number) ?? 1}
          onChange={(e) => apply(() => obj.set({ opacity: Number(e.target.value) }))}
          className="w-full accent-violet-600"
        />
      </div>
      <button
        onClick={() => setTrocar((v) => !v)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        <Replace size={13} /> Trocar foto
      </button>
      {trocar && (
        <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
          {assets.map((a) => (
            <button
              key={a.id}
              onClick={() => { onReplace(a); setTrocar(false); }}
              className="aspect-square overflow-hidden rounded ring-1 ring-gray-200 dark:ring-gray-700"
              title={a.original_name || ""}
            >
              {(a.thumb_url || a.preview_url) && (
                <img src={a.thumb_url || a.preview_url || ""} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormaProps({ obj, apply }: { obj: FabricObjAny; apply: (fn: () => void) => void }) {
  return (
    <div className={SECTION + " space-y-3"}>
      <div>
        <div className={ROW_LABEL}>Cor</div>
        <ColorInput value={(obj.fill as string) || "#D4537E"} onChange={(v) => apply(() => obj.set({ fill: v }))} />
      </div>
      <div>
        <div className={ROW_LABEL}>Opacidade</div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={(obj.opacity as number) ?? 1}
          onChange={(e) => apply(() => obj.set({ opacity: Number(e.target.value) }))}
          className="w-full accent-violet-600"
        />
      </div>
    </div>
  );
}

function GeralProps({
  obj, apply, onBringForward, onSendBackward, onDelete,
}: {
  obj: FabricObjAny;
  apply: (fn: () => void) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDelete: () => void;
}) {
  void obj;
  return (
    <div className={SECTION + " space-y-2"}>
      <div className="grid grid-cols-2 gap-2">
        <SmallBtn onClick={() => apply(onBringForward)} icon={<ChevronUp size={14} />} label="Frente" />
        <SmallBtn onClick={() => apply(onSendBackward)} icon={<ChevronDown size={14} />} label="Trás" />
      </div>
      <button
        onClick={() => apply(onDelete)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
      >
        <Trash2 size={13} /> Excluir
      </button>
    </div>
  );
}

function SmallBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
    >
      {icon} {label}
    </button>
  );
}
