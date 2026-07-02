import React, { Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";

import { PanelLeftOpen } from "lucide-react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import ContactOpportunityModal from "../shared/ContactOpportunityModal";
import ImpersonationBanner from "../ImpersonationBanner";
import TrialBanner from "../TrialBanner";
import BillingGate from "../BillingGate";
import { useAuth } from "../../contexts/AuthContext";
import { authFetch } from "../../utils/authFetch";
import { Client, Opportunity } from "../../types";

// Render free tier dorme após 15min sem requests; o primeiro hit depois
// disso leva 30s+ pra acordar. Esse ping a cada 12min mantém quente
// enquanto o usuário tem a aba aberta. Faz GET /api/health, leve.
function useKeepAlive() {
  useEffect(() => {
    const ping = () => {
      // fetch direto sem authFetch pra não envolver supabase auth no caminho
      const base = (import.meta.env.VITE_API_BASE_URL as string) || '';
      fetch(`${base}/api/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
    };
    ping(); // primeiro ping ao montar
    const id = window.setInterval(ping, 12 * 60 * 1000); // 12min
    return () => clearInterval(id);
  }, []);
}

export type ContactModalPayload = {
  opportunity: Opportunity;
  client: Client | null;
  onUpdate?: () => void;
  onDiscardSuccess?: (oppId: number) => void;
};

export type LayoutOutletContext = {
  openContactModal: (payload: ContactModalPayload) => void;
};

const TITLE_MAP: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clientes",
  "/jobs": "Jobs",
  "/pipeline": "Funil de Vendas",
  "/vendas": "Vendas",
  "/whatsapp": "WhatsApp",
  "/calendar": "Agenda",
  "/settings": "Configurações",
  "/finance": "Financeiro",
  "/pipeline-settings": "Configurar Funil",
  "/oportunidades": "Oportunidades",
};

export default function AppLayout() {
  const { user, signOut, isProductionOnly } = useAuth();
  const location = useLocation();
  const [contactModal, setContactModal] = useState<ContactModalPayload | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Recolher o menu no desktop → mais espaço (essencial pro chat em tela cheia).
  // Persistido por navegador. Mobile continua usando o drawer (sidebarOpen).
  const [deskCollapsed, setDeskCollapsed] = useState(() => {
    try { return localStorage.getItem('fp_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleDeskCollapsed = () => setDeskCollapsed((v) => {
    const nv = !v;
    try { localStorage.setItem('fp_sidebar_collapsed', nv ? '1' : '0'); } catch {}
    return nv;
  });

  // Mantém o backend acordado (Render free tier dorme após 15min)
  useKeepAlive();

  const pageTitle = useMemo(() => {
    return TITLE_MAP[location.pathname] || "Dashboard";
  }, [location.pathname]);

  const openContactModal = (payload: ContactModalPayload) => setContactModal(payload);
  const closeContactModal = () => setContactModal(null);

  // Papel de produção: trancado na tela de Produção. Qualquer outra rota volta pra lá.
  if (isProductionOnly && location.pathname !== "/jobs") {
    return <Navigate to="/jobs" replace />;
  }

  const handleDiscard = async (oppId: number) => {
    await authFetch(`/api/opportunities/${oppId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    contactModal?.onDiscardSuccess?.(oppId);
  };

  return (
    <div className="flex h-screen bg-luxury-paper dark:bg-[#070707] text-luxury-black dark:text-gray-100 font-sans">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={deskCollapsed}
        onToggleCollapse={toggleDeskCollapsed}
      />

      {/* Reabrir o menu quando recolhido (desktop) — botão flutuante discreto */}
      {deskCollapsed && (
        <button
          onClick={toggleDeskCollapsed}
          className="hidden lg:flex fixed top-3 left-3 z-[60] w-9 h-9 rounded-full items-center justify-center bg-white dark:bg-[#161616] border border-black/10 dark:border-white/10 shadow-md text-gray-600 dark:text-gray-300 hover:text-gold-600 transition-colors"
          title="Mostrar menu"
        >
          <PanelLeftOpen size={18} />
        </button>
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ImpersonationBanner />
        <TrialBanner />
        <Header
          title={pageTitle}
          userInitial={user?.email?.charAt(0).toUpperCase()}
          userEmail={user?.email ?? undefined}
          onSignOut={signOut}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Suspense
            fallback={
              <div className="p-8 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-600 dark:border-gold-400" />
              </div>
            }
          >
            {/* /vendas e /whatsapp não têm padding — o chat precisa ocupar
                a tela inteira pra ficar parecido com o WhatsApp Web. */}
            {location.pathname.startsWith('/vendas') || location.pathname.startsWith('/whatsapp') || location.pathname.startsWith('/pos-venda') ? (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <Outlet context={{ openContactModal }} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                <Outlet context={{ openContactModal }} />
              </div>
            )}
          </Suspense>
        </div>
      </main>

      {contactModal && (
        <ContactOpportunityModal
          opportunity={contactModal.opportunity}
          client={contactModal.client}
          onClose={closeContactModal}
          onUpdate={() => contactModal.onUpdate?.()}
          onDiscard={handleDiscard}
        />
      )}

      <BillingGate />
    </div>
  );
}
