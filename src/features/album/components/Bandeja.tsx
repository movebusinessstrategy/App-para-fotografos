import React, { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { cn } from "../../../utils/cn";
import type { AlbumAsset } from "../types";
import { uploadAlbumFiles, AlbumUploadProgress } from "./albumUpload";

type BandejaTab = "galeria" | "upload";

interface BandejaProps {
  albumId: string;
  assets: AlbumAsset[];
  // ids de assets já usados em alguma lâmina (marca visualmente).
  usedAssetIds: Set<string>;
  onChanged: () => void; // recarrega o álbum (assets)
  onNotify: (kind: "success" | "error", msg: string) => void;
}

// Thumb arrastável de uma foto da bandeja. id = "asset:<id>" pra distinguir
// dos slots no onDragEnd.
function AssetThumb({ asset, used }: { asset: AlbumAsset; used: boolean; key?: React.Key | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${asset.id}`,
    data: { type: "asset", assetId: asset.id },
  });
  const processing = !asset.thumb_url && !asset.preview_url;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "relative aspect-square rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 bg-gray-100 dark:bg-gray-800 cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-40",
        used && "ring-2 ring-violet-400",
      )}
      title={asset.original_name || ""}
    >
      {asset.thumb_url || asset.preview_url ? (
        <img
          src={asset.thumb_url || asset.preview_url || ""}
          alt=""
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : processing ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={14} className="animate-spin text-gray-400" />
        </div>
      ) : null}
      {used && (
        <span className="absolute top-0.5 right-0.5 rounded-full bg-violet-500 text-white text-[8px] px-1 leading-tight">
          usada
        </span>
      )}
    </div>
  );
}

export function Bandeja({ albumId, assets, usedAssetIds, onChanged, onNotify }: BandejaProps) {
  const [tab, setTab] = useState<BandejaTab>("galeria");
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<AlbumUploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const galleryAssets = assets.filter((a) => a.source === "gallery");
  const uploadAssets = assets.filter((a) => a.source === "upload");
  const list = tab === "galeria" ? galleryAssets : uploadAssets;

  const handleFiles = async (files: FileList | null) => {
    setUploading(true);
    try {
      const errors = await uploadAlbumFiles(albumId, files, setProgress);
      onChanged();
      if (errors.length > 0) onNotify("error", `${errors.length} foto(s) falharam.`);
      else onNotify("success", "Fotos enviadas.");
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (asset: AlbumAsset, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(asset.id);
    try {
      const res = await authFetch(`/api/albums/${albumId}/assets/${asset.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      onNotify("error", "Não foi possível remover a foto.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Abas */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 m-2">
        <TabBtn active={tab === "galeria"} onClick={() => setTab("galeria")} icon={<ImageIcon size={13} />} label={`Galeria (${galleryAssets.length})`} />
        <TabBtn active={tab === "upload"} onClick={() => setTab("upload")} icon={<Upload size={13} />} label={`Upload (${uploadAssets.length})`} />
      </div>

      {tab === "upload" && (
        <div className="px-2 pb-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-60"
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
              <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1">
                <span>Enviando…</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grade de thumbs */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-400 dark:text-gray-500">
            {tab === "galeria"
              ? "Nenhuma foto vinda da galeria."
              : "Suba suas fotos pra usar no álbum."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((a) => (
              <div key={a.id} className="group relative">
                <AssetThumb asset={a} used={usedAssetIds.has(a.id)} />
                <button
                  onClick={(e) => handleDelete(a, e)}
                  disabled={deleting === a.id}
                  className="absolute bottom-0.5 right-0.5 rounded-full bg-black/55 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remover da bandeja"
                >
                  {deleting === a.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
        "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors",
        active
          ? "bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200",
      )}
    >
      {icon} {label}
    </button>
  );
}
