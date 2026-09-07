import React, { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Images, Maximize2, RefreshCw, X } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { cn } from "../../utils/cn";

interface DossierMedia {
  id: string;
  kind: "reference" | "payment";
  data_url: string;
}

function contentList(content: any, key: string): string[] {
  return Array.isArray(content?.[key]) ? content[key].map(String).filter(Boolean) : [];
}

function DossierList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{title}</p>
      <ul className="space-y-1">
        {items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300"><span className="text-gold-500">•</span><span>{item}</span></li>)}
      </ul>
    </div>
  );
}

function DossierMediaGrid({ title, items, onOpen }: { title: string; items: DossierMedia[]; onOpen: (item: DossierMedia) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <button key={`${item.kind}-${item.id}`} onClick={() => onOpen(item)} className="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800" aria-label={`Ampliar ${title.toLowerCase()}`}>
            <img src={item.data_url} alt="" className="h-24 w-full object-cover transition-transform group-hover:scale-[1.03]" />
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 p-1 text-white"><Maximize2 size={11} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DossierSection({ jobId }: { jobId: number }) {
  const [dossier, setDossier] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<DossierMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<DossierMedia | null>(null);

  useEffect(() => {
    let active = true;
    setDossier(null);
    setExpanded(false);
    setMedia([]);
    authFetch(`/api/jobs/${jobId}/dossie`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setDossier(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [jobId]);

  useEffect(() => {
    if (!expanded || dossier?.status !== "ready" || media.length) return;
    let active = true;
    setMediaLoading(true);
    authFetch(`/api/jobs/${jobId}/dossie/media`)
      .then((response) => response.ok ? response.json() : [])
      .then((data) => { if (active) setMedia(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => { if (active) setMediaLoading(false); });
    return () => { active = false; };
  }, [expanded, dossier?.status, jobId, media.length]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const response = await authFetch(`/api/jobs/${jobId}/dossie/regenerate`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível gerar o dossiê.");
      setDossier(result);
      setMedia([]);
      setExpanded(true);
    } catch (error: any) {
      alert(error?.message || "Não foi possível gerar o dossiê.");
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async () => {
    setBusy(true);
    try {
      const response = await authFetch(`/api/jobs/${jobId}/dossie/pdf?include_images=${includeImages ? "1" : "0"}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Dossiê ainda não gerado.");
      }
      window.open(URL.createObjectURL(await response.blob()), "_blank");
    } catch (error: any) {
      alert(error?.message || "Não foi possível abrir o PDF.");
    } finally {
      setBusy(false);
    }
  };

  const content = dossier?.content || {};
  const links = contentList(content, "links_importantes");
  const referenceCount = contentList(content, "reference_photo_ids").length;
  const paymentCount = contentList(content, "payment_photo_ids").length;
  const ready = dossier?.status === "ready";

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Dossiê de alinhamento</h3>
      <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {ready
            ? `Completo com os combinados da conversa${referenceCount + paymentCount ? `, ${referenceCount} referência(s) e ${paymentCount} comprovante(s)` : ""}${links.length ? `, além de ${links.length} link(s)` : ""}.`
            : dossier?.status === "error"
              ? `Não foi possível gerar: ${dossier.error || "erro desconhecido"}`
              : dossier?.status === "generating" ? "Gerando o dossiê…" : "Ainda não gerado — a IA reúne conversa, imagens, links e pagamentos."}
        </p>

        {ready && (
          <button onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
            <span className="flex items-center gap-1.5"><Images size={13} /> {expanded ? "Ocultar conteúdo" : "Ver conteúdo e imagens"}</span>
            <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        {expanded && ready && (
          <div className="space-y-4 border-t border-gray-100 pt-3 dark:border-gray-800">
            {content.resumo && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700 dark:bg-gray-800 dark:text-gray-200">{content.resumo}</p>}
            <DossierList title="O que a cliente quer" items={contentList(content, "o_que_quer")} />
            <DossierList title="Falas de referência" items={contentList(content, "falas_referencia")} />
            <DossierList title="Preferências" items={contentList(content, "preferencias")} />
            <DossierList title="Combinados" items={contentList(content, "combinados")} />
            <DossierList title="Pagamentos" items={contentList(content, "pagamentos")} />
            <DossierList title="Cuidados" items={contentList(content, "evitar")} />
            {links.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Links importantes</p>
                <div className="space-y-1">
                  {links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 break-all text-xs text-blue-600 hover:underline dark:text-blue-300"><ExternalLink size={11} className="flex-shrink-0" />{link}</a>)}
                </div>
              </div>
            )}
            {mediaLoading ? <p className="text-xs text-gray-400">Carregando imagens…</p> : (
              <>
                <DossierMediaGrid title="Referências da cliente" items={media.filter((item) => item.kind === "reference")} onOpen={setSelectedMedia} />
                <DossierMediaGrid title="Comprovantes de pagamento" items={media.filter((item) => item.kind === "payment")} onOpen={setSelectedMedia} />
              </>
            )}
          </div>
        )}

        {ready && (
          <label className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-gold-600 focus:ring-gold-500" />
            Incluir referências e comprovantes no PDF
          </label>
        )}

        <div className="flex gap-2">
          {ready && <button onClick={openPdf} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-60 dark:text-emerald-300"><FileText size={13} /> Abrir PDF</button>}
          <button onClick={regenerate} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {ready ? "Atualizar dossiê" : "Gerar dossiê"}</button>
        </div>
      </div>

      {selectedMedia && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedMedia(null)}>
          <button onClick={() => setSelectedMedia(null)} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Fechar imagem"><X size={20} /></button>
          <img src={selectedMedia.data_url} alt={selectedMedia.kind === "payment" ? "Comprovante de pagamento" : "Referência da cliente"} className="max-h-[90vh] max-w-[94vw] object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </section>
  );
}
