import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, CloudOff, Loader2 } from "lucide-react";

import { publicGet, publicPost } from "./api";
import { TelaAprovado, TelaCarregando, TelaPreparacao, TelaTokenInvalido } from "./components/Telas";
import { TelaLogin } from "./components/TelaLogin";
import { usePublicAutosave } from "./hooks/usePublicAutosave";
import type { Album, AlbumAsset, AlbumSpread } from "../album/types";
import AlbumCanvasEditor, { AlbumCanvasEditorHandle } from "../album/components/AlbumCanvasEditor";
import { ROSA } from "./utils";

interface RespostaAlbumPublico {
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
  needs_login?: boolean;
}

// Editor público do álbum (cliente). Abre /a/:token no celular, vê as lâminas
// no canvas, edita (se permitido) e aprova. Se o álbum exige login, mostra a
// tela de login antes de liberar o conteúdo.
export default function AlbumPublicoPage() {
  const { token } = useParams<{ token: string }>();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [album, setAlbum] = useState<Album | null>(null);
  const [assets, setAssets] = useState<AlbumAsset[]>([]);
  const [spreads, setSpreads] = useState<AlbumSpread[]>([]);
  const [aprovado, setAprovado] = useState(false);
  const [precisaLogin, setPrecisaLogin] = useState(false);

  const carregar = useCallback(async (): Promise<void> => {
    if (!token) { setErro(true); setCarregando(false); return; }
    setCarregando(true);
    try {
      const dados = await publicGet<RespostaAlbumPublico>(`/api/public/album/${token}`, token);
      setAlbum(dados.album);
      if (dados.needs_login) {
        setPrecisaLogin(true);
      } else {
        setPrecisaLogin(false);
        setAssets(dados.assets || []);
        setSpreads([...(dados.spreads || [])].sort((a, b) => a.position - b.position));
        if (dados.album?.status === "approved") setAprovado(true);
      }
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (!album) return;
    document.title = album.studio_name ? `${album.title} · ${album.studio_name}` : album.title;
  }, [album]);

  if (carregando) return <TelaCarregando />;
  if (erro || !album || !token) return <TelaTokenInvalido />;
  if (precisaLogin) {
    return (
      <TelaLogin
        shareToken={token}
        info={{ title: album.title, studio_name: album.studio_name }}
        onSucesso={() => { void carregar(); }}
      />
    );
  }
  if (aprovado || album.status === "approved") return <TelaAprovado estudio={album.studio_name} />;
  if (album.status === "draft") return <TelaPreparacao estudio={album.studio_name} />;

  return (
    <Editor token={token} album={album} assets={assets} spreads={spreads} setSpreads={setSpreads} onAprovado={() => setAprovado(true)} />
  );
}

interface PropsEditor {
  token: string;
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
  setSpreads: React.Dispatch<React.SetStateAction<AlbumSpread[]>>;
  onAprovado: () => void;
}

function Editor(p: PropsEditor) {
  const podeEditar = p.album.allow_client_edit && p.album.status !== "approved";
  const { estado, agendar } = usePublicAutosave(p.token, podeEditar);

  const [indice, setIndice] = useState(0);
  const [aprovando, setAprovando] = useState(false);
  const [erroAprovar, setErroAprovar] = useState<string | null>(null);
  const handleRef = useRef<AlbumCanvasEditorHandle | null>(null);
  const [bandejaAberta, setBandejaAberta] = useState(false);

  const curIndex = Math.min(indice, Math.max(0, p.spreads.length - 1));

  const onSpreadsChange = (next: AlbumSpread[]) => {
    p.setSpreads(next);
    agendar(next);
  };

  const aprovar = async () => {
    setAprovando(true);
    setErroAprovar(null);
    try {
      await publicPost(`/api/public/album/${p.token}/approve`, undefined, p.token);
      p.onAprovado();
    } catch {
      setErroAprovar("Não foi possível aprovar agora. Tente novamente.");
      setAprovando(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#FAF8F6] text-neutral-900">
      <header className="flex-shrink-0 border-b border-neutral-200 bg-white px-4 py-3 text-center">
        {p.album.studio_name && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-neutral-400">{p.album.studio_name}</p>
        )}
        <h1 className="mt-0.5 font-serif text-xl font-medium text-neutral-900">{p.album.title}</h1>
        {podeEditar && <IndicadorSalvamento estado={estado} />}
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-6">
        {p.spreads.length > 0 ? (
          <div className="mx-auto max-w-3xl pt-4">
            <AlbumCanvasEditor
              spreads={p.spreads}
              assets={p.assets}
              size={p.album.size}
              currentIndex={curIndex}
              readOnly={!podeEditar}
              onSpreadsChange={onSpreadsChange}
              onReady={(h) => { handleRef.current = h; }}
            />
            <Navegador indice={curIndex} total={p.spreads.length} onIr={setIndice} />
          </div>
        ) : (
          <p className="px-6 py-16 text-center text-sm text-neutral-400">Este álbum ainda não tem lâminas.</p>
        )}

        <BotaoAprovar aprovando={aprovando} erro={erroAprovar} onAprovar={aprovar} />
      </main>

      {podeEditar && (
        <BandejaCliente
          assets={p.assets}
          aberta={bandejaAberta}
          onToggle={() => setBandejaAberta((v) => !v)}
          onEscolher={(a) => handleRef.current?.addPhoto(a)}
        />
      )}
    </div>
  );
}

function Navegador({ indice, total, onIr }: { indice: number; total: number; onIr: (i: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-4">
      <button disabled={indice <= 0} onClick={() => onIr(indice - 1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-black/5 disabled:opacity-30">
        <ChevronLeft size={18} />
      </button>
      <span className="text-xs font-medium text-neutral-500">Página {indice + 1} de {total}</span>
      <button disabled={indice >= total - 1} onClick={() => onIr(indice + 1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-black/5 disabled:opacity-30">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function BandejaCliente({
  assets, aberta, onToggle, onEscolher,
}: {
  assets: AlbumAsset[];
  aberta: boolean;
  onToggle: () => void;
  onEscolher: (a: AlbumAsset) => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
      <button onClick={onToggle} className="w-full py-2 text-xs font-semibold text-neutral-600">
        {aberta ? "Esconder fotos" : "Mostrar fotos pra adicionar"}
      </button>
      {aberta && (
        <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto px-3 pb-3 sm:grid-cols-6">
          {assets.map((a) => (
            <button
              key={a.id}
              onClick={() => onEscolher(a)}
              className="aspect-square overflow-hidden rounded-lg ring-1 ring-black/10"
              title={a.original_name || ""}
            >
              {(a.thumb_url || a.preview_url) && (
                <img src={a.thumb_url || a.preview_url || ""} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IndicadorSalvamento({ estado }: { estado: string }) {
  if (estado === "salvando") return <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-400"><Loader2 size={11} className="animate-spin" /> salvando…</p>;
  if (estado === "salvo") return <p className="mt-1 inline-flex items-center gap-1 text-[11px]" style={{ color: ROSA }}><Check size={11} /> salvo</p>;
  if (estado === "erro") return <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-red-500"><CloudOff size={11} /> erro ao salvar</p>;
  return null;
}

function BotaoAprovar({ aprovando, erro, onAprovar }: { aprovando: boolean; erro: string | null; onAprovar: () => void }) {
  return (
    <div className="mx-auto mt-8 max-w-3xl text-center">
      <button
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
