import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SWRConfig } from "swr";

import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import PlatformAdminRoute from "./components/PlatformAdminRoute";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext"; // 👈 Adiciona isso
import { ImpersonationProvider } from "./contexts/ImpersonationContext";

const LandingPage = lazy(() => import("./pages/LandingPage"));
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
const TasksPage = lazy(() => import("./pages/TasksPage"));
const PlanosPage = lazy(() => import("./pages/PlanosPage"));
const AssinaturaPage = lazy(() => import("./pages/AssinaturaPage"));

// ── Central de Configurações ────────────────────────────────────────────────
const SettingsLayout = lazy(() => import("./pages/configuracoes/SettingsLayout"));
const EmpresaTab = lazy(() => import("./pages/configuracoes/EmpresaTab"));
const PlanoTab = lazy(() => import("./pages/configuracoes/PlanoTab"));
const IntegracoesTab = lazy(() => import("./pages/configuracoes/IntegracoesTab"));
const IntegracaoCalendar = lazy(() => import("./pages/configuracoes/IntegracaoCalendar"));
const IntegracaoWhatsApp = lazy(() => import("./pages/configuracoes/IntegracaoWhatsApp"));
const EquipeTab = lazy(() => import("./pages/configuracoes/EquipeTab"));
const PermissoesTab = lazy(() => import("./pages/configuracoes/PermissoesTab"));
const OportunidadesConfigTab = lazy(() => import("./pages/configuracoes/AutomacoesTab"));

// ── Platform Admin (super-admin do SaaS) ─────────────────────────────────────
const PlatformAdminLayout = lazy(() => import("./pages/platform-admin/PlatformAdminLayout"));
const PlatformDashboardPage = lazy(() => import("./pages/platform-admin/PlatformDashboardPage"));
const PlatformTenantsListPage = lazy(() => import("./pages/platform-admin/TenantsListPage"));
const PlatformTenantDetailPage = lazy(() => import("./pages/platform-admin/TenantDetailPage"));
const PlatformPlansPage = lazy(() => import("./pages/platform-admin/PlansPage"));
const PlatformAuditLogPage = lazy(() => import("./pages/platform-admin/AuditLogPage"));

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
          <ImpersonationProvider>
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
              <Route path="/landing" element={<LandingPage />} />
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
                <Route path="tarefas" element={<TasksPage />} />
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
                <Route path="planos" element={<PlanosPage />} />

                {/* Central de Configurações — sidebar interna com sub-rotas */}
                <Route path="configuracoes" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="empresa" replace />} />
                  <Route path="empresa" element={<EmpresaTab />} />
                  <Route path="plano" element={<PlanoTab />} />
                  <Route path="integracoes" element={<IntegracoesTab />} />
                  <Route path="integracoes/calendar" element={<IntegracaoCalendar />} />
                  <Route path="integracoes/whatsapp" element={<IntegracaoWhatsApp />} />
                  <Route path="equipe" element={<EquipeTab />} />
                  <Route path="permissoes" element={<PermissoesTab />} />
                  <Route path="oportunidades" element={<OportunidadesConfigTab />} />
                  <Route path="automacoes"    element={<Navigate to="/configuracoes/oportunidades" replace />} />
                </Route>

                {/* Redirects das URLs antigas para preservar bookmarks */}
                <Route path="settings"    element={<Navigate to="/configuracoes/oportunidades" replace />} />
                <Route path="admin"       element={<Navigate to="/configuracoes/equipe" replace />} />
                <Route path="assinatura"  element={<Navigate to="/configuracoes/plano" replace />} />
              </Route>

              {/* Platform Admin (super-admin do SaaS) */}
              <Route
                path="/platform-admin"
                element={
                  <PlatformAdminRoute>
                    <PlatformAdminLayout />
                  </PlatformAdminRoute>
                }
              >
                <Route index element={<PlatformDashboardPage />} />
                <Route path="tenants" element={<PlatformTenantsListPage />} />
                <Route path="tenants/:ownerId" element={<PlatformTenantDetailPage />} />
                <Route path="plans" element={<PlatformPlansPage />} />
                <Route path="audit-log" element={<PlatformAuditLogPage />} />
              </Route>
            </Routes>
          </Suspense>
          </ImpersonationProvider>
        </AuthProvider>
      </ThemeProvider> {/* 👈 Fecha aqui */}
      </SWRConfig>
      <Analytics />
    </BrowserRouter>
  );
}
