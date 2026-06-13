import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import type { AlbumAsset } from "../../album/types";
import { estiloImagemProtegida, propsImagemProtegida, ROSA } from "../utils";

// Bandeja inferior com as fotos disponíveis. A cliente arrasta daqui pros
// slots das lâminas. Fotos já usadas ficam marcadas (mas seguem arrastáveis).

type Props = {
  assets: AlbumAsset[];
  usados: Set<string>;
  podeEditar: boolean;
};

export function Bandeja({ assets, usados, podeEditar }: Props) {
  if (assets.length === 0) {
    return (
      <div className="border-t border-neutral-200 bg-white px-4 py-4 text-center text-xs text-neutral-400">
        Nenhuma foto disponível neste álbum.
      </div>
    );
  }
  return (
    <div className="border-t border-neutral-200 bg-white">
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Suas fotos
        </p>
        {podeEditar && (
          <p className="text-[11px] text-neutral-400">arraste para a lâmina</p>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {assets.map((a) => (
          <FotoBandeja
            key={a.id}
            asset={a}
            usado={usados.has(a.id)}
            podeArrastar={podeEditar}
          />
        ))}
      </div>
    </div>
  );
}

function FotoBandeja({
  asset,
  usado,
  podeArrastar,
}: {
  asset: AlbumAsset;
  usado: boolean;
  podeArrastar: boolean;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `asset:${asset.id}`,
    disabled: !podeArrastar,
    data: { tipo: "asset", assetId: asset.id },
  });

  const img = asset.thumb_url || asset.preview_url || "";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-black/5"
      style={{
        touchAction: "none",
        opacity: isDragging ? 0.4 : 1,
        cursor: podeArrastar ? "grab" : "default",
      }}
    >
      <img
        src={img}
        alt={asset.original_name || ""}
        {...propsImagemProtegida}
        className="h-full w-full object-cover"
        style={estiloImagemProtegida}
      />
      {usado && (
        <span
          className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: ROSA }}
        >
          <Check size={11} />
        </span>
      )}
    </div>
  );
}
