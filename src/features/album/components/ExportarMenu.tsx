import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Check, Download, ExternalLink, FileDown, FileText, Image as ImageIcon, Loader2 } from "lucide-react";

import { authFetch } from "../../../utils/authFetch";
import type { AlbumExport, AlbumSpread } from "../types";
import { GRAFICAS, graficaById, type Grafica } from "../graficas";
import { exportAlbumPdf, exportFreeSpreadsAsJpg } from "./exportFreeCanvas";

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").toLowerCase() || "album";

// Páginas aproximadas (lâmina dupla = 2 págs; capa/contracapa = 1).
function paginasAprox(spreads: AlbumSpread[]): number {
  return spreads.reduce((n, s) => n + (s.kind === "spread" ? 2 : 1), 0);
}

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

// Menu "Exportar pra gráfica": escolhe a gráfica → ajusta formato/sangria/cor →
// baixa no padrão dela (+ links do gabarito/portal). Mantém export genérico e CSV.
export function ExportarMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [graficaId, setGraficaId] = useState<string>(() => {
    try { return localStorage.getItem(`album_grafica:${p.albumId}`) || "generico"; } catch { return "generico"; }
  });
  const g = graficaById(graficaId);
  const setGrafica = (id: string) => {
    setGraficaId(id);
    try { localStorage.setItem(`album_grafica:${p.albumId}`, id); } catch { /* ignora */ }
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const runExport = async (fn: () => Promise<void>, okMsg: string) => {
    setOpen(false);
    setExporting({ done: 0, total: p.spreads.length });
    try {
      await fn();
      p.onNotify("success", okMsg);
    } catch {
      p.onNotify("error", "Não foi possível exportar.");
    } finally {
      setExporting(null);
    }
  };

  const exportarPreset = (grafica: Grafica) => {
    const opts = { bleedCm: grafica.bleedCm, jpegQuality: grafica.jpegQuality };
    const prog = (done: number, total: number) => setExporting({ done, total });
    return runExport(async () => {
      if (grafica.formato === "pdf" || grafica.formato === "both") {
        await exportAlbumPdf(p.title, p.spreads, p.size, opts, prog);
      }
      if (grafica.formato === "jpg" || grafica.formato === "both") {
        await exportFreeSpreadsAsJpg(p.title, p.spreads, p.size, opts, prog);
      }
    }, `Arquivos pra ${grafica.nome} gerados (300 DPI).`);
  };

  const exportJpg = (bleed: boolean) =>
    runExport(() => exportFreeSpreadsAsJpg(p.title, p.spreads, p.size, { bleed }, (d, t) => setExporting({ done: d, total: t })), "Lâminas exportadas em JPG (300 DPI).");
  const exportPdf = (bleed: boolean) =>
    runExport(() => exportAlbumPdf(p.title, p.spreads, p.size, { bleed }, (d, t) => setExporting({ done: d, total: t })), "PDF do álbum gerado (300 DPI).");

  const pags = paginasAprox(p.spreads);
  const faltaPaginas = g.minPaginas != null && pags < g.minPaginas;
  const formatoLabel = g.formato === "pdf" ? "PDF" : g.formato === "jpg" ? "JPGs por lâmina" : "PDF + JPGs";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!!exporting}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {exporting ? `${exporting.done}/${exporting.total}` : "Pra gráfica"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-[80vh] w-80 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
          {/* 1) Escolha da gráfica */}
          <div className="px-3 pt-3 pb-2">
            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <Building2 size={12} /> Gráfica / laboratório
            </label>
            <select
              value={graficaId}
              onChange={(e) => setGrafica(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2 text-sm text-gray-800 dark:text-gray-100 focus:border-violet-500 focus:outline-none"
            >
              {GRAFICAS.map((op) => (
                <option key={op.id} value={op.id}>{op.nome}</option>
              ))}
            </select>

            {/* Card de specs da gráfica */}
            <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-2.5 text-[11px] text-gray-600 dark:text-gray-300">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span><b className="font-semibold text-gray-700 dark:text-gray-200">Envio:</b> {formatoLabel}</span>
                <span><b className="font-semibold text-gray-700 dark:text-gray-200">Cor:</b> {g.cor}</span>
                <span><b className="font-semibold text-gray-700 dark:text-gray-200">Sangria:</b> {g.bleedCm} cm</span>
              </div>
              <p className="mt-1.5 text-gray-500 dark:text-gray-400">{g.envio}</p>
              {g.obs && <p className="mt-1 italic text-gray-400">{g.obs}</p>}
              {faltaPaginas && (
                <p className="mt-1.5 flex items-start gap-1 rounded bg-amber-50 dark:bg-amber-900/20 px-1.5 py-1 text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  Esta gráfica pede no mínimo {g.minPaginas} páginas; seu álbum tem ~{pags}.
                </p>
              )}
              {(g.gabaritoUrl || g.portalUrl) && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {g.gabaritoUrl && (
                    <a href={g.gabaritoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline">
                      <ExternalLink size={11} /> Gabarito oficial
                    </a>
                  )}
                  {g.portalUrl && (
                    <a href={g.portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline">
                      <ExternalLink size={11} /> Portal de envio
                    </a>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => exportarPreset(g)}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-xs font-semibold text-white"
            >
              <Check size={13} /> Baixar no padrão {g.id === "generico" ? "padrão" : g.nome.split(" ")[0]}
            </button>
            <p className="mt-1 text-center text-[10px] text-gray-400">300 DPI · sangria {g.bleedCm} cm · {g.cor}</p>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800" />

          {/* 2) Outros formatos / conferência */}
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Outros formatos</div>
          <MenuItem icon={<FileDown size={14} />} label="PDF com sangria" onClick={() => exportPdf(true)} />
          <MenuItem icon={<FileDown size={14} />} label="PDF sem sangria" onClick={() => exportPdf(false)} />
          <MenuItem icon={<ImageIcon size={14} />} label="JPGs sem sangria" sub="conferência" onClick={() => exportJpg(false)} />
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
