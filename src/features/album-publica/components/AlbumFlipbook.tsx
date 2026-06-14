import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { canvasDims, type SpreadKind } from "../../album/templates";
import type { AlbumSpread } from "../../album/types";

// Livro 3D de apresentação do álbum. Cada lâmina é uma imagem (useSpreadImages).
// Em repouso: capa com espessura de páginas, lombada (gutter) e sombra de
// contato, com leve parallax no mouse. Ao navegar entre lâminas internas, faz
// a VIRADA de meia-página (hinge na lombada); pra capa/contracapa usa fade.

const kindOf = (s: AlbumSpread | undefined): SpreadKind =>
  s && (s.kind === "cover" || s.kind === "backcover") ? s.kind : "spread";

// Estilo de fundo pra mostrar metade (ou tudo) de uma imagem de lâmina.
function half(img: string | null, which: "left" | "right" | "full"): React.CSSProperties {
  if (!img) return { background: "#f3efe8" };
  if (which === "full") return { backgroundImage: `url(${img})`, backgroundSize: "100% 100%" };
  return {
    backgroundImage: `url(${img})`,
    backgroundSize: "200% 100%",
    backgroundPosition: which === "right" ? "100% 0" : "0% 0",
  };
}

interface FlipState {
  dir: 1 | -1;
  mode: "turn" | "fade";
  leafFront: string | null; // metade direita
  leafBack: string | null; // metade esquerda
  trailSide: "left" | "right";
  trailImg: string | null;
}

interface Props {
  images: (string | null)[];
  spreads: AlbumSpread[];
  size: string;
  index: number;
  onIndex: (i: number) => void;
}

export function AlbumFlipbook({ images, spreads, size, index, onIndex }: Props) {
  const total = spreads.length;
  const cur = spreads[index];
  const curKind = kindOf(cur);
  const dims = canvasDims(size, curKind);
  const aspect = dims.w / dims.h;
  const isSpread = curKind === "spread";
  const img = images[index] || null;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [flip, setFlip] = useState<FlipState | null>(null);
  // Espelho do flip em ref: o handler de teclado é ligado num useEffect e pegaria
  // um flip "velho" do closure; com a ref a trava de "não pular durante a
  // animação" vale também pras setas do teclado.
  const flipRef = useRef<FlipState | null>(null);
  flipRef.current = flip;
  const prevIdx = useRef(index);

  // Monta a animação de transição quando o índice muda.
  useEffect(() => {
    const old = prevIdx.current;
    prevIdx.current = index;
    if (old === index) return;
    const dir: 1 | -1 = index > old ? 1 : -1;
    const bothSpread = kindOf(spreads[old]) === "spread" && kindOf(spreads[index]) === "spread";
    if (bothSpread) {
      setFlip(
        dir === 1
          ? { dir, mode: "turn", leafFront: images[old], leafBack: images[index], trailSide: "left", trailImg: images[old] }
          : { dir, mode: "turn", leafFront: images[index], leafBack: images[old], trailSide: "right", trailImg: images[old] },
      );
    } else {
      setFlip({ dir, mode: "fade", leafFront: null, leafBack: null, trailSide: "left", trailImg: null });
    }
    const t = window.setTimeout(() => setFlip(null), 780);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Setas do teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total]);

  const go = (d: number) => {
    if (flipRef.current) return; // evita pular durante a animação (vale tb p/ teclado)
    const n = index + d;
    if (n < 0 || n >= total) return;
    onIndex(n);
  };

  const onMove = (e: React.MouseEvent) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 4.5, ry: px * 6.5 });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0 });

  const widthStyle = `min(92vw, calc((100dvh - 240px) * ${aspect}))`;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={stageRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="flex w-full items-center justify-center"
        style={{ perspective: "2400px" }}
      >
        {/* arco do livro */}
        <div
          className="relative"
          style={{
            width: widthStyle,
            aspectRatio: `${dims.w} / ${dims.h}`,
            transformStyle: "preserve-3d",
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transition: "transform .35s cubic-bezier(.4,0,.2,1)",
          }}
        >
          {/* sombra de contato no chão */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: "-6%",
              width: "86%",
              height: "10%",
              background: "radial-gradient(50% 60% at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,0) 72%)",
              filter: "blur(8px)",
            }}
          />

          {/* página aberta (imagem da lâmina atual) + espessura de páginas */}
          <div
            key={`page-${index}`}
            className="absolute inset-0 overflow-hidden rounded-[3px] bg-[#f3efe8]"
            style={{
              ...half(img, "full"),
              animation: flip?.mode === "fade" ? "album-fade-in .55s ease both" : undefined,
              boxShadow:
                "0 30px 60px -18px rgba(0,0,0,.65), 0 18px 30px -22px rgba(0,0,0,.55), " +
                "2px 3px 0 -1px #efe9dd, 4px 6px 0 -2px #e7e0d2, 6px 9px 0 -3px #ddd5c5, 8px 12px 0 -4px #d4ccbb",
            }}
          >
            {!img && (
              <div className="flex h-full w-full items-center justify-center text-neutral-300">
                <ImageOff size={28} />
              </div>
            )}
          </div>

          {/* lombada (gutter) só em lâmina dupla */}
          {isSpread && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: "calc(50% - 26px)",
                  width: "52px",
                  background:
                    "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,.10) 34%, rgba(0,0,0,.20) 50%, rgba(0,0,0,.10) 66%, rgba(0,0,0,0) 100%)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: "calc(50% - 0.5px)", width: "1px", background: "rgba(255,255,255,.35)" }}
              />
            </>
          )}

          {/* moldura interna sutil */}
          <div className="pointer-events-none absolute inset-0 rounded-[3px] ring-1 ring-black/10" />

          {/* metade que "permanece" até a virada passar do meio */}
          {flip?.mode === "turn" && (
            <div
              className="pointer-events-none absolute inset-y-0 overflow-hidden"
              style={{
                left: flip.trailSide === "left" ? 0 : "50%",
                width: "50%",
                ...half(flip.trailImg, flip.trailSide === "left" ? "left" : "right"),
                animation: "album-hide-mid .78s steps(1) both",
                zIndex: 15,
              }}
            />
          )}

          {/* folha que vira (hinge na lombada) */}
          {flip?.mode === "turn" && (
            <div
              className="absolute inset-y-0"
              style={{
                left: "50%",
                width: "50%",
                transformOrigin: "left center",
                transformStyle: "preserve-3d",
                animation: `${flip.dir === 1 ? "album-flip-next" : "album-flip-prev"} .78s cubic-bezier(.46,.03,.4,1) both`,
                zIndex: 20,
              }}
            >
              {/* frente = metade direita */}
              <div className="absolute inset-0 overflow-hidden" style={{ backfaceVisibility: "hidden", ...half(flip.leafFront, "right") }}>
                <div className="absolute inset-0" style={{ background: "linear-gradient(to left, rgba(0,0,0,.18), rgba(0,0,0,0) 38%)" }} />
              </div>
              {/* verso = metade esquerda (espelhado) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", ...half(flip.leafBack, "left") }}
              >
                <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,.18), rgba(0,0,0,0) 38%)" }} />
              </div>
            </div>
          )}

          {/* setas */}
          <NavBtn side="left" disabled={index <= 0} onClick={() => go(-1)} />
          <NavBtn side="right" disabled={index >= total - 1} onClick={() => go(1)} />
        </div>
      </div>

      {/* contador + pontos */}
      <div className="mt-7 flex flex-col items-center gap-3">
        <div className="text-xs font-medium tracking-[0.2em] text-luxury-cream/55">
          {rotuloPagina(curKind, index, total)}
        </div>
        <div className="flex max-w-[80vw] flex-wrap items-center justify-center gap-1.5">
          {spreads.map((_, i) => (
            <button
              key={i}
              onClick={() => !flip && onIndex(i)}
              aria-label={`Ir pra página ${i + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === index ? 22 : 7,
                background: i === index ? "linear-gradient(90deg,#F1C665,#D4A94A)" : "rgba(245,242,237,.25)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function rotuloPagina(kind: SpreadKind, index: number, total: number): string {
  if (kind === "cover") return "CAPA";
  if (kind === "backcover") return "CONTRACAPA";
  return `LÂMINA ${index + 1} DE ${total}`;
}

function NavBtn({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void; key?: React.Key | null }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Anterior" : "Próxima"}
      className="absolute top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/35 text-luxury-cream backdrop-blur-md transition-all hover:bg-black/55 hover:border-gold-400/40 disabled:opacity-0"
      style={{ [side]: "-22px" } as React.CSSProperties}
    >
      {side === "left" ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}
