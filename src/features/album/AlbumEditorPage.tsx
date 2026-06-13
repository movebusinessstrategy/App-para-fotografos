import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Send } from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { ALBUM_SIZES } from "./templates";
import { medidasResumo } from "./components/exportFreeCanvas";
import type { AlbumSpread } from "./types";
import AlbumCanvasEditor, { AlbumCanvasEditorHandle } from "./components/AlbumCanvasEditor";
import { FerramentasPanel, Ferramenta } from "./components/FerramentasPanel";
import { TiraPaginas } from "./components/TiraPaginas";
import { ExportarMenu } from "./components/ExportarMenu";
import { EnviarAlbumModal } from "./components/EnviarAlbumModal";
import { useAlbumFreeEditor, SaveState } from "./components/useAlbumFreeEditor";
import { Toast, ToastKind, ToastState } from "../galeria/Toast";

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1.5 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> salvando…</span>;
  if (state === "saved") return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500"><Check size={12} /> salvo</span>;
  if (state === "error") return <span className="text-xs text-red-500">erro ao salvar</span>;
  return null;
}

// Editor LIVRE do álbum (lado estúdio). Canvas central + ferramentas + tira.
export default function AlbumEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const editor = useAlbumFreeEditor(id);
  const { detail, spreads, loadError, saveState } = editor;

  const [current, setCurrent] = useState(0);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("fotos");
  const [showSend, setShowSend] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const canvasHandleRef = useRef<AlbumCanvasEditorHandle | null>(null);
  const [, forceRender] = useState(0);

  const notify = (kind: ToastKind, message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const assets = detail?.assets || [];
  const album = detail?.album;
  const curIndex = Math.min(current, Math.max(0, spreads.length - 1));

  if (loadError) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Não foi possível abrir o álbum.</p>
        <button onClick={() => navigate("/album")} className="mt-3 text-sm text-violet-600 hover:underline">Voltar pros álbuns</button>
      </div>
    );
  }

  if (!album) {
    return <div className="flex items-center justify-center p-16 text-gray-400"><Loader2 size={20} className="animate-spin" /></div>;
  }

  const onSpreadsChange = (next: AlbumSpread[]) => editor.applySpreads(next);

  return (
    <div className="-m-2 flex h-[calc(100vh-7rem)] flex-col sm:-m-0">
      {/* Topbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-800 px-2 py-2">
        <button onClick={() => navigate("/album")} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-gray-900 dark:text-white">{album.title}</h1>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {album.client_name ? `${album.client_name} · ` : ""}{medidasResumo(album.size)}
          </p>
        </div>
        <div className="ml-2"><SaveBadge state={saveState} /></div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className="rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300"
            title="O tamanho é definido ao criar o álbum e não muda depois (evita bagunçar a diagramação)."
          >
            {ALBUM_SIZES.find((s) => s.id === album.size)?.label || album.size}
          </span>
          <ExportarMenu albumId={id} title={album.title} size={album.size} spreads={spreads} onNotify={notify} />
          <button
            onClick={() => setShowSend(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Send size={13} /> Enviar pra cliente
          </button>
        </div>
      </div>

      {/* Corpo */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden flex-shrink-0 md:flex">
          <FerramentasPanel
            ferramenta={ferramenta}
            onFerramenta={setFerramenta}
            editor={canvasHandleRef.current}
            albumId={id}
            galleryId={album.gallery_id}
            assets={assets}
            onChanged={editor.reloadAssets}
            onNotify={notify}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-gray-50 dark:bg-gray-950 p-4 sm:p-6">
          <div className="mb-2 text-center text-xs text-gray-400 dark:text-gray-500">
            Página {curIndex + 1} de {spreads.length}
          </div>
          {spreads.length > 0 ? (
            <AlbumCanvasEditor
              spreads={spreads}
              assets={assets}
              size={album.size}
              currentIndex={curIndex}
              onSpreadsChange={onSpreadsChange}
              onReady={(h) => { canvasHandleRef.current = h; forceRender((n) => n + 1); }}
            />
          ) : (
            <div className="py-16 text-center text-sm text-gray-400">
              Sem páginas. Adicione uma na tira abaixo.
            </div>
          )}
        </main>
      </div>

      {/* Tira de páginas */}
      <TiraPaginas
        spreads={spreads}
        size={album.size}
        currentIndex={curIndex}
        onSelect={setCurrent}
        onAdd={editor.addSpread}
        onDelete={(i) => { editor.deleteSpread(i); setCurrent((c) => Math.max(0, c - (i <= c ? 1 : 0))); }}
      />

      {showSend && (
        <EnviarAlbumModal
          album={album}
          onClose={() => setShowSend(false)}
          onSent={() => editor.load()}
          onNotify={notify}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
