import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Cloud, CloudOff, Eye, Images, Loader2, MessageCircle, Pencil, Send, Sparkles, X } from "lucide-react";

import { ErroApiPublica, publicGet, publicPost } from "./api";
import { TelaAprovado, TelaCarregando, TelaPreparacao, TelaTokenInvalido } from "./components/Telas";
import { TelaLogin } from "./components/TelaLogin";
import { AlbumFlipbook } from "./components/AlbumFlipbook";
import { usePublicAutosave } from "./hooks/usePublicAutosave";
import { useSpreadImages } from "./hooks/useSpreadImages";
import type { Album, AlbumAsset, AlbumComment, AlbumSpread } from "../album/types";
import AlbumCanvasEditor, { AlbumCanvasEditorHandle } from "../album/components/AlbumCanvasEditor";

interface RespostaAlbumPublico {
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
  comments?: AlbumComment[];
  needs_login?: boolean;
}

const STAGE_BG = "radial-gradient(130% 90% at 50% -10%, #211e1a 0%, #131210 45%, #0a0a0a 100%)";

// Apresentação pública do álbum (cliente). Tema premium da marca (dourado/luxo),
// com prévia em livro 3D e, se permitido, modo de personalização. Login quando
// o álbum é privado.
export default function AlbumPublicoPage() {
  const { token } = useParams<{ token: string }>();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [album, setAlbum] = useState<Album | null>(null);
  const [assets, setAssets] = useState<AlbumAsset[]>([]);
  const [spreads, setSpreads] = useState<AlbumSpread[]>([]);
  const [comentarios, setComentarios] = useState<AlbumComment[]>([]);
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
        setComentarios(dados.comments || []);
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
    <Apresentacao
      token={token}
      album={album}
      assets={assets}
      spreads={spreads}
      setSpreads={setSpreads}
      comentarios={comentarios}
      setComentarios={setComentarios}
      onAprovado={() => setAprovado(true)}
    />
  );
}

interface PropsApresentacao {
  token: string;
  album: Album;
  assets: AlbumAsset[];
  spreads: AlbumSpread[];
  setSpreads: React.Dispatch<React.SetStateAction<AlbumSpread[]>>;
  comentarios: AlbumComment[];
  setComentarios: React.Dispatch<React.SetStateAction<AlbumComment[]>>;
  onAprovado: () => void;
}

function Apresentacao(p: PropsApresentacao) {
  const podeEditar = p.album.allow_client_edit && p.album.status !== "approved";
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [indice, setIndice] = useState(0);
  const [aprovando, setAprovando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [erroAprovar, setErroAprovar] = useState<string | null>(null);
  const [showComentarios, setShowComentarios] = useState(false);

  const { estado, agendar } = usePublicAutosave(p.token, podeEditar);
  const verAtivo = modo === "ver";
  const { images, ready, progress, total } = useSpreadImages(p.spreads, p.album.size, verAtivo);

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
      setConfirmar(false);
    }
  };

  return (
    <div className="flex h-full flex-col text-luxury-cream" style={{ background: STAGE_BG }}>
      {/* Cabeçalho */}
      <header className="flex flex-shrink-0 items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="min-w-0">
          {p.album.studio_name && (
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-400/80">
              {p.album.studio_name}
            </p>
          )}
          <h1 className="truncate font-serif text-2xl font-light leading-tight sm:text-[28px]">{p.album.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {podeEditar && !verAtivo && <IndicadorSalvamento estado={estado} />}
          <button
            onClick={() => setShowComentarios(true)}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-luxury-cream backdrop-blur-sm transition-colors hover:border-gold-400/40 hover:bg-white/10"
          >
            <MessageCircle size={13} /> Comentar
            {p.comentarios.length > 0 && (
              <span className="ml-0.5 rounded-full bg-gold-400/90 px-1.5 text-[10px] font-bold text-luxury-black">
                {p.comentarios.length}
              </span>
            )}
          </button>
          {podeEditar && (
            <button
              onClick={() => setModo(verAtivo ? "editar" : "ver")}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-luxury-cream backdrop-blur-sm transition-colors hover:border-gold-400/40 hover:bg-white/10"
            >
              {verAtivo ? <><Pencil size={13} /> Personalizar</> : <><Eye size={13} /> Ver apresentação</>}
            </button>
          )}
        </div>
      </header>

      {/* Corpo */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 sm:px-8">
        {verAtivo ? (
          p.spreads.length === 0 ? (
            <VazioElegante />
          ) : ready ? (
            <div className="flex flex-1 items-center justify-center py-4">
              <div className="animate-album-rise">
                <AlbumFlipbook
                  images={images}
                  spreads={p.spreads}
                  size={p.album.size}
                  index={curIndex}
                  onIndex={setIndice}
                />
              </div>
            </div>
          ) : (
            <RenderizandoPrevia done={progress} total={total} />
          )
        ) : (
          <div className="mx-auto w-full max-w-5xl py-2">
            <AlbumCanvasEditor
              spreads={p.spreads}
              assets={p.assets}
              size={p.album.size}
              currentIndex={curIndex}
              readOnly={false}
              onSpreadsChange={onSpreadsChange}
              onReady={(h) => { handleRef.current = h; }}
            />
            <NavegadorEdicao indice={curIndex} total={p.spreads.length} onIr={setIndice} />
          </div>
        )}
      </main>

      {/* Rodapé / ações */}
      <footer className="flex-shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-8">
        {erroAprovar && <p className="mb-2 text-center text-xs text-red-300">{erroAprovar}</p>}
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2">
          <button
            onClick={() => setConfirmar(true)}
            disabled={aprovando}
            className="bg-gold-gradient inline-flex items-center gap-2 rounded-full px-9 py-3.5 text-sm font-semibold text-luxury-black shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ boxShadow: "0 14px 34px -12px rgba(241,198,101,.5)" }}
          >
            {aprovando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Aprovar álbum
          </button>
          <p className="text-[11px] text-luxury-cream/40">
            Ao aprovar, seu fotógrafo é avisado e o álbum é finalizado.
          </p>
        </div>
      </footer>

      {/* Bandeja de fotos (modo edição) */}
      {!verAtivo && podeEditar && (
        <BandejaCliente
          assets={p.assets}
          aberta={bandejaAberta}
          onToggle={() => setBandejaAberta((v) => !v)}
          onEscolher={(a) => handleRef.current?.addPhoto(a)}
        />
      )}

      {showComentarios && (
        <PainelComentarios
          token={p.token}
          paginaAtual={curIndex}
          comentarios={p.comentarios}
          setComentarios={p.setComentarios}
          onClose={() => setShowComentarios(false)}
        />
      )}

      {confirmar && (
        <ConfirmacaoAprovar
          onConfirm={aprovar}
          onCancel={() => setConfirmar(false)}
          aprovando={aprovando}
        />
      )}
    </div>
  );
}

function PainelComentarios({
  token, paginaAtual, comentarios, setComentarios, onClose,
}: {
  token: string;
  paginaAtual: number;
  comentarios: AlbumComment[];
  setComentarios: React.Dispatch<React.SetStateAction<AlbumComment[]>>;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [refPagina, setRefPagina] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    const body = texto.trim();
    if (!body || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await publicPost<{ comment: AlbumComment }>(
        `/api/public/album/${token}/comment`,
        { body, spread_position: refPagina ? paginaAtual : null },
        token,
      );
      setComentarios((cs) => [r.comment, ...cs]);
      setTexto("");
    } catch (e) {
      setErro(e instanceof ErroApiPublica ? e.message : "Não foi possível enviar agora.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-luxury-charcoal text-luxury-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-gold-400" />
            <h2 className="font-serif text-xl font-light">Comentários e ajustes</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-luxury-cream/50 hover:bg-white/10" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-white/10 p-4">
          <p className="mb-2 text-xs text-luxury-cream/55">
            Gostou de algo ou quer mudar? Conte aqui o que o estúdio deve ajustar.
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Ex.: Trocar a foto grande da capa pela do beijo; diminuir a foto da lâmina 3…"
            className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-luxury-cream placeholder:text-luxury-cream/30 focus:border-gold-400/60 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-luxury-cream/60">
            <input type="checkbox" checked={refPagina} onChange={(e) => setRefPagina(e.target.checked)} className="accent-gold-400" />
            Referente à lâmina {paginaAtual + 1} que estou vendo
          </label>
          {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
          <button
            onClick={enviar}
            disabled={enviando || !texto.trim()}
            className="bg-gold-gradient mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-luxury-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar comentário
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {comentarios.length === 0 ? (
            <p className="py-8 text-center text-sm text-luxury-cream/40">Nenhum comentário ainda.</p>
          ) : (
            <ul className="space-y-3">
              {comentarios.map((c) => (
                <li key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-luxury-cream/45">
                    {c.spread_position != null && (
                      <span className="rounded-full bg-gold-400/15 px-2 py-0.5 font-medium text-gold-400">Lâmina {c.spread_position + 1}</span>
                    )}
                    <span>{c.author_name || "Você"}</span>
                    {c.resolved && <span className="ml-auto inline-flex items-center gap-1 text-emerald-400"><Check size={11} /> resolvido</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-luxury-cream/90">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RenderizandoPrevia({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <div className="relative flex items-center justify-center">
        <div className="absolute h-20 w-20 rounded-full blur-2xl" style={{ background: "radial-gradient(circle, rgba(241,198,101,.3), transparent 70%)" }} />
        <Sparkles size={26} className="relative text-gold-400" />
      </div>
      <p className="font-serif text-xl font-light text-luxury-cream">Montando seu álbum…</p>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
        <div className="bg-gold-gradient h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-luxury-cream/40">{done} de {total} lâminas</p>
    </div>
  );
}

function VazioElegante() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Images size={26} className="text-luxury-cream/30" />
      <p className="text-sm text-luxury-cream/50">Este álbum ainda não tem lâminas.</p>
    </div>
  );
}

function NavegadorEdicao({ indice, total, onIr }: { indice: number; total: number; onIr: (i: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-4">
      <button
        disabled={indice <= 0}
        onClick={() => onIr(indice - 1)}
        className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-luxury-cream disabled:opacity-30"
      >
        Anterior
      </button>
      <span className="text-xs font-medium text-luxury-cream/60">Página {indice + 1} de {total}</span>
      <button
        disabled={indice >= total - 1}
        onClick={() => onIr(indice + 1)}
        className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-luxury-cream disabled:opacity-30"
      >
        Próxima
      </button>
    </div>
  );
}

function IndicadorSalvamento({ estado }: { estado: string }) {
  if (estado === "salvando") return <span className="inline-flex items-center gap-1 text-[11px] text-luxury-cream/50"><Loader2 size={11} className="animate-spin" /> salvando…</span>;
  if (estado === "salvo") return <span className="inline-flex items-center gap-1 text-[11px] text-gold-400"><Cloud size={11} /> salvo</span>;
  if (estado === "erro") return <span className="inline-flex items-center gap-1 text-[11px] text-red-300"><CloudOff size={11} /> erro</span>;
  return null;
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
    <div className="flex-shrink-0 border-t border-white/10 bg-black/40 backdrop-blur-md">
      <button onClick={onToggle} className="w-full py-2 text-xs font-semibold text-luxury-cream/70 hover:text-luxury-cream">
        {aberta ? "Esconder fotos" : "Mostrar fotos pra adicionar"}
      </button>
      {aberta && (
        <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto px-3 pb-3 sm:grid-cols-8">
          {assets.map((a) => (
            <button
              key={a.id}
              onClick={() => onEscolher(a)}
              className="aspect-square overflow-hidden rounded-lg ring-1 ring-white/15"
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

function ConfirmacaoAprovar({ onConfirm, onCancel, aprovando }: { onConfirm: () => void; onCancel: () => void; aprovando: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-luxury-charcoal p-6 text-center text-luxury-cream shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-gold-400/30 bg-white/5 text-gold-400">
          <Check size={22} />
        </div>
        <h3 className="font-serif text-2xl font-light">Aprovar o álbum?</h3>
        <p className="mt-2 text-sm text-luxury-cream/55">
          Depois de aprovar, o álbum é finalizado e segue pra produção. Confira se está tudo do seu jeito.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            disabled={aprovando}
            className="flex-1 rounded-full border border-white/15 px-4 py-2.5 text-sm text-luxury-cream/80 hover:bg-white/5"
          >
            Revisar mais
          </button>
          <button
            onClick={onConfirm}
            disabled={aprovando}
            className="bg-gold-gradient flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-luxury-black disabled:opacity-60"
          >
            {aprovando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Aprovar
          </button>
        </div>
      </div>
    </div>
  );
}
