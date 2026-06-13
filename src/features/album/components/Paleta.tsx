import { cn } from "../../../utils/cn";
import { ALBUM_TEMPLATES, templateById, gridStyle, slotAreas } from "../templates";
import type { AlbumTemplate, PageLayout } from "../templates";

interface PaletaProps {
  currentTemplateId: string;
  onApply: (templateId: string) => void;
}

// Miniatura esquemática de uma página (só os contornos dos slots).
function MiniPage({ layout }: { layout: PageLayout }) {
  return (
    <div style={{ ...gridStyle(layout), gap: 1, width: "100%", height: "100%" }}>
      {slotAreas(layout).map((area) => (
        <div
          key={area}
          style={{ gridArea: area }}
          className="bg-gray-300/70 dark:bg-gray-600/70 rounded-[1px]"
        />
      ))}
    </div>
  );
}

// Miniatura da lâmina inteira (2 páginas) usada como botão de template.
function MiniSpread({ tpl }: { tpl: AlbumTemplate }) {
  return (
    <div className="aspect-[2/1] w-full bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded p-0.5">
      <div className="grid grid-cols-2 gap-px w-full h-full">
        <MiniPage layout={tpl.left} />
        <MiniPage layout={tpl.right} />
      </div>
    </div>
  );
}

// Paleta de templates ("modos de diagramação"). Clicar aplica à lâmina atual.
export function Paleta({ currentTemplateId, onApply }: PaletaProps) {
  const current = templateById(currentTemplateId);
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Diagramação</h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {current ? `Lâmina: ${current.name}` : "Escolha um layout"}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2.5">
        {ALBUM_TEMPLATES.map((tpl) => {
          const active = tpl.id === currentTemplateId;
          return (
            <button
              key={tpl.id}
              onClick={() => onApply(tpl.id)}
              className={cn(
                "flex flex-col gap-1 p-1.5 rounded-lg border transition-colors text-left",
                active
                  ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20 ring-1 ring-violet-500/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-violet-300",
              )}
            >
              <MiniSpread tpl={tpl} />
              <span className={cn(
                "text-[11px] font-medium",
                active ? "text-violet-700 dark:text-violet-300" : "text-gray-600 dark:text-gray-300",
              )}>
                {tpl.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
