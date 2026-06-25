import type React from "react";
import { Check, Heart } from "lucide-react";
import type { FotoPublica, MapaSelecoes } from "../types";
import { estiloImagemProtegida, propsImagemProtegida } from "../utils";

type PropsGrade = {
  fotos: FotoPublica[];
  selecoes: MapaSelecoes;
  bloquearImagens: boolean;
  podeEditar: boolean;
  onAbrir: (indice: number) => void;
  onToggle: (fotoId: string) => void;
};

type PropsCartao = {
  // key tipado pro typecheck aceitar <CartaoFoto key={} ...> (padrão do projeto).
  key?: React.Key | null;
  foto: FotoPublica;
  selecionada: boolean;
  bloquearImagens: boolean;
  podeEditar: boolean;
  onAbrir: () => void;
  onToggle: () => void;
};

function CartaoFoto({ foto, selecionada, bloquearImagens, podeEditar, onAbrir, onToggle }: PropsCartao) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-neutral-200">
      <button type="button" onClick={onAbrir} className="block h-full w-full cursor-zoom-in">
        <img
          src={foto.thumb_url}
          alt={foto.file_name}
          loading="lazy"
          className="h-full w-full select-none object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          style={estiloImagemProtegida}
          {...(bloquearImagens ? propsImagemProtegida : { draggable: false })}
        />
      </button>

      {selecionada && (
        <span className="pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#6F4E37] text-white shadow">
          <Check size={14} strokeWidth={3} />
        </span>
      )}

      {podeEditar && (
        <button
          type="button"
          aria-label={selecionada ? "Desmarcar foto" : "Selecionar foto"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm transition-transform active:scale-90"
        >
          <Heart
            size={18}
            className={selecionada ? "fill-[#6F4E37] text-[#6F4E37]" : "text-white"}
          />
        </button>
      )}
    </div>
  );
}

export function GradeFotos({ fotos, selecoes, bloquearImagens, podeEditar, onAbrir, onToggle }: PropsGrade) {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-2 gap-2 px-3 sm:grid-cols-3 sm:gap-3 sm:px-4 lg:grid-cols-4 xl:grid-cols-5">
      {fotos.map((foto, indice) => (
        <CartaoFoto
          key={foto.id}
          foto={foto}
          selecionada={Boolean(selecoes[foto.id]?.selected)}
          bloquearImagens={bloquearImagens}
          podeEditar={podeEditar}
          onAbrir={() => onAbrir(indice)}
          onToggle={() => onToggle(foto.id)}
        />
      ))}
    </div>
  );
}
