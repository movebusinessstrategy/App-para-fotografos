import React, { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity, ArrowLeft, CalendarClock, Copy, DollarSign, Droplet,
  History, Image as ImageIcon, Info, Loader2, Mail, MessageCircle, Palette,
  Send, ShieldCheck, Trash2,
} from "lucide-react";

import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { authFetch } from "../../utils/authFetch";
import { useApi } from "../../utils/useApi";
import { cn } from "../../utils/cn";
import { GalleryDetailResponse, SendResult } from "./types";
import { GALLERY_COLUMNS, publicGalleryLink } from "./utils";
import { Toast, ToastKind, ToastState } from "./Toast";
import { AcessoSection } from "./AcessoSection";

import { DadosSection } from "./secoes/DadosSection";
import { FotosSection } from "./secoes/FotosSection";
import { VendaSection } from "./secoes/VendaSection";
import { PrazoSection } from "./secoes/PrazoSection";
import { MarcaDaguaSection } from "./secoes/MarcaDaguaSection";
import { DesignSection } from "./secoes/DesignSection";
import { AtividadesSection, HistoricoSection } from "./secoes/AtividadesESHistoricoSections";

// ── Abas no topo (estilo CatalogoPage) ───────────────────────────────────────

type SecaoId =
  | "fotos" | "atividades" | "historico" | "dados" | "venda"
  | "prazo" | "acesso" | "marca" | "design";

interface AbaItem {
  id: SecaoId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const ABAS: AbaItem[] = [
  { id: "fotos",      label: "Fotos",          icon: ImageIcon },
  { id: "atividades", label: "Atividades",     icon: Activity },
  { id: "historico",  label: "Histórico",      icon: History },
  { id: "dados",      label: "Dados",          icon: Info },
  { id: "venda",      label: "Seleção e venda", icon: DollarSign },
  { id: "prazo",      label: "Prazo",          icon: CalendarClock },
  { id: "acesso",     label: "Acesso",         icon: ShieldCheck },
  { id: "marca",      label: "Marca d'água",   icon: Droplet },
  { id: "design",     label: "Design",         icon: Palette },
];

// ── Página principal ────────────────────────────────────────────────────────

export default function GaleriaDetailPage() {
  const { id: galleryId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const onNotify = (kind: ToastKind, msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ kind, message: msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const [secao, setSecao] = useState<SecaoId>("fotos");
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const { data, mutate } = useApi<GalleryDetailResponse>(
    galleryId ? `/api/galleries/${galleryId}` : null,
    uploading ? { refreshInterval: 3000, dedupingInterval: 2000 } : undefined,
  );
  const gallery = data?.gallery;

  const refresh = () => mutate();

  // Volta pro Kanban quando a galeria some / é excluída.
  const goBack = () => navigate("/galeria");

  const handleSend = async () => {
    if (!galleryId) return;
    setSending(true);
    try {
      const res = await authFetch(`/api/galleries/${galleryId}/send`, { method: "POST" });
      if (!res.ok) throw new Error();
      const result: SendResult = await res.json();
      setSendResult(result);
      onNotify("success", "Galeria enviada pra cliente.");
      mutate();
    } catch {
      onNotify("error", "Não foi possível enviar.");
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = async () => {
    if (!gallery) return;
    try {
      await navigator.clipboard.writeText(publicGalleryLink(gallery.share_token));
      onNotify("success", "Link copiado.");
    } catch {
      onNotify("error", "Não foi possível copiar.");
    }
  };

  const handleDelete = async () => {
    if (!galleryId) return;
    const res = await authFetch(`/api/galleries/${galleryId}`, { method: "DELETE" });
    if (!res.ok) { onNotify("error", "Erro ao excluir."); return; }
    onNotify("success", "Galeria excluída.");
    goBack();
  };

  const statusLabel = useMemo(
    () => GALLERY_COLUMNS.find((c) => c.id === gallery?.status)?.label || "",
    [gallery?.status],
  );

  if (!galleryId) {
    return <div className="p-8 text-center text-gray-500">Galeria não encontrada.</div>;
  }
  if (!gallery || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-full">
      {/* Topo: voltar / título / status / ações principais */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={goBack}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">{gallery.title}</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {gallery.client_name || "Sem cliente"}
                {gallery.category ? ` · ${gallery.category}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {statusLabel && (
              <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                {statusLabel}
              </span>
            )}
            <button
              onClick={handleSend} disabled={sending || data.photos.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {gallery.status === "draft" ? "Enviar pra cliente" : "Reenviar"}
            </button>
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-xs font-semibold rounded-lg"
            >
              <Copy size={13} /> Copiar link
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              aria-label="Excluir"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {sendResult && (
          <div className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 flex items-center gap-4 text-xs text-emerald-800 dark:text-emerald-200">
            <input
              readOnly value={sendResult.link}
              className="flex-1 bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-lg px-2 py-1.5"
              onFocus={(e) => e.target.select()}
            />
            <span className="inline-flex items-center gap-1"><Mail size={12} /> {sendResult.email_sent ? "E-mail ✓" : "E-mail —"}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle size={12} /> {sendResult.whatsapp_sent ? "WhatsApp ✓" : "WhatsApp —"}</span>
          </div>
        )}
      </div>

      {/* Abas no topo (estilo CatalogoPage) — pill bar com scroll horizontal em telas pequenas */}
      <div className="px-3 sm:px-5 pt-4 max-w-[1400px] mx-auto">
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl gap-1 overflow-x-auto">
          {ABAS.map((a) => {
            const Icon = a.icon;
            const ativo = secao === a.id;
            return (
              <button
                key={a.id} onClick={() => setSecao(a.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0",
                  ativo
                    ? "bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200",
                )}
              >
                <Icon size={15} /> {a.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="px-3 sm:px-5 py-5 max-w-[1400px] mx-auto">
        {secao === "atividades" && <AtividadesSection galleryId={galleryId} />}
        {secao === "historico"  && <HistoricoSection  galleryId={galleryId} />}
        {secao === "dados"      && <DadosSection      gallery={gallery} onChanged={refresh} onNotify={onNotify} />}
        {secao === "fotos"      && (
          <FotosSection
            galleryId={galleryId}
            data={data}
            mutate={refresh}
            onChanged={refresh}
            onNotify={onNotify}
            setUploading={setUploading}
          />
        )}
        {secao === "venda"      && <VendaSection      gallery={gallery} onChanged={refresh} onNotify={onNotify} />}
        {secao === "prazo"      && <PrazoSection      gallery={gallery} onChanged={refresh} onNotify={onNotify} />}
        {secao === "acesso"     && (
          <AcessoSection
            galleryId={galleryId}
            initialRequireLogin={!!gallery.require_login}
            initialDownloadMode={gallery.download_mode || "off"}
            onNotify={onNotify}
          />
        )}
        {secao === "marca"      && <MarcaDaguaSection onNotify={onNotify} />}
        {secao === "design"     && <DesignSection     gallery={gallery as any} onChanged={refresh} onNotify={onNotify} />}
      </main>

      <ConfirmModal
        open={confirmDelete}
        title="Excluir galeria"
        message={`Excluir a galeria "${gallery.title}"? As fotos enviadas também serão removidas. Esta ação não pode ser desfeita.`}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

