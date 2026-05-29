// Decide pra qual rota mandar o usuário quando ele cai numa página sem
// permissão (ou logo depois do login). Antes era hardcoded /dashboard, o
// que quebrava o login do funcionário que tinha o Dashboard bloqueado
// (a tela "Acesso restrito" tinha um botão Voltar que jogava pro login).
//
// Ordem de preferência: tarefas primeiro (o que o funcionário mais usa),
// caindo pra outras telas operacionais conforme tiver acesso. Fallback
// final é /configuracoes/empresa porque essa rota não tem PermissionRoute,
// então qualquer logado consegue abrir.

const ROUTES: Array<{ path: string; module: string | null }> = [
  { path: "/whatsapp",      module: "whatsapp" },
  { path: "/tarefas",       module: "jobs" },
  { path: "/vendas",        module: "vendas" },
  { path: "/jobs",          module: "jobs" },
  { path: "/clients",       module: "clients" },
  { path: "/calendar",      module: "calendar" },
  { path: "/oportunidades", module: "oportunidades" },
  { path: "/contratos",     module: "contratos" },
  { path: "/finance",       module: "finance" },
  { path: "/dashboard",     module: "dashboard" },
  { path: "/agente",        module: null }, // rota sem PermissionRoute
];

const FALLBACK = "/configuracoes/empresa";

export function getLandingRoute(canAccess: (module: string) => boolean): string {
  for (const r of ROUTES) {
    if (r.module === null || canAccess(r.module)) return r.path;
  }
  return FALLBACK;
}
