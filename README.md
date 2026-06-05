# CRM Trilha

CRM para estúdios de fotografia: pipeline de vendas, produção de trabalhos, clientes,
contratos, financeiro/cobrança, agenda e atendimento via WhatsApp (servidor + extensão
de navegador).

> 📐 **Visão de arquitetura e "onde mexo para ajustar X":** veja [ARCHITECTURE.md](ARCHITECTURE.md).
> 🧹 **Convenções de código:** veja [CLAUDE.md](CLAUDE.md).

---

## Stack

React 19 + Vite 6 + Tailwind 4 (frontend) · Express + `tsx` (backend) · Supabase
(banco + auth) · Baileys (WhatsApp) · Anthropic Claude (IA) · Asaas (cobrança).

---

## Rodando localmente

**Pré-requisitos:** Node.js (LTS).

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um `.env.local` na raiz com, no mínimo:
   ```env
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ANTHROPIC_API_KEY=...        # agente de IA (opcional p/ rodar o básico)
   ASAAS_API_KEY=...            # cobrança (opcional)
   ASAAS_ENV=sandbox
   ```
   (Lista completa em [ARCHITECTURE.md §7](ARCHITECTURE.md).)
3. Suba o app (backend Express + frontend via Vite):
   ```bash
   npm run dev
   ```

---

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Sobe o backend (`server.ts` via `tsx`) servindo o front |
| `npm run build` | Build de produção do frontend (Vite → `dist/`) |
| `npm run preview` | Pré-visualiza o build |
| `npm run lint` | Checagem de tipos (`tsc --noEmit`) — não é ESLint |
| `npm run clean` | Remove `dist/` |

---

## Extensão do WhatsApp

Em `whatsapp-extension/`. Para carregar: `chrome://extensions` → ative o modo
desenvolvedor → "Carregar sem compactação" → selecione a pasta. Detalhes em
[whatsapp-extension/INSTALL.md](whatsapp-extension/INSTALL.md).

---

## Deploy

- **Frontend:** Vercel (`vercel.json`, build `npm run build` → `dist/`).
- **Backend:** Render (`server.ts`). O `vercel.json` reescreve `/api/*` para o backend
  no Render.
- **Banco/migrations:** Supabase. Mudanças de schema = nova migration em `migrations/`.
