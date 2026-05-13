import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SWRConfig } from "swr";

import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext"; // 👈 Adiciona isso

const Login = lazy(() => import("./pages/Login"));
const Cadastro = lazy(() => import("./pages/Cadastro"));
const RecuperarSenha = lazy(() => import("./pages/RecuperarSenha"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const VendasPage = lazy(() => import("./pages/VendasPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const PipelineSettings = lazy(() => import("./pages/PipelineSettings"));
const OportunidadesPage = lazy(() => import("./pages/OportunidadesPage"));
const ContractsPage = lazy(() => import("./pages/ContractsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const CatalogoPage = lazy(() => import("./pages/CatalogoPage"));

export default function App() {
  return (
    <BrowserRouter>
      <SWRConfig
        value={{
          // Não refaz a mesma request em 30s — chave do ganho ao navegar entre páginas
          dedupingInterval: 30_000,
          // Sem revalidar ao trocar de aba (chato e desnecessário)
          revalidateOnFocus: false,
          // Mas revalida ao recuperar conexão
          revalidateOnReconnect: true,
          // 1 retry se falhar
          errorRetryCount: 1,
        }}
      >
      <ThemeProvider> {/* 👈 Envolve tudo */}
        <AuthProvider>
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1207] via-[#2d1f08] to-[#1a1207]">
                <div className="flex flex-col items-center gap-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold-400" />
                  <p className="text-white/70">Carregando...</p>
                </div>
              </div>
            }
          >
            <Routes>
              {/* Rotas públicas */}
              <Route path="/login" element={<Login />} />
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/recuperar-senha" element={<RecuperarSenha />} />
              <Route path="/privacidade" element={<PrivacyPolicyPage />} />
              <Route path="/termos" element={<TermsOfServicePage />} />

              {/* Rotas protegidas */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="vendas" element={<VendasPage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="finance" element={<FinancePage />} />
                <Route
                  path="pipeline-settings"
                  element={<PipelineSettings />}
                />
                <Route path="oportunidades" element={<OportunidadesPage />} />
                <Route path="contratos" element={<ContractsPage />} />
                <Route path="catalogo" element={<CatalogoPage />} />
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider> {/* 👈 Fecha aqui */}
      </SWRConfig>
      <Analytics />
    </BrowserRouter>
  );
}
