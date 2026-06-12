import React, { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Heart, Loader2, Trash2, Upload } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import { GalleryDetailResponse, GalleryPhoto } from "../types";
import { formatBRL } from "../utils";
import { ToastKind } from "../Toast";
import { SecaoHeader } from "./DadosSection";
import {
  RESOLUTIONS, UploadResolution, chunk, getSavedResolution, isHeic,
  prepareFile, runPool, saveResolution,
} from "./uploadHelpers";

interface FotosSectionProps {
  galleryId: string;
  data: GalleryDetailResponse;
  mutate: () => void;
  onChanged: () => void;
  onNotify: (kind: ToastKind, msg: string) => void;
  setUploading: (v: boolean) => void;
}

interface UploadProgress { done: number; total: number }

type SubAba = "enviar" | "selecionadas";

// Sub-abas: "Enviar fotos" (upload + grid) | "Selecionadas" (escolhas da
// cliente com comentários). Resolução do upload configurável (espaço).
export function FotosSection({
  galleryId, data, mutate, onChanged, onNotify, setUploading,
}: FotosSectionProps) {
  const photos = data.photos;
  const selections = data.selections;
  const gallery = data.gallery;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [clearingErrors, setClearingErrors] = useState(false);
  const [subAba, setSubAba] = useState<SubAba>("enviar");
  const [resolution, setResolution] = useState<UploadResolution>(getSavedResolution());

  const changeResolution = (r: UploadResolution) => {
    setResolution(r);
    saveResolution(r);
  };

  const selectedByPhoto = useMemo(() => {
    const map = new Map<string, { selected: boolean; comment: string | null }>();
    selections.forEach((s) => map.set(s.photo_id, { selected: s.selected, comment: s.client_comment }));
    return map;
  }, [selections]);

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedByPhoto.get(p.id)?.selected),
    [photos, selectedByPhoto],
  );

  const uploadOne = async (
    upload: { photo_id: string; signed_url: string },
    file: File,
    errors: string[],
  ) => {
    try {
      const put = await fetch(upload.signed_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("upload");
      const proc = await authFetch(`/api/galleries/${galleryId}/photos/${upload.photo_id}/process`, {
        method: "POST",
      });
      if (!proc.ok) throw new Error("process");
    } catch {
      errors.push(file.name);
    } finally {
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    const raw = Array.from(fileList || []).filter(
      (f) => f.type.startsWith("image/") || isHeic(f),
    );
    if (raw.length === 0) return;
    setUploadingLocal(true);
    setUploading(true);
    const errors: string[] = [];
    setProgress({ done: 0, total: raw.length });

    try {
      for (const batchRaw of chunk(raw, 20)) {
        const batch: File[] = [];
        for (const file of batchRaw) {
          try {
            batch.push(await prepareFile(file, resolution));
          } catch {
            errors.push(file.name);
            setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }
        if (batch.length === 0) continue;

        const res = await authFetch(`/api/galleries/${galleryId}/photos/sign-upload`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: batch.map((f) => ({ name: f.name, size: f.size, type: f.type })) }),
        });
        if (!res.ok) {
          batch.forEach((f) => errors.push(f.name));
          setProgress((p) => (p ? { ...p, done: p.done + batch.length } : p));
          continue;
        }
        const { uploads } = await res.json();
        await runPool(2, batch.map((file, i) => () => uploadOne(uploads[i], file, errors)));
      }
    } finally {
      setUploadingLocal(false);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      mutate();
      onChanged();
    }
    if (errors.length > 0) onNotify("error", `${errors.length} foto(s) falharam no envio.`);
    else onNotify("success", `${raw.length} foto(s) enviada(s).`);
  };

  const handleClearErrors = async () => {
    setClearingErrors(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/photos-erro`, { method: "DELETE" });
      if (!res.ok) throw new Error("falha");
      const { removed } = await res.json();
      onNotify("success", `${removed} foto(s) com erro removida(s).`);
      mutate(); onChanged();
    } catch {
      onNotify("error", "Não foi possível limpar.");
    } finally {
      setClearingErrors(false);
    }
  };

  const handleDeletePhoto = async (photo: GalleryPhoto) => {
    const res = await authFetch(`/api/galleries/${galleryId}/photos/${photo.id}`, { method: "DELETE" });
    if (!res.ok) { onNotify("error", "Erro ao remover."); return; }
    mutate(); onChanged();
  };

  const copyNames = async () => {
    try {
      await navigator.clipboard.writeText(selectedPhotos.map((p) => p.file_name).join("\n"));
      onNotify("success", "Nomes copiados.");
    } catch {
      onNotify("error", "Não foi possível copiar.");
    }
  };

  return (
    <div className="space-y-5">
      <SecaoHeader
        titulo="Fotos"
        descricao={`${photos.length} foto${photos.length === 1 ? "" : "s"} enviada${photos.length === 1 ? "" : "s"} pra essa galeria.`}
      />

      {/* Sub-abas: Enviar fotos | Selecionadas */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 w-fit">
        <button
          onClick={() => setSubAba("enviar")}
          className={
            "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors " +
            (subAba === "enviar"
              ? "bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200")
          }
        >
          <Upload size={14} /> Enviar fotos
        </button>
        <button
          onClick={() => setSubAba("selecionadas")}
          className={
            "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors " +
            (subAba === "selecionadas"
              ? "bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200")
          }
        >
          <Heart size={14} /> Selecionadas ({selectedPhotos.length})
        </button>
      </div>

      {subAba === "enviar" && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {photos.length} foto(s) {photos.some((p) => p.process_status !== "done") ? "· processando algumas…" : ""}
            </div>
            <div className="flex items-center gap-2">
              {photos.some((p) => p.process_status === "error") && (
                <button
                  onClick={handleClearErrors} disabled={clearingErrors || uploadingLocal}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-200 text-xs font-semibold rounded-lg disabled:opacity-60"
                >
                  {clearingErrors ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Limpar com erro
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()} disabled={uploadingLocal}
                className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-60"
              >
                {uploadingLocal ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Enviar fotos
              </button>
              <input
                ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          </div>

          {/* Resolução do upload — menor = menos espaço de armazenamento */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
              Resolução do envio
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(Object.keys(RESOLUTIONS) as UploadResolution[]).map((r) => {
                const opt = RESOLUTIONS[r];
                const active = resolution === r;
                return (
                  <button
                    key={r}
                    onClick={() => changeResolution(r)}
                    disabled={uploadingLocal}
                    className={
                      "text-left p-2.5 rounded-lg border transition-colors " +
                      (active
                        ? "border-violet-600 bg-violet-50 dark:bg-violet-900/20 ring-1 ring-violet-600/40"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-400")
                    }
                  >
                    <div className="text-sm font-medium">{opt.label} <span className="text-xs text-gray-400">· {opt.maxDim}px</span></div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {progress && (uploadingLocal || progress.done < progress.total) && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Enviando e aplicando marca d'água…</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {photos.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-32 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors"
            >
              <Upload size={20} />
              <span className="text-sm">Clique pra enviar as fotos do ensaio</span>
            </button>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {photos.map((p) => (
                <ThumbFoto
                  key={p.id} photo={p}
                  selected={!!selectedByPhoto.get(p.id)?.selected}
                  onDelete={() => handleDeletePhoto(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {subAba === "selecionadas" && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
          {selectedPhotos.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              <Heart size={22} className="mx-auto mb-2 text-gray-300" />
              A cliente ainda não marcou nenhuma foto.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Escolhidas pela cliente ({selectedPhotos.length})</h3>
                <button
                  onClick={copyNames}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-xs font-semibold rounded-lg"
                >
                  <Copy size={12} /> Copiar nomes
                </button>
              </div>
              <div className={
                "text-xs font-medium " +
                ((gallery.pending_amount || 0) > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400")
              }>
                {(gallery.extra_count || 0) > 0
                  ? `${gallery.extra_count} extra(s) · ${
                      (gallery.pending_amount || 0) > 0
                        ? `${formatBRL(gallery.pending_amount)} pendente`
                        : `${formatBRL(gallery.paid_amount)} pago`
                    }`
                  : "Dentro do pacote — sem extras."}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {selectedPhotos.map((p) => (
                  <ThumbFoto
                    key={p.id} photo={p} selected
                    onDelete={() => handleDeletePhoto(p)}
                  />
                ))}
              </div>
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {selectedPhotos.filter((p) => selectedByPhoto.get(p.id)?.comment).map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-sm">
                    {p.thumb_url && <img src={p.thumb_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <span className="font-medium break-all">{p.file_name}</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                        "{selectedByPhoto.get(p.id)?.comment}"
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThumbFoto({ photo, selected, onDelete }: {
  photo: GalleryPhoto; selected: boolean; onDelete: () => void; key?: React.Key | null;
}) {
  const failed = photo.process_status === "error";
  const processing = !photo.thumb_url && !failed;
  return (
    <div className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700">
      {photo.thumb_url && (
        <img src={photo.thumb_url} alt={photo.file_name} loading="lazy" className="w-full h-full object-cover" />
      )}
      {processing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-gray-400" />
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-red-500 bg-red-50/80 dark:bg-red-900/30">
          <AlertCircle size={16} />
          <span className="text-[10px] font-medium">Erro</span>
        </div>
      )}
      {selected && (
        <span className="absolute top-1 left-1 rounded-full bg-emerald-500 text-white p-0.5 shadow">
          <Check size={11} />
        </span>
      )}
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 rounded-full bg-black/55 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remover foto"
      >
        <Trash2 size={11} />
      </button>
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
        <span className="text-[9px] text-white/90 truncate block">{photo.file_name}</span>
      </div>
    </div>
  );
}
