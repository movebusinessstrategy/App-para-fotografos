import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, X } from "lucide-react";
import type { FotoPublica, MapaSelecoes } from "../types";
import { estiloImagemProtegida, propsImagemProtegida } from "../utils";

type Props = {
  fotos: FotoPublica[];
  indice: number;
  selecoes: MapaSelecoes;
  bloquearImagens: boolean;
  podeEditar: boolean;
  onFechar: () => void;
  onNavegar: (novoIndice: number) => void;
  onToggle: (fotoId: string) => void;
  onComentario: (fotoId: string, texto: string) => void;
};

const DEBOUNCE_COMENTARIO_MS = 800;
const SWIPE_MINIMO_PX = 50;

export function Lightbox(props: Props) {
  const { fotos, indice, selecoes, bloquearImagens, podeEditar } = props;
  const foto = fotos[indice];
  const selecionada = Boolean(selecoes[foto.id]?.selected);

  const [texto, setTexto] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendenteRef = useRef<{ fotoId: string; texto: string } | null>(null);
  const salvarRef = useRef(props.onComentario);
  salvarRef.current = props.onComentario;

  // Salva imediatamente qualquer comentário ainda não enviado (debounce em curso).
  const descarregarPendente = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pendente = pendenteRef.current;
    pendenteRef.current = null;
    if (pendente) salvarRef.current(pendente.fotoId, pendente.texto);
  };

  const aoDigitar = (valor: string) => {
    setTexto(valor);
    pendenteRef.current = { fotoId: foto.id, texto: valor };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(descarregarPendente, DEBOUNCE_COMENTARIO_MS);
  };

  const navegar = (passo: number) => {
    const novo = indice + passo;
    if (novo < 0 || novo >= fotos.length) return;
    descarregarPendente();
    props.onNavegar(novo);
  };

  const fechar = () => {
    descarregarPendente();
    props.onFechar();
  };

  // Recarrega o comentário ao trocar de foto (só depende do id pra não
  // resetar o campo enquanto a cliente digita).
  useEffect(() => {
    setTexto(selecoes[foto.id]?.comment ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foto.id]);

  // Flush do comentário pendente se o componente desmontar no meio do debounce.
  useEffect(() => () => descarregarPendente(), []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      else if (e.key === "ArrowLeft") navegar(-1);
      else if (e.key === "ArrowRight") navegar(1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  // Swipe horizontal no mobile
  const toqueX = useRef<number | null>(null);
  const aoTocar = (e: React.TouchEvent) => {
    toqueX.current = e.touches[0].clientX;
  };
  const aoSoltar = (e: React.TouchEvent) => {
    if (toqueX.current == null) return;
    const delta = e.changedTouches[0].clientX - toqueX.current;
    toqueX.current = null;
    if (Math.abs(delta) >= SWIPE_MINIMO_PX) navegar(delta > 0 ? -1 : 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-4 py-3 text-white/80">
        <span className="text-sm tabular-nums">
          {indice + 1} de {fotos.length}
        </span>
        <button
          type="button"
          aria-label="Fechar"
          onClick={fechar}
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X size={22} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2"
        onTouchStart={aoTocar}
        onTouchEnd={aoSoltar}
      >
        <img
          src={foto.preview_url}
          alt={foto.file_name}
          className="max-h-full max-w-full select-none object-contain"
          style={estiloImagemProtegida}
          {...(bloquearImagens ? propsImagemProtegida : { draggable: false })}
        />
        {indice > 0 && <Seta lado="esquerda" onClick={() => navegar(-1)} />}
        {indice < fotos.length - 1 && <Seta lado="direita" onClick={() => navegar(1)} />}
      </div>

      <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button
            type="button"
            aria-label={selecionada ? "Desmarcar foto" : "Selecionar foto"}
            disabled={!podeEditar}
            onClick={() => props.onToggle(foto.id)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 transition-transform active:scale-90 disabled:opacity-50"
          >
            <Heart
              size={24}
              className={selecionada ? "fill-[#6F4E37] text-[#6F4E37]" : "text-white"}
            />
          </button>
          <CampoComentario podeEditar={podeEditar} texto={texto} onDigitar={aoDigitar} />
        </div>
      </div>
    </div>
  );
}

function Seta({ lado, onClick }: { lado: "esquerda" | "direita"; onClick: () => void }) {
  const ehEsquerda = lado === "esquerda";
  return (
    <button
      type="button"
      aria-label={ehEsquerda ? "Foto anterior" : "Próxima foto"}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 ${
        ehEsquerda ? "left-2" : "right-2"
      }`}
    >
      {ehEsquerda ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
    </button>
  );
}

function CampoComentario({
  podeEditar,
  texto,
  onDigitar,
}: {
  podeEditar: boolean;
  texto: string;
  onDigitar: (valor: string) => void;
}) {
  if (!podeEditar) {
    if (!texto) return <div className="flex-1" />;
    return <p className="flex-1 text-sm italic text-white/60">“{texto}”</p>;
  }
  return (
    <input
      type="text"
      value={texto}
      onChange={(e) => onDigitar(e.target.value)}
      placeholder="Comentário para o fotógrafo (opcional)"
      className="w-full flex-1 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-[#6F4E37]/60 focus:ring-1 focus:ring-[#6F4E37]/60"
    />
  );
}
