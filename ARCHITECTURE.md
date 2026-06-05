# Arquitetura do Projeto — CRM Trilha

Documento-mapa para quem precisa **dar manutenção** no projeto sem conhecer a história
toda. Objetivo: achar rápido "onde mexo para ajustar X" sem quebrar o resto.

> Atualizado em 2026-06-05. Se mudar a estrutura, atualize este arquivo junto.

---

## 1. O que é o produto

CRM para estúdios de fotografia: pipeline de vendas, produção de trabalhos (jobs),
clientes, contratos, financeiro/cobrança, agenda e um **atendimento via WhatsApp**
(tanto por servidor — Baileys — quanto por uma **extensão de navegador** que injeta o
CRM dentro do WhatsApp Web).

---

## 2. Stack (resumo)

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19 + Vite 6 + Tailwind 4 + React Router 7 + SWR |
| Backend | Node + Express (`server.ts`, rodado via `tsx`) |
| Banco / Auth | **Supabase** (Postgres + Auth) — fonte de verdade |
| WhatsApp (servidor) | Baileys (`@whiskeysockets/baileys`) |
| WhatsApp (navegador) | Extensão Chrome em `whatsapp-extension/` |
| IA | Anthropic Claude (`ai-agent.ts`) |
| Cobrança | Asaas (`asaas-client.ts`) |
| Vídeo | Subprojeto `server/` (Express + ffmpeg) |
| Erros | Sentry (opt-in) |
| Deploy | Frontend na **Vercel**, backend no **Render** |

---

## 3. Mapa de pastas

```
.
├── src/                  # FRONTEND (React)
│   ├── pages/            # 1 arquivo por tela/rota (DashboardPage, VendasPage, ...)
│   ├── components/       # Componentes agrupados por domínio:
│   │   ├── vendas/  pipeline/  producao/  clientes/
│   │   ├── financeiro/  contracts/  catalogo/  oportunidades/
│   │   ├── agente/  settings/  layout/
│   │   ├── ui/           # Componentes genéricos de UI (botões, selects...)
│   │   └── shared/       # Reuso entre domínios
│   ├── contexts/         # Estado global via React Context
│   ├── hooks/            # Hooks reutilizáveis
│   ├── services/         # Chamadas à API / lógica de dados do front
│   ├── integrations/     # Integrações do lado do front
│   ├── features/chat/    # Feature de chat
│   ├── utils/  lib/  types/  styles/
│   ├── App.tsx           # Rotas principais
│   └── main.tsx          # Entrada do React
│
├── server.ts             # BACKEND PRINCIPAL — Express, ~14k linhas.
│                         #   Serve a API (/api/*) e, em dev, o front via Vite.
├── baileys-manager.ts    # WhatsApp via Baileys (conexão, QR, envio/recebimento)
├── ai-agent.ts           # Agente de IA (Claude) — sugestões de resposta
├── asaas-client.ts       # Cliente da API de cobrança Asaas
├── supabase.ts           # Cliente Supabase (banco + auth) — usado pelo backend
├── pipeline-helpers.ts   # Lógica de etapas do pipeline (compartilhada)
├── sentry-server.ts      # Inicialização do Sentry no backend (opt-in)
├── lib/                  # Utilitários de backend:
│   ├── wa-token-crypto.ts        # Cripto dos tokens do WhatsApp
│   ├── autentique-import.ts      # Import de contratos (Autentique)
│   └── default-contract-template.ts
│
├── server/               # SUBPROJETO separado (node_modules próprio):
│                         #   servidor de processamento de VÍDEO (ffmpeg, uploads)
├── api/                  # api/index.ts — variante serverless (Vercel). Ver §8 (legado?)
│
├── migrations/           # Migrações SQL do Supabase (001_..., 002_..., numeradas)
├── whatsapp-extension/   # Extensão Chrome (ver §6)
├── scripts/              # Scripts utilitários
├── patches/              # patch-package (correções em dependências)
│
├── vite.config.ts        # Config do Vite (build do front)
├── vercel.json           # Deploy do front + rewrite de /api pro Render
├── tsconfig.json
└── focalpoint.db         # SQLite local — resíduo de dev, NÃO é o banco de produção
```

---

## 4. Como os pedaços se conectam

```
Navegador (React, src/)  ──HTTP──►  /api/*
                                      │
                  (Vercel rewrite)    ▼
                         Backend Express (server.ts) no Render
                                      │
        ┌─────────────────┬──────────┼───────────┬──────────────┐
        ▼                 ▼          ▼           ▼              ▼
    Supabase          Baileys    ai-agent     Asaas      Google APIs
   (DB + Auth)       (WhatsApp)  (Claude)   (cobrança)  (Calendar/sync)

Extensão Chrome (whatsapp-extension/) ──► injeta CRM no WhatsApp Web
                                          e fala com o mesmo backend
```

- O **frontend** (Vercel) chama `/api/*`. O `vercel.json` reescreve isso para o
  **backend no Render** (`app-para-fotografos.onrender.com`).
- O **backend** (`server.ts`) concentra as rotas e fala com Supabase e integrações.
- A **extensão** é independente do front da Vercel: roda dentro do WhatsApp Web e
  conversa com o mesmo backend.

---

## 5. Banco de dados

- **Produção = Supabase (Postgres).** Auth e dados ficam lá. Acesso via `supabase.ts`
  (backend) e pelos clients do front.
- **Migrations:** arquivos SQL numerados em `migrations/` (`001_...sql` em diante).
  Para uma mudança de schema, **crie o próximo número** — não edite migrations antigas
  já aplicadas.
- `focalpoint.db` (SQLite) **não** é usado pelo `server.ts` — é resíduo local de dev
  (e está no `.gitignore`).

---

## 6. Extensão do WhatsApp (`whatsapp-extension/`)

Injeta o CRM dentro do WhatsApp Web (kanban, tarefas, produção, faixa do lead na conversa).

| Arquivo | Papel |
|---------|-------|
| `content.js` | Lógica principal injetada na página (rail lateral, overlays, faixa do chat) |
| `content.css` | Estilos dos overlays/faixa |
| `background.js` | Service worker (fala com o backend, autenticação) |
| `popup.html` / `popup.js` | Popup do ícone da extensão |
| `agente.js` | Integração do agente de IA dentro da extensão |
| `manifest.json` | Configuração da extensão |
| `INSTALL.md` | Como carregar a extensão no Chrome |

Para testar: `chrome://extensions` → modo desenvolvedor → "Carregar sem compactação"
→ apontar para a pasta `whatsapp-extension/`. Depois recarregue o WhatsApp Web.

---

## 7. Variáveis de ambiente (`.env` / `.env.local`)

Não versionadas (estão no `.gitignore`). As principais:

| Variável | Para quê |
|----------|----------|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Conexão com o Supabase (obrigatórias) |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações admin no backend |
| `ANTHROPIC_API_KEY` | Agente de IA (Claude) |
| `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN` | Cobrança (Asaas) |
| `GEMINI_API_KEY` | (legado do boilerplate — verificar se ainda é usado) |
| `SENTRY_DSN` | Monitoramento de erros (opcional) |
| `APP_PUBLIC_URL` | Montar URLs de retorno (cobrança etc.) |

> `.env.example` deveria listar todas — vale manter atualizado.

---

## 8. Pontos de atenção (dívidas/armadilhas conhecidas)

- **`server.ts` é gigante (~14k linhas).** Toda a API mora aqui. Ao mexer, busque a
  rota pelo caminho (`app.get('/api/...')`) em vez de ler de cima a baixo.
- **`api/index.ts`** parece ser uma variante **serverless (Vercel) legada**: não é
  referenciado em configs e o `vercel.json` manda `/api` pro Render. **Confirme antes
  de assumir que está em uso** — mudar API geralmente é só no `server.ts`.
- **`server/` é um subprojeto à parte** com `node_modules` próprio (vídeo/ffmpeg).
  Rodar/instalar dependências dele é separado do projeto raiz.
- **Sessões do WhatsApp são sensíveis.** `baileys_sessions/` e qualquer backup
  (`*_sessions.backup_*`) estão no `.gitignore` — nunca commite credenciais.
- **Sem ESLint.** O `npm run lint` é só `tsc --noEmit` (checagem de tipos). A regra de
  complexidade ciclomática (ver `CLAUDE.md`) é uma diretriz de escrita, não um lint.

---

## 9. Onde mexer para cada tipo de ajuste

| Quero ajustar... | Vá em... |
|------------------|----------|
| Uma **tela/página** | `src/pages/<Nome>Page.tsx` + componentes em `src/components/<domínio>/` |
| **Pipeline de vendas** (UI) | `src/components/pipeline/` e `src/components/vendas/` |
| **Produção / jobs** (UI) | `src/components/producao/` |
| **Etapas padrão do pipeline** | `pipeline-helpers.ts` (`DEFAULT_STAGES`) |
| Uma **rota da API** | `server.ts` (procure `'/api/<rota>'`) |
| **Integração de cobrança** | `asaas-client.ts` (+ rotas no `server.ts`) |
| **WhatsApp no servidor** (QR/conexão) | `baileys-manager.ts` |
| **Agente de IA** (tom, regras) | `ai-agent.ts` (defaults) + config no banco |
| **Extensão do WhatsApp Web** | `whatsapp-extension/content.js` / `content.css` |
| **Schema do banco** | criar nova migration em `migrations/` |
| **Estilos globais** | `src/index.css`, `src/styles/`, classes Tailwind |
| **Processamento de vídeo** | subprojeto `server/` |
| **Deploy do front** | `vercel.json` (Vercel) |
| **Deploy do backend** | painel do Render (sem Procfile no repo) |
