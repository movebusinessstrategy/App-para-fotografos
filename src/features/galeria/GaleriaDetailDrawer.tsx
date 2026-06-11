import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, Copy, Loader2, Mail, MessageCircle, Send, Trash2, Upload, X,
} from "lucide-react";

import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { cn } from "../../utils/cn";
import { GalleryDetailResponse, GalleryPhoto, SendResult } from "./types";
import { GALLERY_COLUMNS, formatBRL, formatDateBR, publicGalleryLink } from "./utils";
import { ToastKind } from "./Toast";

interface GaleriaDetailDrawerProps {
  galleryId: string;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (kind: ToastKind, message: string) => void;
}

interface UploadProgress { done: number; total: number; errors: string[] }

// Executa tarefas async com concorrência limitada (~3 uploads em paralelo).
async function runPool(limit: number, tasks: (() => Promise<void>)[]) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function GaleriaDetailDrawer({ galleryId, onClose, onChanged, onNotify }: GaleriaDetailDrawerProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Polling só enquanto há upload/processamento em andamento.
  const { data, mutate } = useApi<GalleryDetailResponse>(
    `/api/galleries/${galleryId}`,
    uploading ? { refreshInterval: 3000, dedupingInterval: 2000 } : undefined,
  );
  const gallery = data?.gallery;
  const photos = useMemo(() => data?.photos ?? [], [data]);
  const selections = useMemo(() => data?.selections ?? [], [data]);

  const selectedByPhoto = useMemo(() => {
    const map = new Map<string, { selected: boolean; comment: string | null }>();
    selections.forEach((s) => map.set(s.photo_id, { selected: s.selected, comment: s.client_comment }));
    return map;
  }, [selections]);

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedByPhoto.get(p.id)?.selected),
    [photos, selectedByPhoto],
  );

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("success", `${label} copiado!`);
    } catch {
      onNotify("error", "Não foi possível copiar.");
    }
  };

  // ── Upload em massa: sign-upload em lotes → PUT direto na signed_url → process ──
  const uploadOne = async (upload: { photo_id: string; signed_url: string }, file: File, errors: string[]) => {
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
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setUploading(true);
    const errors: string[] = [];
    setProgress({ done: 0, total: files.length, errors });

    try {
      for (const batch of chunk(files, 20)) {
        const res = await authFetch(`/api/galleries/${galleryId}/photos/sign-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: batch.map((f) => ({ name: f.name, size: f.size, type: f.type })) }),
        });
        if (!res.ok) {
          batch.forEach((f) => errors.push(f.name));
          setProgress((p) => (p ? { ...p, done: p.done + batch.length } : p));
          continue;
        }
        const { uploads } = await res.json();
        await runPool(3, batch.map((file, i) => () => uploadOne(uploads[i], file, errors)));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      mutate();
      onChanged();
    }
    if (errors.length > 0) onNotify("error", `${errors.length} foto(s) falharam no envio.`);
    else onNotify("success", `${files.length} foto(s) enviadas e processadas.`);
  };

  const handleDeletePhoto = async (photo: GalleryPhoto) => {
    const res = await authFetch(`/api/galleries/${galleryId}/photos/${photo.id}`, { method: "DELETE" });
    if (!res.ok) {
      onNotify("error", "Erro ao remover a foto.");
      return;
    }
    mutate();
    onChanged();
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/send`, { method: "POST" });
      if (!res.ok) throw new Error();
      const result: SendResult = await res.json();
      setSendResult(result);
      mutate();
      onChanged();
    } catch {
      onNotify("error", "Não foi possível enviar a galeria.");
    } finally {
      setSending(false);
    }
  };

  const handleDeadlineChange = async (value: string) => {
    const res = await authFetch(`/api/galleries/${galleryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection_deadline: value || null }),
    });
    if (res.ok) { mutate(); onChanged(); }
  };

  const handleDeleteGallery = async () => {
    const res = await authFetch(`/api/galleries/${galleryId}`, { method: "DELETE" });
    if (!res.ok) {
      onNotify("error", "Erro ao excluir a galeria.");
      return;
    }
    onNotify("success", "Galeria excluída.");
    onChanged();
    onClose();
  };

  const statusLabel = GALLERY_COLUMNS.find((c) => c.id === gallery?.status)?.label || "";
  const link = gallery ? publicGalleryLink(gallery.share_token) : "";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
              {gallery?.title || "Galeria"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {gallery?.client_name || "Sem cliente"}
              {gallery?.category ? ` · ${gallery.category}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {statusLabel && (
              <span className="inline-flex items-center rounded-full bg-gold-50 dark:bg-gold-500/15 px-3 py-1 text-xs font-semibold text-gold-700 dark:text-gold-300 mr-1">
                {statusLabel}
              </span>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              title="Excluir galeria"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {!gallery ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Resumo + ações */}
            <section className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600 dark:text-gray-300">
              <span><strong>{photos.length}</strong> fotos</span>
              <span><strong>{gallery.included_count}</strong> incluídas</span>
              <span>Extra: <strong>{formatBRL(gallery.extra_price)}</strong></span>
              {gallery.status !== "draft" && <span>Aberta <strong>{gallery.view_count || 0}x</strong></span>}
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                Prazo de seleção
                <input
                  type="date"
                  defaultValue={(gallery.selection_deadline || "").slice(0, 10)}
                  onChange={(e) => handleDeadlineChange(e.target.value)}
                  className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-gray-200 outline-none"
                />
              </label>
            </section>

            {/* Enviar / link */}
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSend}
                  disabled={sending || photos.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {gallery.status === "draft" ? "Enviar para cliente" : "Reenviar para cliente"}
                </button>
                <button
                  onClick={() => copy(link, "Link")}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors"
                >
                  <Copy size={14} />
                  Copiar link
                </button>
                {gallery.sent_at && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Enviada em {formatDateBR(gallery.sent_at)}
                  </span>
                )}
              </div>

              {sendResult && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <input
                      readOnly
                      value={sendResult.link}
                      className="flex-1 bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={() => copy(sendResult.link, "Link")}
                      className="p-1.5 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-200">
                    <span className="inline-flex items-center gap-1">
                      <Mail size={12} /> {sendResult.email_sent ? "E-mail enviado" : "E-mail não enviado"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle size={12} /> {sendResult.whatsapp_sent ? "WhatsApp enviado" : "WhatsApp não enviado"}
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Upload */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Fotos
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-xl transition-colors disabled:opacity-60"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Enviar fotos
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {progress && (uploading || progress.done < progress.total) && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>Enviando e aplicando marca d'água...</span>
                    <span>{progress.done}/{progress.total}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full bg-gold-500 transition-all"
                      style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {photos.length === 0 ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-32 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-gold-400 hover:text-gold-500 transition-colors"
                >
                  <Upload size={20} />
                  <span className="text-sm">Clique para enviar as fotos do ensaio</span>
                </button>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {photos.map((photo) => (
                    <PhotoThumb
                      key={photo.id}
                      photo={photo}
                      selected={!!selectedByPhoto.get(photo.id)?.selected}
                      onDelete={() => handleDeletePhoto(photo)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Seleção da cliente */}
            {selectedPhotos.length > 0 && (
              <SelectionList
                photos={selectedPhotos}
                comments={selectedByPhoto}
                extraCount={gallery.extra_count}
                pendingAmount={gallery.pending_amount}
                paidAmount={gallery.paid_amount}
                onCopyNames={() => copy(selectedPhotos.map((p) => p.file_name).join("\n"), "Nomes dos arquivos")}
              />
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Excluir galeria"
        message={`Excluir a galeria "${gallery?.title || ""}"? As fotos enviadas também serão removidas. Esta ação não pode ser desfeita.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => { setConfirmDelete(false); handleDeleteGallery(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ─── Thumb de foto com status de processamento ───────────────────────────────

// key tipado pro typecheck aceitar <PhotoThumb key={} ...> (padrão do projeto).
function PhotoThumb({ photo, selected, onDelete }: { photo: GalleryPhoto; selected: boolean; onDelete: () => void; key?: React.Key | null }) {
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

// ─── Lista de fotos escolhidas + comentários da cliente ──────────────────────

interface SelectionListProps {
  photos: GalleryPhoto[];
  comments: Map<string, { selected: boolean; comment: string | null }>;
  extraCount: number;
  pendingAmount: number;
  paidAmount: number;
  onCopyNames: () => void;
}

function SelectionList({ photos, comments, extraCount, pendingAmount, paidAmount, onCopyNames }: SelectionListProps) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Selecionadas pela cliente ({photos.length})
        </h3>
        <button
          onClick={onCopyNames}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-lg transition-colors"
        >
          <Copy size={12} />
          Copiar nomes
        </button>
      </div>

      <div className={cn(
        "mb-3 text-xs font-medium",
        pendingAmount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
      )}>
        {extraCount > 0
          ? `${extraCount} extra(s) · ${pendingAmount > 0 ? `${formatBRL(pendingAmount)} pendente` : `${formatBRL(paidAmount)} pago`}`
          : "Dentro das fotos incluídas — sem extras"}
      </div>

      <ul className="space-y-1.5 max-h-56 overflow-y-auto">
        {photos.map((p) => {
          const comment = comments.get(p.id)?.comment;
          return (
            <li key={p.id} className="flex items-start gap-2 text-sm">
              {p.thumb_url && <img src={p.thumb_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />}
              <div className="min-w-0">
                <span className="text-gray-800 dark:text-gray-200 font-medium break-all">{p.file_name}</span>
                {comment && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic">"{comment}"</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
