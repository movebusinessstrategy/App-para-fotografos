import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookImage, Loader2, Plus, Trash2, X } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { useApi, refreshApi } from "../../utils/useApi";
import { cn } from "../../utils/cn";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ALBUM_SIZES, spreadCm } from "./templates";
import { GRAFICAS, graficaById, tamanhoToSize, type Grafica } from "./graficas";
import type { Album, AlbumListItem } from "./types";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  approved: "Aprovado",
};

const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
  sent: "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  approved: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const INPUT_CLS =
  "w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400";
const LABEL_CLS = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

// Página de listagem de álbuns: grid de cards + "Novo álbum".
export default function AlbumListPage() {
  const { data, error, isLoading } = useApi<{ albums: AlbumListItem[] }>("/api/albums");
  const albums = useMemo(() => (Array.isArray(data?.albums) ? data!.albums : []), [data]);
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState<AlbumListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (album: AlbumListItem) => {
    setDeleting(true);
    try {
      const res = await authFetch(`/api/albums/${album.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      refreshApi("/api/albums");
    } catch {
      /* silencioso — a lista atualiza sozinha no próximo refresh */
    } finally {
      setDeleting(false);
      setConfirmDel(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Álbuns</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Monte a diagramação do álbum e mande a prévia pra cliente aprovar.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold"
        >
          <Plus size={16} /> Novo álbum
        </button>
      </div>

      {isLoading && (
        <div className="py-16 flex items-center justify-center text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          Não foi possível carregar os álbuns. Atualize a página em alguns instantes.
        </div>
      )}

      {!isLoading && !error && albums.length === 0 && (
        <EmptyState onNew={() => setShowNew(true)} />
      )}

      {albums.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} onDelete={() => setConfirmDel(a)} />
          ))}
        </div>
      )}

      {showNew && (
        <NovoAlbumModal
          onClose={() => setShowNew(false)}
          onCreated={() => { refreshApi("/api/albums"); setShowNew(false); }}
        />
      )}

      <ConfirmModal
        open={!!confirmDel}
        title="Excluir álbum"
        message={`Excluir o álbum "${confirmDel?.title || ""}"? As fotos e lâminas dele serão removidas. Esta ação não pode ser desfeita.`}
        confirmText={deleting ? "Excluindo..." : "Excluir"}
        variant="danger"
        onConfirm={() => { if (confirmDel) handleDelete(confirmDel); }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 py-16 flex flex-col items-center justify-center text-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-violet-50 dark:bg-violet-500/15 flex items-center justify-center text-violet-600 dark:text-violet-300">
        <BookImage size={26} />
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white">Nenhum álbum ainda</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
          Crie um álbum, arraste as fotos nas lâminas e envie a prévia pra cliente aprovar.
        </p>
      </div>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold"
      >
        <Plus size={16} /> Novo álbum
      </button>
    </div>
  );
}

function AlbumCard({ album, onDelete }: { album: AlbumListItem; onDelete: () => void; key?: React.Key | null }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/album/${album.id}`)}
      className="group relative cursor-pointer text-left bg-white dark:bg-gray-800/90 ring-1 ring-gray-200 dark:ring-gray-700/80 rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Excluir álbum"
        className="absolute top-2 right-2 z-10 rounded-lg bg-white/90 dark:bg-gray-900/90 p-1.5 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
      >
        <Trash2 size={14} />
      </button>
      <div className="aspect-[3/2] bg-gray-100 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        {album.cover_thumb_url ? (
          <img
            src={album.cover_thumb_url}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <BookImage size={28} className="text-gray-300 dark:text-gray-600" />
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 dark:text-white text-sm truncate">{album.title}</div>
            {album.client_name && (
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{album.client_name}</div>
            )}
          </div>
          <span className={cn("flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold", STATUS_CLS[album.status] || STATUS_CLS.draft)}>
            {STATUS_LABEL[album.status] || album.status}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          {album.spread_count} lâmina{album.spread_count === 1 ? "" : "s"} · {album.asset_count} foto{album.asset_count === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

// ── Modal: novo álbum ───────────────────────────────────────────────────────

interface GalleryOption { id: string; title: string }

function NovoAlbumModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  // Reusa a lista de galerias pra puxar fotos selecionadas (opcional).
  const { data: galData } = useApi<{ galleries?: GalleryOption[] } | GalleryOption[]>("/api/galleries");
  const galleries = useMemo<GalleryOption[]>(() => {
    if (Array.isArray(galData)) return galData as GalleryOption[];
    return Array.isArray(galData?.galleries) ? galData!.galleries! : [];
  }, [galData]);

  const firstLinhaId = (gr: Grafica): string => gr.linhas?.[0]?.id || "";
  const sizeOfLinha = (gr: Grafica, lid: string): string => {
    const l = gr.linhas?.find((x) => x.id === lid);
    const t = l?.tamanhos?.[0];
    return t ? tamanhoToSize(t) : (ALBUM_SIZES[0]?.id || "sq30");
  };

  const [title, setTitle] = useState("");
  const [graficaId, setGraficaId] = useState("generico");
  const [linhaId, setLinhaId] = useState(() => firstLinhaId(graficaById("generico")));
  const [size, setSize] = useState<string>(() => sizeOfLinha(graficaById("generico"), firstLinhaId(graficaById("generico"))));
  const [customW, setCustomW] = useState("30");
  const [customH, setCustomH] = useState("30");
  const [galleryId, setGalleryId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const g = graficaById(graficaId);
  const temLinhas = !!(g.linhas && g.linhas.length);
  const linhaAtual = g.linhas?.find((l) => l.id === linhaId) || g.linhas?.[0];
  const isCustom = size === "__custom";

  const trocarGrafica = (id: string) => {
    const ng = graficaById(id);
    const lid = firstLinhaId(ng);
    setGraficaId(id);
    setLinhaId(lid);
    setSize(sizeOfLinha(ng, lid));
  };
  const trocarLinha = (lid: string) => {
    setLinhaId(lid);
    setSize(sizeOfLinha(g, lid));
  };

  // Medida resolvida (pra mostrar a prévia da lâmina).
  const sizeFinal = isCustom ? `${customW.replace(",", ".")}x${customH.replace(",", ".")}` : size;
  const sc = spreadCm(sizeFinal, "spread");
  const pg = spreadCm(sizeFinal, "cover");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr("Dê um nome pro álbum."); return; }
    if (isCustom && !(Number(customW) > 0 && Number(customH) > 0)) {
      setErr("Informe um tamanho personalizado válido (cm).");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          size: sizeFinal,
          gallery_id: galleryId || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { album: Album };
      // Lembra a gráfica escolhida pra o export já vir selecionado nela.
      try { localStorage.setItem(`album_grafica:${data.album.id}`, graficaId); } catch { /* ignora */ }
      onCreated();
      navigate(`/album/${data.album.id}`);
    } catch {
      setErr("Não foi possível criar o álbum. Tente em alguns instantes.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md border border-transparent dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Novo álbum</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 space-y-4">
          <div>
            <label className={LABEL_CLS}>Nome do álbum *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Álbum casamento — Ana & João"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Gráfica / laboratório</label>
            <select value={graficaId} onChange={(e) => trocarGrafica(e.target.value)} className={INPUT_CLS}>
              {GRAFICAS.map((op) => (
                <option key={op.id} value={op.id}>{op.nome}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              A diagramação já nasce no tamanho exato da gráfica. O tamanho não muda depois de criar.
            </p>
          </div>

          {temLinhas && (
            <div>
              <label className={LABEL_CLS}>Linha / coleção</label>
              <select value={linhaId} onChange={(e) => trocarLinha(e.target.value)} className={INPUT_CLS}>
                {g.linhas!.map((l) => (
                  <option key={l.id} value={l.id}>{l.nome}</option>
                ))}
              </select>
              {linhaAtual?.obs && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{linhaAtual.obs}</p>
              )}
            </div>
          )}

          <div>
            <label className={LABEL_CLS}>Tamanho</label>
            <select value={size} onChange={(e) => setSize(e.target.value)} className={INPUT_CLS}>
              {temLinhas
                ? (linhaAtual?.tamanhos || []).map((t) => (
                    <option key={tamanhoToSize(t)} value={tamanhoToSize(t)}>{t.label} cm</option>
                  ))
                : ALBUM_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
              <option value="__custom">Outro tamanho (personalizado)…</option>
            </select>

            {isCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min={5} max={100} step="0.1" value={customW} onChange={(e) => setCustomW(e.target.value)} className={INPUT_CLS} placeholder="Largura" />
                <span className="text-gray-400">×</span>
                <input type="number" min={5} max={100} step="0.1" value={customH} onChange={(e) => setCustomH(e.target.value)} className={INPUT_CLS} placeholder="Altura" />
                <span className="text-sm text-gray-500">cm</span>
              </div>
            )}

            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
              Página {pg.w}×{pg.h} cm · lâmina aberta {sc.w}×{sc.h} cm
            </p>
          </div>

          <div>
            <label className={LABEL_CLS}>Puxar fotos de uma galeria (opcional)</label>
            <select value={galleryId} onChange={(e) => setGalleryId(e.target.value)} className={INPUT_CLS}>
              <option value="">Não puxar — vou subir as fotos</option>
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Importa as fotos que a cliente já selecionou nessa galeria.
            </p>
          </div>

          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {loading ? "Criando..." : "Criar e abrir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
