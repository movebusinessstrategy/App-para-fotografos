import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Check, ChevronLeft, ChevronRight, CloudOff, Loader2 } from "lucide-react";
import { ErroApiPublica, publicGet, publicPost } from "./api";
import { Bandeja } from "./components/Bandeja";
import { Lamina } from "./components/Lamina";
import { SeletorTemplate } from "./components/SeletorTemplate";
import { TelaAprovado, TelaCarregando, TelaPreparacao, TelaTokenInvalido } from "./components/Telas";
import { useAutosaveSpreads } from "./hooks/useAutosaveSpreads";
import type { Album, AlbumAsset, AlbumSpread } from "../album/types";
import { templateById } from "../album/templates";
import {
  assetsUsados,
  colocarFoto,
  normalizarSpreads,
  parseAssetId,
  parseSlotId,
  trocarTemplate,
} from "./spreads";
import { ratioDoTamanho, ROSA } from "./utils";

interface RespostaAlbumPublico {
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
}

// Editor público do álbum (cliente). Abre /a/:token no celular, vê as lâminas,
// arrasta fotos da bandeja pros slots, troca o layout e aprova o álbum.
export default function AlbumPublicoPage() {
  const { token } = useParams<{ token: string }>();

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [album, setAlbum] = useState<Album | null>(null);
  const [assets, setAssets] = useState<AlbumAsset[]>([]);
  const [spreads, setSpreads] = useState<AlbumSpread[]>([]);
  const [aprovado, setAprovado] = useState(false);

  useEffect(() => {
    if (!token) {
      setErro(true);
      setCarregando(false);
      return;
    }
    let ativo = true;
    setCarregando(true);
    publicGet<RespostaAlbumPublico>(`/api/public/album/${token}`)
      .then((dados) => {
        if (!ativo) return;
        setAlbum(dados.album);
        setAssets(dados.assets || []);
        setSpreads(normalizarSpreads(dados.spreads || []));
        if (dados.album?.status === "approved") setAprovado(true);
      })
      .catch((e) => {
        if (!ativo) return;
        if (e instanceof ErroApiPublica) setErro(true);
        else setErro(true);
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [token]);

  useEffect(() => {
    if (!album) return;
    document.title = album.studio_name ? `${album.title} · ${album.studio_name}` : album.title;
  }, [album]);

  if (carregando) return <TelaCarregando />;
  if (erro || !album || !token) return <TelaTokenInvalido />;
  if (aprovado || album.status === "approved")
    return <TelaAprovado estudio={album.studio_name} />;
  if (album.status === "draft") return <TelaPreparacao estudio={album.studio_name} />;

  return (
    <Editor
      token={token}
      album={album}
      assets={assets}
      spreads={spreads}
      setSpreads={setSpreads}
      onAprovado={() => setAprovado(true)}
    />
  );
}

type PropsEditor = {
  token: string;
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
  setSpreads: React.Dispatch<React.SetStateAction<AlbumSpread[]>>;
  onAprovado: () => void;
};

function Editor(p: PropsEditor) {
  const podeEditar = p.album.allow_client_edit && p.album.status !== "approved";
  const { estado, agendar } = useAutosaveSpreads(p.token, podeEditar);

  const [indice, setIndice] = useState(0);
  const [assetArrastado, setAssetArrastado] = useState<AlbumAsset | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [erroAprovar, setErroAprovar] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  const assetsById = useMemo<Record<string, AlbumAsset>>(() => {
    const m: Record<string, AlbumAsset> = {};
    p.assets.forEach((a) => (m[a.id] = a));
    return m;
  }, [p.assets]);

  const usados = useMemo(() => assetsUsados(p.spreads), [p.spreads]);
  const ratio = ratioDoTamanho(p.album.size);

  const aplicar = (next: AlbumSpread[]) => {
    p.setSpreads(next);
    agendar(next);
  };

  const handleDragStart = (e: DragStartEvent) => {
    const assetId = parseAssetId(String(e.active.id));
    setAssetArrastado(assetId ? assetsById[assetId] || null : null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setAssetArrastado(null);
    const { active, over } = e;
    if (!over || !podeEditar) return;
    const assetId = parseAssetId(String(active.id));
    const destino = parseSlotId(String(over.id));
    if (!assetId || !destino) return;
    aplicar(colocarFoto(p.spreads, destino.spreadIndex, destino.slot, assetId));
  };

  const handleTrocarTemplate = (templateId: string) => {
    aplicar(trocarTemplate(p.spreads, indice, templateId));
  };

  const aprovar = async () => {
    setAprovando(true);
    setErroAprovar(null);
    try {
      await publicPost(`/api/public/album/${p.token}/approve`);
      p.onAprovado();
    } catch {
      setErroAprovar("Não foi possível aprovar agora. Tente novamente.");
      setAprovando(false);
    }
  };

  const atual = p.spreads[indice];
  const template = atual ? templateById(atual.template_id) : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full flex-col bg-[#FAF8F6] text-neutral-900">
        <Cabecalho album={p.album} estado={estado} podeEditar={podeEditar} />

        <main className="flex-1 overflow-y-auto px-4 pb-6">
          {atual && template ? (
            <NavegadorLamina
              indice={indice}
              total={p.spreads.length}
              onIr={setIndice}
            >
              <Lamina
                spreadIndex={indice}
                template={template}
                slots={atual.slots}
                ratio={ratio}
                assetsById={assetsById}
                podeEditar={podeEditar}
              />
            </NavegadorLamina>
          ) : (
            <p className="px-6 py-16 text-center text-sm text-neutral-400">
              Este álbum ainda não tem lâminas.
            </p>
          )}

          <BotaoAprovar
            podeEditar={p.album.status !== "approved"}
            aprovando={aprovando}
            erro={erroAprovar}
            onAprovar={aprovar}
          />
        </main>

        <div className="flex-shrink-0">
          {atual && (
            <SeletorTemplate
              templateAtual={atual.template_id}
              podeEditar={podeEditar}
              onTrocar={handleTrocarTemplate}
            />
          )}
          <Bandeja assets={p.assets} usados={usados} podeEditar={podeEditar} />
        </div>
      </div>

      <DragOverlay>
        {assetArrastado && (
          <div className="h-20 w-20 overflow-hidden rounded-lg ring-2 ring-white shadow-xl">
            <img
              src={assetArrastado.thumb_url || assetArrastado.preview_url || ""}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Cabecalho({
  album,
  estado,
  podeEditar,
}: {
  album: Album;
  estado: string;
  podeEditar: boolean;
}) {
  return (
    <header className="flex-shrink-0 border-b border-neutral-200 bg-white px-4 py-3 text-center">
      {album.studio_name && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-neutral-400">
          {album.studio_name}
        </p>
      )}
      <h1 className="mt-0.5 font-serif text-xl font-medium text-neutral-900">{album.title}</h1>
      {podeEditar && <IndicadorSalvamento estado={estado} />}
    </header>
  );
}

function IndicadorSalvamento({ estado }: { estado: string }) {
  if (estado === "salvando")
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-400">
        <Loader2 size={11} className="animate-spin" /> salvando…
      </p>
    );
  if (estado === "salvo")
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-[11px]" style={{ color: ROSA }}>
        <Check size={11} /> salvo
      </p>
    );
  if (estado === "erro")
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-red-500">
        <CloudOff size={11} /> erro ao salvar
      </p>
    );
  return null;
}

function NavegadorLamina({
  indice,
  total,
  onIr,
  children,
}: {
  indice: number;
  total: number;
  onIr: (i: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl pt-4">
      {children}
      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          type="button"
          disabled={indice <= 0}
          onClick={() => onIr(indice - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-black/5 disabled:opacity-30"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-xs font-medium text-neutral-500">
          Lâmina {indice + 1} de {total}
        </span>
        <button
          type="button"
          disabled={indice >= total - 1}
          onClick={() => onIr(indice + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-black/5 disabled:opacity-30"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function BotaoAprovar({
  podeEditar,
  aprovando,
  erro,
  onAprovar,
}: {
  podeEditar: boolean;
  aprovando: boolean;
  erro: string | null;
  onAprovar: () => void;
}) {
  if (!podeEditar) return null;
  return (
    <div className="mx-auto mt-8 max-w-3xl text-center">
      <button
        type="button"
        disabled={aprovando}
        onClick={onAprovar}
        className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold text-white shadow-lg transition-colors disabled:opacity-60"
        style={{ backgroundColor: ROSA, boxShadow: `0 10px 20px -8px ${ROSA}` }}
      >
        {aprovando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        Aprovar álbum
      </button>
      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
      <p className="mt-2 text-[11px] text-neutral-400">
        Ao aprovar, seu fotógrafo é avisado e o álbum não poderá mais ser editado.
      </p>
    </div>
  );
}
