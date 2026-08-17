import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SWRConfig } from "swr";

import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import PermissionRoute from "./components/PermissionRoute";
import PlatformAdminRoute from "./components/PlatformAdminRoute";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext"; // 👈 Adiciona isso
import { ImpersonationProvider } from "./contexts/ImpersonationContext";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const Login = lazy(() => import("./pages/Login"));
const Cadastro = lazy(() => import("./pages/Cadastro"));
const RecuperarSenha = lazy(() => import("./pages/RecuperarSenha"));
const RedefinirSenha = lazy(() => import("./pages/RedefinirSenha"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const VendasPage = lazy(() => import("./pages/VendasPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const FiscalPage = lazy(() => import("./pages/FiscalPage"));
const PipelineSettings = lazy(() => import("./pages/PipelineSettings"));
const OportunidadesPage = lazy(() => import("./pages/OportunidadesPage"));
const ContractsPage = lazy(() => import("./pages/ContractsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const DataDeletionPage = lazy(() => import("./pages/DataDeletionPage"));
const CatalogoPage = lazy(() => import("./pages/CatalogoPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const PlanosPage = lazy(() => import("./pages/PlanosPage"));
const AssinaturaPage = lazy(() => import("./pages/AssinaturaPage"));
const AgentePage = lazy(() => import("./pages/AgentePage"));
const WhatsappPage = lazy(() => import("./pages/WhatsappPage"));
const PosVendaPage = lazy(() => import("./pages/PosVendaPage"));
const GaleriasPage = lazy(() => import("./features/galeria/GaleriasPage"));
const GaleriaDetailPage = lazy(() => import("./features/galeria/GaleriaDetailPage"));
const GaleriaPublicaPage = lazy(() => import("./features/galeria-publica/GaleriaPublicaPage"));
const AlbumListPage = lazy(() => import("./features/album/AlbumListPage"));
const AlbumEditorPage = lazy(() => import("./features/album/AlbumEditorPage"));
const AlbumPublicoPage = lazy(() => import("./features/album-publica/AlbumPublicoPage"));

// ── Central de Configurações ────────────────────────────────────────────────
const SettingsLayout = lazy(() => import("./pages/configuracoes/SettingsLayout"));
const EmpresaTab = lazy(() => import("./pages/configuracoes/EmpresaTab"));
const PlanoTab = lazy(() => import("./pages/configuracoes/PlanoTab"));
const IntegracoesTab = lazy(() => import("./pages/configuracoes/IntegracoesTab"));
const IntegracaoCalendar = lazy(() => import("./pages/configuracoes/IntegracaoCalendar"));
const IntegracaoWhatsApp = lazy(() => import("./pages/configuracoes/IntegracaoWhatsApp"));
const IntegracaoExtensao = lazy(() => import("./pages/configuracoes/IntegracaoExtensao"));
const IntegracaoAutentique = lazy(() => import("./pages/configuracoes/IntegracaoAutentique"));
const EquipeTab = lazy(() => import("./pages/configuracoes/EquipeTab"));
const PermissoesTab = lazy(() => import("./pages/configuracoes/PermissoesTab"));
const OportunidadesConfigTab = lazy(() => import("./pages/configuracoes/AutomacoesTab"));
const CamposPersonalizadosTab = lazy(() => import("./pages/configuracoes/CamposPersonalizadosTab"));

// ── Platform Admin (super-admin do SaaS) ─────────────────────────────────────
const PlatformAdminLayout = lazy(() => import("./pages/platform-admin/PlatformAdminLayout"));
const PlatformDashboardPage = lazy(() => import("./pages/platform-admin/PlatformDashboardPage"));
const PlatformTenantsListPage = lazy(() => import("./pages/platform-admin/TenantsListPage"));
const PlatformTenantDetailPage = lazy(() => import("./pages/platform-admin/TenantDetailPage"));
const PlatformPlansPage = lazy(() => import("./pages/platform-admin/PlansPage"));
const PlatformAdminsPage = lazy(() => import("./pages/platform-admin/AdminsPage"));
const PlatformAuditLogPage = lazy(() => import("./pages/platform-admin/AuditLogPage"));

export default function App() {
  return (
    <BrowserRouter>
      <SWRConfig
        value={{
          // Cache 60s - navegar entre páginas vira instantâneo (não refetch)
          dedupingInterval: 60_000,
          // Sem revalidar ao trocar de aba (chato e desnecessário)
          revalidateOnFocus: false,
          // Sem revalidar ao montar se já tem dado cache válido (instant load)
          revalidateIfStale: false,
          // Mas revalida ao recuperar conexão
          revalidateOnReconnect: true,
          // Sem retry agressivo - 1 só, e com delay maior pra não martelar
          errorRetryCount: 1,
          errorRetryInterval: 3000,
          // Mantém dados antigos enquanto revalida (sem "Carregando..." flash)
          keepPreviousData: true,
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
              <Route path="/" element={<LandingPage />} />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/recuperar-senha" element={<RecuperarSenha />} />
              <Route path="/redefinir-senha" element={<RedefinirSenha />} />
              <Route path="/privacidade" element={<PrivacyPolicyPage />} />
              <Route path="/termos" element={<TermsOfServicePage />} />
              <Route path="/excluir-dados" element={<DataDeletionPage />} />
              {/* Galeria pública de seleção de fotos — cliente final, sem login */}
              <Route path="/g/:token" element={<GaleriaPublicaPage />} />
              <Route path="/a/:token" element={<AlbumPublicoPage />} />

              {/* Rotas protegidas */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<PermissionRoute module="dashboard"><DashboardPage /></PermissionRoute>} />
                <Route path="clients" element={<PermissionRoute module="clients"><ClientsPage /></PermissionRoute>} />
                <Route path="jobs" element={<PermissionRoute module="jobs"><JobsPage /></PermissionRoute>} />
                <Route path="tarefas" element={<PermissionRoute module="jobs"><TasksPage /></PermissionRoute>} />
                <Route path="galeria" element={<PermissionRoute module="jobs"><GaleriasPage /></PermissionRoute>} />
                <Route path="galeria/:id" element={<PermissionRoute module="jobs"><GaleriaDetailPage /></PermissionRoute>} />
                <Route path="album" element={<PermissionRoute module="jobs"><AlbumListPage /></PermissionRoute>} />
                <Route path="album/:id" element={<PermissionRoute module="jobs"><AlbumEditorPage /></PermissionRoute>} />
                <Route path="agente" element={<AgentePage />} />
                <Route path="vendas" element={<PermissionRoute module="vendas"><VendasPage /></PermissionRoute>} />
                <Route path="whatsapp" element={<PermissionRoute module="whatsapp"><WhatsappPage /></PermissionRoute>} />
                <Route path="pos-venda" element={<PermissionRoute module="posvenda"><PosVendaPage /></PermissionRoute>} />
                <Route path="calendar" element={<PermissionRoute module="calendar"><CalendarPage /></PermissionRoute>} />
                <Route path="finance" element={<PermissionRoute module="finance"><FinancePage /></PermissionRoute>} />
                <Route path="fiscal" element={<PermissionRoute module="finance"><FiscalPage /></PermissionRoute>} />
                <Route
                  path="pipeline-settings"
                  element={<PermissionRoute module="vendas"><PipelineSettings /></PermissionRoute>}
                />
                <Route path="oportunidades" element={<PermissionRoute module="oportunidades"><OportunidadesPage /></PermissionRoute>} />
                <Route path="contratos" element={<PermissionRoute module="contratos"><ContractsPage /></PermissionRoute>} />
                <Route path="catalogo" element={<PermissionRoute module="catalogo"><CatalogoPage /></PermissionRoute>} />
                <Route path="planos" element={<PermissionRoute ownerOnly><PlanosPage /></PermissionRoute>} />

                {/* Central de Configurações - sidebar interna com sub-rotas.
                    Equipe, Permissões e Plano são owner-only (membros nem
                    pelo URL direto). Demais sub-rotas seguem permissões. */}
                <Route path="configuracoes" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="empresa" replace />} />
                  <Route path="empresa" element={<EmpresaTab />} />
                  <Route path="plano" element={<PermissionRoute ownerOnly><PlanoTab /></PermissionRoute>} />
                  <Route path="integracoes" element={<IntegracoesTab />} />
                  <Route path="integracoes/calendar" element={<IntegracaoCalendar />} />
                  <Route path="integracoes/whatsapp" element={<IntegracaoWhatsApp />} />
                  <Route path="integracoes/extensao" element={<IntegracaoExtensao />} />
                  <Route path="integracoes/autentique" element={<PermissionRoute ownerOnly><IntegracaoAutentique /></PermissionRoute>} />
                  <Route path="equipe" element={<PermissionRoute ownerOnly><EquipeTab /></PermissionRoute>} />
                  <Route path="permissoes" element={<PermissionRoute ownerOnly><PermissoesTab /></PermissionRoute>} />
                  <Route path="oportunidades" element={<OportunidadesConfigTab />} />
                  <Route path="campos-personalizados" element={<CamposPersonalizadosTab />} />
                  <Route path="automacoes"    element={<Navigate to="/configuracoes/oportunidades" replace />} />
                </Route>

                {/* Redirects das URLs antigas para preservar bookmarks */}
                <Route path="settings"    element={<Navigate to="/configuracoes/integracoes/calendar" replace />} />
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
                <Route path="admins" element={<PlatformAdminsPage />} />
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
