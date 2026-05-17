import React, { Suspense, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import Sidebar from "./Sidebar";
import Header from "./Header";
import ContactOpportunityModal from "../shared/ContactOpportunityModal";
import ImpersonationBanner from "../ImpersonationBanner";
import TrialBanner from "../TrialBanner";
import BillingGate from "../BillingGate";
import { useAuth } from "../../contexts/AuthContext";
import { authFetch } from "../../utils/authFetch";
import { Client, Opportunity } from "../../types";

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
  "/calendar": "Agenda",
  "/settings": "Configurações",
  "/finance": "Financeiro",
  "/pipeline-settings": "Configurar Funil",
  "/oportunidades": "Oportunidades",
};

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [contactModal, setContactModal] = useState<ContactModalPayload | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const pageTitle = useMemo(() => {
    return TITLE_MAP[location.pathname] || "Dashboard";
  }, [location.pathname]);

  const openContactModal = (payload: ContactModalPayload) => setContactModal(payload);
  const closeContactModal = () => setContactModal(null);

  const handleDiscard = async (oppId: number) => {
    await authFetch(`/api/opportunities/${oppId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    contactModal?.onDiscardSuccess?.(oppId);
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] dark:bg-gray-950 text-[#1A1A1A] dark:text-gray-100 font-sans">
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ImpersonationBanner />
        <TrialBanner />
        <Header
          title={pageTitle}
          userInitial={user?.email?.charAt(0).toUpperCase()}
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
            {/* Vendas não tem padding — precisa de flex-1 para o chat funcionar */}
            {location.pathname.startsWith('/vendas') ? (
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
