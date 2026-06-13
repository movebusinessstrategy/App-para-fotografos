import React from "react";

import { templateById, gridStyle, slotAreas, ALBUM_SIZES } from "../templates";
import type { PageLayout } from "../templates";
import type { AlbumAsset, AlbumSpread, SlotFill } from "../types";

// Razão (largura/altura) de UMA página, a partir do tamanho do álbum.
export function ratioOfSize(size: string): number {
  return ALBUM_SIZES.find((s) => s.id === size)?.ratio ?? 1;
}

// Índice global do slot dentro da lâmina (left primeiro, depois right) para
// mapear na lista achatada spread.slots.
export function pageSlotBaseIndex(spread: AlbumSpread, page: "left" | "right"): number {
  if (page === "left") return 0;
  const t = templateById(spread.template_id);
  return t ? t.left.slots : 0;
}

interface SlotBoxProps {
  area: string;
  fill: SlotFill | undefined;
  asset: AlbumAsset | undefined;
  globalIndex: number;
  // Renderiza um slot interativo (editor) ou só visual (prévia/canvas-source).
  renderSlot?: (args: {
    globalIndex: number;
    asset: AlbumAsset | undefined;
    fill: SlotFill | undefined;
  }) => React.ReactNode;
}

// Slot padrão (somente visual). O editor passa renderSlot com drag/drop.
function DefaultSlot({ asset }: { asset: AlbumAsset | undefined }) {
  if (asset?.preview_url || asset?.thumb_url) {
    return (
      <img
        src={asset.preview_url || asset.thumb_url || ""}
        alt={asset.original_name || ""}
        className="w-full h-full object-cover"
        draggable={false}
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600 text-[10px]">
      vazio
    </div>
  );
}

function SlotBox({ area, fill, asset, globalIndex, renderSlot }: SlotBoxProps) {
  return (
    <div
      style={{ gridArea: area, overflow: "hidden", position: "relative" }}
      className="bg-gray-50 dark:bg-gray-900"
    >
      {renderSlot
        ? renderSlot({ globalIndex, asset, fill })
        : <DefaultSlot asset={asset} />}
    </div>
  );
}

interface PageViewProps {
  layout: PageLayout;
  baseIndex: number;
  slots: SlotFill[];
  assetById: Map<string, AlbumAsset>;
  gap: number;
  renderSlot?: SlotBoxProps["renderSlot"];
}

function PageView({ layout, baseIndex, slots, assetById, gap, renderSlot }: PageViewProps) {
  const areas = slotAreas(layout);
  return (
    <div style={{ ...gridStyle(layout), gap, width: "100%", height: "100%" }}>
      {areas.map((area, i) => {
        const globalIndex = baseIndex + i;
        const fill = slots[globalIndex];
        const asset = fill?.asset_id ? assetById.get(fill.asset_id) : undefined;
        return (
          <SlotBox
            key={area}
            area={area}
            fill={fill}
            asset={asset}
            globalIndex={globalIndex}
            renderSlot={renderSlot}
          />
        );
      })}
    </div>
  );
}

interface SpreadViewProps {
  spread: AlbumSpread;
  assets: AlbumAsset[];
  size: string;
  // Espaço entre páginas/slots (px). 0 = colado (estilo lay-flat).
  gap?: number;
  // Slot customizado (drag/drop no editor). Sem isso, só visual.
  renderSlot?: SlotBoxProps["renderSlot"];
  className?: string;
}

// Renderiza uma lâmina (2 páginas) com a geometria do template.
// A proporção segue o tamanho do álbum (2 páginas lado a lado = ratio*2 : 1).
export function SpreadView({ spread, assets, size, gap = 4, renderSlot, className }: SpreadViewProps) {
  const t = templateById(spread.template_id) || templateById("classico")!;
  const assetById = React.useMemo(() => {
    const m = new Map<string, AlbumAsset>();
    assets.forEach((a) => m.set(a.id, a));
    return m;
  }, [assets]);

  const ratio = ratioOfSize(size);
  const rightBase = t.left.slots;

  return (
    <div
      className={
        "relative w-full bg-white dark:bg-gray-950 ring-1 ring-gray-200 dark:ring-gray-700 shadow-sm " +
        (className || "")
      }
      style={{ aspectRatio: `${ratio * 2} / 1` }}
    >
      <div className="absolute inset-0 grid grid-cols-2" style={{ gap }}>
        <PageView
          layout={t.left}
          baseIndex={0}
          slots={spread.slots}
          assetById={assetById}
          gap={gap}
          renderSlot={renderSlot}
        />
        <PageView
          layout={t.right}
          baseIndex={rightBase}
          slots={spread.slots}
          assetById={assetById}
          gap={gap}
          renderSlot={renderSlot}
        />
      </div>
      {/* Vinco central da lâmina */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-black/5 dark:bg-white/10" />
    </div>
  );
}
