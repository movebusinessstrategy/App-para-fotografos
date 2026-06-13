import React, { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  ArrowLeft, Check, Download, Loader2, Send, Sparkles, FileText,
} from "lucide-react";

import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";
import { ALBUM_SIZES } from "./templates";
import type { AlbumExport, AlbumSpread } from "./types";
import { Bandeja } from "./components/Bandeja";
import { Paleta } from "./components/Paleta";
import { Tira } from "./components/Tira";
import { EditableSpread } from "./components/EditableSpread";
import { EnviarAlbumModal } from "./components/EnviarAlbumModal";
import { useAlbumEditor, SaveState } from "./components/useAlbumEditor";
import { exportSpreadsAsJpg } from "./components/exportCanvas";
import { Toast, ToastKind, ToastState } from "../galeria/Toast";

// Indicador de autosave no topo.
function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> salvando…</span>;
  }
  if (state === "saved") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500"><Check size={12} /> salvo</span>;
  }
  if (state === "error") {
    return <span className="text-xs text-red-500">erro ao salvar</span>;
  }
  return null;
}

// Baixa a "lista" (CSV) de GET /export — qual foto em cada lâmina.
async function downloadExportCsv(albumId: string, onNotify: (k: ToastKind, m: string) => void) {
  try {
    const res = await authFetch(`/api/albums/${albumId}/export`);
    if (!res.ok) throw new Error();
    const data = (await res.json()) as AlbumExport;
    const rows = [["Lâmina", "Template", "Fotos"]];
    data.pages.forEach((p) => rows.push([String(p.spread), p.template, p.photos.join(" | ")]));
    const csv = rows.map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data.album_title || "album").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-lista.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    onNotify("error", "Não foi possível baixar a lista.");
  }
}

export default function AlbumEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const editor = useAlbumEditor(id);
  const { detail, spreads, loadError, saveState } = editor;

  const [current, setCurrent] = useState(0);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = (kind: ToastKind, message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const assets = detail?.assets || [];
  const album = detail?.album;
  const curIndex = Math.min(current, Math.max(0, spreads.length - 1));
  const curSpread: AlbumSpread | undefined = spreads[curIndex];

  // ids de assets usados em qualquer lâmina (pra marcar na bandeja).
  const usedAssetIds = useMemo(() => {
    const set = new Set<string>();
    spreads.forEach((s) => s.slots.forEach((sl) => sl.asset_id && set.add(sl.asset_id)));
    return set;
  }, [spreads]);

  const activeAsset = activeAssetId ? assets.find((a) => a.id === activeAssetId) : null;

  // Drag: foto da bandeja → slot, ou slot → slot (troca).
  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { type?: string; assetId?: string } | undefined;
    if (data?.type === "asset" && data.assetId) setActiveAssetId(data.assetId);
  };

  const parseSlotId = (id: string): number | null => {
    if (!id.startsWith("slot:")) return null;
    const n = parseInt(id.slice(5), 10);
    return Number.isNaN(n) ? null : n;
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveAssetId(null);
    const { active, over } = e;
    if (!over || !curSpread) return;
    const targetSlot = parseSlotId(String(over.id));
    if (targetSlot == null) return;

    const aData = active.data.current as { type?: string; assetId?: string; index?: number } | undefined;
    if (aData?.type === "asset" && aData.assetId) {
      editor.setSlotAsset(curIndex, targetSlot, aData.assetId);
    }
  };

  const sizeRatioInfo = ALBUM_SIZES.find((s) => s.id === (album?.size || "sq30"));

  const handleExportJpg = async () => {
    if (!album) return;
    setExporting({ done: 0, total: spreads.length });
    try {
      await exportSpreadsAsJpg(album.title, spreads, assets, album.size, (done, total) => setExporting({ done, total }));
      notify("success", "Lâminas exportadas em JPG.");
    } catch {
      notify("error", "Não foi possível exportar as imagens.");
    } finally {
      setExporting(null);
    }
  };

  const handleSizeChange = async (size: string) => {
    if (!album) return;
    try {
      await authFetch(`/api/albums/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size }),
      });
      editor.load();
    } catch {
      notify("error", "Não foi possível mudar o tamanho.");
    }
  };

  if (loadError) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Não foi possível abrir o álbum.</p>
        <button onClick={() => navigate("/album")} className="mt-3 text-sm text-violet-600 hover:underline">Voltar pros álbuns</button>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="p-16 flex items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-[calc(100vh-7rem)] -m-2 sm:-m-0">
        {/* Topo */}
        <div className="flex items-center gap-2 flex-wrap px-2 py-2 border-b border-gray-200 dark:border-gray-800">
          <button onClick={() => navigate("/album")} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 dark:text-white truncate">{album.title}</h1>
            {album.client_name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{album.client_name}</p>}
          </div>
          <div className="ml-2"><SaveBadge state={saveState} /></div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <select
              value={album.size}
              onChange={(e) => handleSizeChange(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200 outline-none"
              title="Tamanho do álbum"
            >
              {ALBUM_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button
              onClick={() => editor.autoFill(assets)}
              disabled={assets.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <Sparkles size={13} /> Auto-preencher
            </button>
            <button
              onClick={() => downloadExportCsv(id, notify)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Baixar a lista (CSV)"
            >
              <FileText size={13} /> Lista
            </button>
            <button
              onClick={handleExportJpg}
              disabled={!!exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {exporting ? `${exporting.done}/${exporting.total}` : "Exportar JPG"}
            </button>
            <button
              onClick={() => setShowSend(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Send size={13} /> Enviar pra cliente
            </button>
          </div>
        </div>

        {/* Corpo: 3 colunas */}
        <div className="flex-1 flex min-h-0">
          {/* Bandeja esquerda */}
          <aside className="w-48 sm:w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden md:flex flex-col">
            <Bandeja
              albumId={id}
              assets={assets}
              usedAssetIds={usedAssetIds}
              onChanged={editor.reloadAssets}
              onNotify={notify}
            />
          </aside>

          {/* Lâmina central */}
          <main className="flex-1 min-w-0 overflow-auto bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4 sm:p-8">
            {curSpread ? (
              <div className="w-full max-w-4xl">
                <div className="text-center text-xs text-gray-400 dark:text-gray-500 mb-2">
                  Lâmina {curIndex + 1} de {spreads.length} · {sizeRatioInfo?.label}
                </div>
                <EditableSpread
                  spread={curSpread}
                  assets={assets}
                  size={album.size}
                  onClearSlot={(slotIndex) => editor.setSlotAsset(curIndex, slotIndex, null)}
                />
              </div>
            ) : (
              <div className="text-center text-sm text-gray-400">
                Sem lâminas. Adicione uma na tira abaixo.
              </div>
            )}
          </main>

          {/* Paleta direita */}
          <aside className="w-44 sm:w-52 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden lg:flex flex-col">
            {curSpread && (
              <Paleta
                currentTemplateId={curSpread.template_id}
                onApply={(tid) => editor.setTemplate(curIndex, tid)}
              />
            )}
          </aside>
        </div>

        {/* Tira inferior */}
        <Tira
          spreads={spreads}
          assets={assets}
          size={album.size}
          currentIndex={curIndex}
          onSelect={setCurrent}
          onAdd={editor.addSpread}
          onDelete={(i) => { editor.deleteSpread(i); setCurrent((c) => Math.max(0, c - (i <= c ? 1 : 0))); }}
          onReorder={editor.reorderSpreads}
        />
      </div>

      {/* Foto fantasma seguindo o cursor */}
      <DragOverlay>
        {activeAsset && (activeAsset.thumb_url || activeAsset.preview_url) && (
          <img
            src={activeAsset.thumb_url || activeAsset.preview_url || ""}
            alt=""
            className="w-24 h-24 object-cover rounded-lg shadow-xl ring-2 ring-violet-400 opacity-90"
          />
        )}
      </DragOverlay>

      {showSend && (
        <EnviarAlbumModal
          album={album}
          onClose={() => setShowSend(false)}
          onSent={() => { editor.load(); }}
          onNotify={notify}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </DndContext>
  );
}
