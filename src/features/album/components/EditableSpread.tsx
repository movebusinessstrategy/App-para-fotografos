import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";

import { cn } from "../../../utils/cn";
import { SpreadView } from "./SpreadView";
import type { AlbumAsset, AlbumSpread } from "../types";

interface EditableSpreadProps {
  spread: AlbumSpread;
  assets: AlbumAsset[];
  size: string;
  onClearSlot: (globalIndex: number) => void;
}

// Um slot que recebe drop (id = "slot:<index>"). Mostra a foto e botão limpar.
function DropSlot({ globalIndex, asset, onClear }: {
  globalIndex: number;
  asset: AlbumAsset | undefined;
  onClear: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${globalIndex}`,
    data: { type: "slot", index: globalIndex },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative w-full h-full transition-colors",
        isOver && "ring-2 ring-inset ring-violet-500",
      )}
    >
      {asset?.preview_url || asset?.thumb_url ? (
        <>
          <img
            src={asset.preview_url || asset.thumb_url || ""}
            alt={asset.original_name || ""}
            draggable={false}
            className="w-full h-full object-cover"
          />
          <button
            onClick={onClear}
            className="absolute top-1 right-1 rounded-full bg-black/55 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Tirar foto do slot"
          >
            <X size={11} />
          </button>
        </>
      ) : (
        <div className={cn(
          "w-full h-full flex items-center justify-center text-[10px] transition-colors",
          isOver
            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-500"
            : "bg-gray-100 dark:bg-gray-800/60 text-gray-300 dark:text-gray-600",
        )}>
          arraste aqui
        </div>
      )}
    </div>
  );
}

// Lâmina central editável: usa o SpreadView e injeta slots que recebem drop.
export function EditableSpread({ spread, assets, size, onClearSlot }: EditableSpreadProps) {
  return (
    <SpreadView
      spread={spread}
      assets={assets}
      size={size}
      gap={6}
      renderSlot={({ globalIndex, asset }) => (
        <DropSlot
          globalIndex={globalIndex}
          asset={asset}
          onClear={() => onClearSlot(globalIndex)}
        />
      )}
    />
  );
}
