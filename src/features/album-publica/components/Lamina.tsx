import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { AlbumAsset, SlotFill } from "../../album/types";
import type { AlbumTemplate, PageLayout } from "../../album/templates";
import { gridStyle, slotAreas } from "../../album/templates";
import { estiloImagemProtegida, propsImagemProtegida, ROSA } from "../utils";

// Renderização da lâmina (spread = 2 páginas). Mesma lógica de grid do editor
// do estúdio: cada página usa gridStyle()/slotAreas() de templates.ts.

type SlotGlobal = { spreadIndex: number; slot: number };

type PropsLamina = {
  spreadIndex: number;
  template: AlbumTemplate;
  slots: SlotFill[];
  ratio: number; // largura/altura de UMA página
  assetsById: Record<string, AlbumAsset>;
  podeEditar: boolean;
};

// Índice de um slot dentro da lâmina inteira: left preenche 0..left.slots-1,
// right continua a partir daí. Mantém alinhado com slotCount(template).
function slotGlobal(template: AlbumTemplate, lado: "left" | "right", i: number): number {
  return lado === "right" ? template.left.slots + i : i;
}

export function Lamina(p: PropsLamina) {
  // Lâmina = duas páginas lado a lado → razão dobrada na largura.
  const aspect = `${p.ratio * 2} / 1`;
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
      <div className="grid grid-cols-2" style={{ aspectRatio: aspect }}>
        <Pagina
          layout={p.template.left}
          lado="left"
          template={p.template}
          spreadIndex={p.spreadIndex}
          slots={p.slots}
          assetsById={p.assetsById}
          podeEditar={p.podeEditar}
        />
        <Pagina
          layout={p.template.right}
          lado="right"
          template={p.template}
          spreadIndex={p.spreadIndex}
          slots={p.slots}
          assetsById={p.assetsById}
          podeEditar={p.podeEditar}
        />
      </div>
    </div>
  );
}

type PropsPagina = {
  layout: PageLayout;
  lado: "left" | "right";
  template: AlbumTemplate;
  spreadIndex: number;
  slots: SlotFill[];
  assetsById: Record<string, AlbumAsset>;
  podeEditar: boolean;
};

function Pagina(p: PropsPagina) {
  const areas = slotAreas(p.layout);
  return (
    <div className="relative bg-neutral-50" style={{ ...gridStyle(p.layout), gap: 2 }}>
      {areas.map((area, i) => {
        const indice = slotGlobal(p.template, p.lado, i);
        const fill = p.slots[indice];
        const asset = fill?.asset_id ? p.assetsById[fill.asset_id] : undefined;
        return (
          <SlotDrop
            key={area}
            id={{ spreadIndex: p.spreadIndex, slot: indice }}
            gridArea={area}
            fill={fill}
            asset={asset}
            podeEditar={p.podeEditar}
          />
        );
      })}
    </div>
  );
}

type PropsSlot = {
  id: SlotGlobal;
  gridArea: string;
  fill: SlotFill | undefined;
  asset: AlbumAsset | undefined;
  podeEditar: boolean;
};

function SlotDrop({ id, gridArea, asset, fill, podeEditar }: PropsSlot) {
  const dropId = `slot:${id.spreadIndex}:${id.slot}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    disabled: !podeEditar,
    data: { tipo: "slot", spreadIndex: id.spreadIndex, slot: id.slot },
  });

  const img = asset?.thumb_url || asset?.preview_url || null;
  const zoom = fill?.zoom && fill.zoom > 0 ? fill.zoom : 1;
  const ox = fill?.offset_x ?? 50;
  const oy = fill?.offset_y ?? 50;

  return (
    <div
      ref={setNodeRef}
      style={{ gridArea, boxShadow: isOver ? `inset 0 0 0 3px ${ROSA}` : undefined }}
      className="relative overflow-hidden bg-neutral-100"
    >
      {img ? (
        <img
          src={img}
          alt=""
          {...propsImagemProtegida}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            ...estiloImagemProtegida,
            objectPosition: `${ox}% ${oy}%`,
            transform: zoom !== 1 ? `scale(${zoom})` : undefined,
          }}
        />
      ) : (
        podeEditar && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-300">
            <Plus size={20} />
          </div>
        )
      )}
    </div>
  );
}
