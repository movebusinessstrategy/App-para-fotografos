import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileDown, Image as ImageIcon, Loader2 } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import type { AlbumExport, AlbumSpread } from "../types";
import { exportAlbumPdf, exportFreeSpreadsAsJpg } from "./exportFreeCanvas";

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").toLowerCase() || "album";

// Baixa a "lista" (CSV) de GET /export.
async function downloadCsv(albumId: string, onErr: () => void) {
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
    a.download = `${slug(data.album_title || "album")}-lista.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    onErr();
  }
}

interface Props {
  albumId: string;
  title: string;
  size: string;
  spreads: AlbumSpread[];
  onNotify: (kind: "success" | "error", msg: string) => void;
}

// Menu "Exportar": lista CSV + JPGs das lâminas.
export function ExportarMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const exportJpg = async (bleed: boolean) => {
    setOpen(false);
    setExporting({ done: 0, total: p.spreads.length });
    try {
      await exportFreeSpreadsAsJpg(p.title, p.spreads, p.size, { bleed }, (done, total) => setExporting({ done, total }));
      p.onNotify("success", "Lâminas exportadas em JPG (300 DPI).");
    } catch {
      p.onNotify("error", "Não foi possível exportar as imagens.");
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async (bleed: boolean) => {
    setOpen(false);
    setExporting({ done: 0, total: p.spreads.length });
    try {
      await exportAlbumPdf(p.title, p.spreads, p.size, { bleed }, (done, total) => setExporting({ done, total }));
      p.onNotify("success", "PDF do álbum gerado (300 DPI).");
    } catch {
      p.onNotify("error", "Não foi possível gerar o PDF.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!!exporting}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {exporting ? `${exporting.done}/${exporting.total}` : "Exportar"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pra gráfica (300 DPI)</div>
          <MenuItem icon={<FileDown size={14} />} label="PDF com sangria" sub="recomendado pro laboratório" onClick={() => exportPdf(true)} />
          <MenuItem icon={<FileDown size={14} />} label="PDF sem sangria" onClick={() => exportPdf(false)} />
          <MenuItem icon={<ImageIcon size={14} />} label="JPGs com sangria" onClick={() => exportJpg(true)} />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Conferência</div>
          <MenuItem icon={<ImageIcon size={14} />} label="JPGs sem sangria" onClick={() => exportJpg(false)} />
          <MenuItem icon={<FileText size={14} />} label="Lista (CSV)" sub="qual foto em cada página" onClick={() => { setOpen(false); downloadCsv(p.albumId, () => p.onNotify("error", "Não foi possível baixar a lista.")); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <span className="mt-0.5">{icon}</span>
      <span>
        {label}
        {sub && <span className="block text-[10px] text-gray-400">{sub}</span>}
      </span>
    </button>
  );
}
