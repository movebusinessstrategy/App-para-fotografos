import React, { useRef, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { cn } from "../../../utils/cn";
import type { AlbumAsset } from "../types";
import { uploadAlbumFiles, AlbumUploadProgress } from "./albumUpload";

type Tab = "galeria" | "upload";

interface Props {
  albumId: string;
  galleryId?: string | null;
  assets: AlbumAsset[];
  onAddPhoto: (asset: AlbumAsset) => void;
  onChanged: () => void;
  onNotify: (kind: "success" | "error", msg: string) => void;
}

// Bandeja de fotos do estúdio: importar da galeria + upload. Clicar numa foto
// a insere no canvas (onAddPhoto).
export function BandejaFotos(p: Props) {
  const [tab, setTab] = useState<Tab>("galeria");
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<AlbumUploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const galleryAssets = p.assets.filter((a) => a.source === "gallery");
  const uploadAssets = p.assets.filter((a) => a.source === "upload");
  const list = tab === "galeria" ? galleryAssets : uploadAssets;

  const handleFiles = async (files: FileList | null) => {
    setUploading(true);
    try {
      const errors = await uploadAlbumFiles(p.albumId, files, setProgress);
      p.onChanged();
      if (errors.length > 0) p.onNotify("error", `${errors.length} foto(s) falharam.`);
      else p.onNotify("success", "Fotos enviadas.");
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const importGallery = async () => {
    if (!p.galleryId) {
      p.onNotify("error", "Este álbum não está ligado a uma galeria.");
      return;
    }
    setImporting(true);
    try {
      const res = await authFetch(`/api/albums/${p.albumId}/assets/import-gallery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gallery_id: p.galleryId }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { imported?: number };
      p.onChanged();
      p.onNotify("success", `${data.imported ?? 0} foto(s) importadas da galeria.`);
    } catch {
      p.onNotify("error", "Não foi possível importar da galeria.");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (asset: AlbumAsset, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(asset.id);
    try {
      const res = await authFetch(`/api/albums/${p.albumId}/assets/${asset.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      p.onChanged();
    } catch {
      p.onNotify("error", "Não foi possível remover a foto.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="m-2 flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
        <TabBtn active={tab === "galeria"} onClick={() => setTab("galeria")} icon={<ImageIcon size={13} />} label={`Galeria (${galleryAssets.length})`} />
        <TabBtn active={tab === "upload"} onClick={() => setTab("upload")} icon={<Upload size={13} />} label={`Upload (${uploadAssets.length})`} />
      </div>

      {tab === "galeria" && (
        <div className="px-2 pb-2">
          <button
            onClick={importGallery}
            disabled={importing || !p.galleryId}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Importar da galeria
          </button>
          {!p.galleryId && (
            <p className="mt-1 text-[10px] text-gray-400">Álbum sem galeria ligada.</p>
          )}
        </div>
      )}

      {tab === "upload" && (
        <div className="px-2 pb-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Enviar fotos
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {progress && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span>Enviando…</span><span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-400 dark:text-gray-500">
            {tab === "galeria" ? "Importe as fotos selecionadas na galeria." : "Suba suas fotos pra usar no álbum."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((a) => (
              <FotoThumb key={a.id} asset={a} onClick={() => p.onAddPhoto(a)} onDelete={(e) => handleDelete(a, e)} deleting={deleting === a.id} />
            ))}
          </div>
        )}
      </div>
      <p className="px-3 pb-2 text-[10px] text-gray-400">Clique numa foto pra inserir na lâmina.</p>
    </div>
  );
}

function FotoThumb({
  asset, onClick, onDelete, deleting,
}: {
  asset: AlbumAsset;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  deleting: boolean;
  key?: React.Key | null;
}) {
  const ready = asset.thumb_url || asset.preview_url;
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        disabled={!ready}
        className="block aspect-square w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-violet-400 disabled:cursor-wait"
        title={asset.original_name || ""}
      >
        {ready ? (
          <img src={asset.thumb_url || asset.preview_url || ""} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center"><Loader2 size={14} className="animate-spin text-gray-400" /></div>
        )}
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="absolute bottom-0.5 right-0.5 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
        title="Remover da bandeja"
      >
        {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
      </button>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200",
      )}
    >
      {icon} {label}
    </button>
  );
}
