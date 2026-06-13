import { ALBUM_TEMPLATES } from "../../album/templates";
import { ROSA } from "../utils";

// Barra de troca de template (layout) da lâmina atual. Cada botão mostra um
// mini esquema do grid da página esquerda só pra dar a ideia visual.

type Props = {
  templateAtual: string;
  podeEditar: boolean;
  onTrocar: (templateId: string) => void;
};

export function SeletorTemplate({ templateAtual, podeEditar, onTrocar }: Props) {
  if (!podeEditar) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-3">
      {ALBUM_TEMPLATES.map((t) => {
        const ativo = t.id === templateAtual;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTrocar(t.id)}
            className="flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            style={{
              borderColor: ativo ? ROSA : "#e5e5e5",
              color: ativo ? ROSA : "#525252",
              backgroundColor: ativo ? `${ROSA}10` : "#fff",
            }}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
