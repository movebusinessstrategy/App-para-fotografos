import React, { Suspense, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import Sidebar from "./Sidebar";
import Header from "./Header";
import ContactOpportunityModal from "../shared/ContactOpportunityModal";
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
  "/calendar": "Agenda",
  "/settings": "Configurações",
  "/finance": "Financeiro",
};

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [contactModal, setContactModal] = useState<ContactModalPayload | null>(null);

  const pageTitle = useMemo(() => TITLE_MAP[location.pathname] || "Dashboard", [location.pathname]);

  const openContactModal = (payload: ContactModalPayload) => setContactModal(payload);
  const closeContactModal = () => setContactModal(null);

  // Função para descartar oportunidade via API
  const handleDiscard = async (oppId: number) => {
    await authFetch(`/api/opportunities/${oppId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    // Chama o callback para remover localmente no Dashboard
    contactModal?.onDiscardSuccess?.(oppId);
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <Header
          title={pageTitle}
          userInitial={user?.email?.charAt(0).toUpperCase()}
          onSignOut={signOut}
        />

        <Suspense
          fallback={
            <div className="p-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          }
        >
          <div className="p-8">
            <Outlet context={{ openContactModal }} />
          </div>
        </Suspense>
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
    </div>
  );
}
