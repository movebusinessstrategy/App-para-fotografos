# Galeria de Seleção de Fotos (Proofing) — CRM Trilha
### Documento de Arquitetura — clone funcional do Alboom Proof, integrado ao CRM

> Gerado em 2026-06-11 a partir de exploração do codebase. Premissa: produto SaaS multi-tenant, vendável a outros estúdios, com TODAS as fotos em storage de nuvem (nunca no computador do fotógrafo).

---

## 1. Veredito de viabilidade

**Sim, dá pra fazer — e o CRM já te dá meio caminho andado.** Proporções honestas: **~40% reaproveita o que existe, ~60% é construção nova.** Os dois maiores buracos (e-mail transacional + processamento de imagem com marca d'água) são exatamente as partes críticas do produto.

### O que dá pra reaproveitar DE VERDADE (confirmado na exploração)

| Peça | Estado | Onde |
|---|---|---|
| **Storage de arquivos** | ✅ Pronto. Supabase Storage já é o padrão, com 4 buckets, `ensureBucket()` lazy, upload via `supabaseAdmin`, `getPublicUrl` (público) e `createSignedUrl(path, ttl)` (privado, links de 1h) | `server.ts`, `supabase.ts` |
| **Padrão de bucket PRIVADO + signed URL** | ✅ Pronto. `agente-materiais`/`agente-audios` já fazem exatamente o modelo "original privado, só o dono baixa via link temporário" | `server.ts` |
| **Auth do lado do estúdio** | ✅ Pronto. Supabase Auth puro + `authFetch` (JWT Bearer, retry 401, impersonação, billing gate) | `src/utils/authFetch.ts` |
| **Padrão de rota pública (cliente sem login)** | ✅ Existe o molde. Rotas Express SEM `requireAuth` + catch-all `app.get('*') → index.html`. Front: basta `<Route path="/g/:token">` FORA do `<ProtectedRoute>` | `server.ts`, `src/App.tsx` |
| **Geração de token** | ✅ Precedente. `generateDeletionTicketId` (hash) e `lib/wa-token-crypto.ts` (cripto de token WhatsApp) | `server.ts`, `lib/wa-token-crypto.ts` |
| **Gatilho "ensaio realizado"** | ✅ Ponto único. `PUT /api/jobs/:id` (server.ts ~3796-3829) — quando `production_stage` vira etapa `is_final` | `server.ts` |
| **Notificação ao cliente via WhatsApp** | ✅ Pronto. `BaileysManager.sendText`/`sendMedia`, número do próprio estúdio, isolado por `userId` | `baileys-manager.ts` |
| **Relação job ↔ subrecurso** | ✅ Padrão. `/api/jobs/:id/payments`, `/items` — replicar pra `/api/jobs/:id/gallery` | `server.ts` |
| **Preço da foto extra (parcial)** | ⚠️ Existe tosco. `studio_settings.extra_photo_price` é string (`'35,00'`) usada só em contrato. Serve de default | `scripts/create_contracts_tables.sql` |

### O que precisa ser construído DO ZERO (gaps confirmados)

1. **Processamento de imagem server-side** — `sharp` está no `node_modules` só como dep transitiva, nunca importado. Sem watermark, thumbnail ou preview. **É o coração do produto e não existe.**
2. **E-mail transacional** — zero. Nenhum provedor, domínio ou SPF/DKIM. Só `inviteUserByEmail` do Supabase Auth.
3. **Upload em massa** — hoje tudo é base64-em-JSON (teto 50mb, em memória). Inviável pra milhares de fotos. Precisa de upload direto cliente→Storage via signed upload URL.
4. **Modelo de dados de galeria** — galerias, fotos, seleções, tokens: schema novo.
5. **Pagamento** — não há gateway de cliente final (Asaas é só billing da plataforma).
6. **Página pública de galeria** + lógica de seleção/contagem de extras.

**Conclusão:** viável e estratégico. Os dois itens mais valiosos (watermark + e-mail) são greenfield. O barato vem de storage, auth, rota pública e WhatsApp já resolvidos.

---

## 2. Arquitetura proposta

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTE FINAL (a mãe)             │   ESTÚDIO (fotógrafo logado) │
│  galeria.crmtrilha.com.br/g/:token │  app.crmtrilha.com.br (CRM)  │
│  - vê previews c/ marca d'água     │   - cria galeria, sobe fotos │
│  - seleciona, paga extras          │   - vê seleção, baixa orig.  │
└────────────┬───────────────────────┴───────────────┬─────────────┘
             │ fetch público (token)                  │ authFetch (JWT)
             ▼                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │   server.ts (Express no Render) — MESMO backend           │
   │   + /api/public/galeria/:token (SEM requireAuth)          │
   │   + /api/jobs/:id/gallery (COM requireAuth)               │
   │   + WORKER de imagem (sharp) — watermark/thumb/preview    │
   │   + webhook de pagamento (Mercado Pago)                   │
   └───────┬───────────────────┬──────────────────┬───────────┘
           ▼                   ▼                  ▼
   ┌─────────────┐    ┌─────────────────┐  ┌──────────────┐
   │ Cloudflare  │    │ Supabase Postgres│  │  Resend      │
   │ R2 (fotos)  │    │ (metadados +     │  │  Mercado Pago│
   │ egress ZERO │    │  galerias/seleç.)│  │              │
   └─────────────┘    └─────────────────┘  └──────────────┘
```

### 2.1 Frontend da galeria — subdomínio separado, mesmo repo
`galeria.crmtrilha.com.br`, build separado, reaproveitando o mesmo repo React. Bundle enxuto (carrega rápido no celular da mãe, não puxa o CRM inteiro). Página pública fora do `<ProtectedRoute>`. Lado do estúdio fica dentro do CRM (aba "Galeria" no `JobDetailDrawer`).

### 2.2 Backend — estende o `server.ts` atual
Auth, CORS, Supabase admin, Baileys e catch-all SPA já estão lá. Rotas públicas (validam token na URL) registradas ANTES do `requireAuth`. Processamento pesado de imagem roda assíncrono.

### 2.3 Storage — Cloudflare R2 (recomendado), Supabase no MVP
A galeria é egress-heavy. Critério #1 = egress barato.

| Opção | Storage $/GB/mês | Egress $/GB | Veredito |
|---|---|---|---|
| Supabase Storage | ~$0,021 | ~$0,09 | Egress caro. OK pro MVP. |
| AWS S3 | ~$0,023 | ~$0,09 | Caro + complexo. Não. |
| **Cloudflare R2** | ~$0,015 | **$0** | ⭐ Melhor. Egress grátis, S3-compatible. |
| Bunny.net | ~$0,01 | ~$0,01 (LatAm) | Forte 2º, mas 2 produtos a orquestrar. |

**Custo por fotógrafo/mês** (~12 ensaios/mês, originais 90 dias): R2 ≈ **US$0,70 (~R$4)**; Supabase ≈ **US$1,40 (~R$8)**. Cobrando R$119 do estúdio, margem enorme. Alavanca de custo = original full-res → ciclo de vida (arquivar após 90d) vira upsell.

### 2.4 Processamento de imagem (watermark) — o item crítico
`sharp` (libvips) como dep direta, em fila assíncrona. Fluxo:
1. Estúdio pede signed upload URL.
2. Browser sobe o **original** direto pro bucket privado (não passa pelo backend).
3. Worker baixa, gera **preview 1600px com marca d'água queimada** (diagonal repetida, ~25% opacidade, nome do estúdio) + **thumb 400px**, sobe no bucket público.

Watermark TEM que ser server-side — se feito no browser do cliente, é burlável.

### 2.5 E-mail — Resend
SDK simples, free 3.000/mês. Pré-requisito: domínio verificado (SPF/DKIM) senão cai em spam. E-mail primário + WhatsApp como reforço (já pronto).

---

## 3. A verdade sobre proteção / anti-print

Na web é **impossível impedir 100%** que alguém capture a tela. O que protege de verdade é a **marca d'água queimada no pixel** — o screenshot sai marcado.

**O que PROTEGE (faça tudo):**
1. Marca d'água queimada server-side, visível, repetida em diagonal, cobrindo tudo (canto é fácil de cortar). Ideal: nome/ID da cliente embutido (rastreável).
2. Servir só resolução web baixa (1600px, q75). Original full-res nunca vai pro bucket público.
3. Bucket público só com previews; originais em bucket privado com signed URL curta.

**Deterrentes (atrapalham o casual, não são à prova de bala):** bloquear botão direito, drag, seleção; imagem como `background-image`; sem URL direta do preview.

**Teatro (não confie):** "detecção de DevTools", "bloquear PrintScreen" (não existe no browser), "desabilitar screenshot".

**Como o Alboom faz:** exatamente isso — marca d'água + baixa resolução + deterrentes. Não impedem screenshot; tornam o screenshot inútil comercialmente.

---

## 4. Modelo de dados novo (Supabase/Postgres)

Migrations `026_*` em diante. `user_id` TEXT, `job_id` BIGINT (alinhado a `job_payments`/`contracts`).

```sql
CREATE TABLE galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  job_id BIGINT, client_id BIGINT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|ready|sent|selecting|selected|paid|delivered|archived
  share_token TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  included_count INT NOT NULL DEFAULT 0,  -- fotos incluídas no pacote
  extra_price NUMERIC NOT NULL DEFAULT 0, -- preço por foto extra
  cover_photo_id UUID,
  selection_deadline DATE,
  sent_at TIMESTAMPTZ, selected_at TIMESTAMPTZ,
  storage_provider TEXT DEFAULT 'r2', storage_bytes BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE gallery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,   -- nome ORIGINAL (ex: DSC_0042.jpg) = o que o estúdio filtra
  sort_order INT DEFAULT 0,
  original_path TEXT, preview_path TEXT, thumb_path TEXT,
  width INT, height INT, bytes BIGINT,
  process_status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE gallery_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES gallery_photos(id) ON DELETE CASCADE,
  selected BOOLEAN NOT NULL DEFAULT true,
  client_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gallery_id, photo_id)
);
CREATE TABLE gallery_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  extra_count INT NOT NULL, amount NUMERIC NOT NULL,
  provider TEXT NOT NULL DEFAULT 'mercadopago', provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|paid|failed|expired
  paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
```

`extra_count = max(0, total_selecionadas − included_count)`; `amount = extra_count × extra_price`.

---

## 5. Acesso do cliente (sem conta)
Magic link: `galeria.crmtrilha.com.br/g/:share_token`. Token aleatório forte no banco (revogável), não JWT. Rota pública valida via `supabaseAdmin`, devolve só previews com watermark + metadados — nunca o original. Rate-limit contra enumeração.

Fluxo: abre link → grid de previews marcados → marca favoritas → vê "X selec / 30 incluídas / Y extras = R$Z" → Finalizar → paga extras (ou confirma).

---

## 6. Pagamento das extras — Mercado Pago (Checkout Pro / Pix)
Pix nativo (converte muito no Brasil), checkout hospedado (sem PCI no seu front), webhook de confirmação. Cada estúdio recebe na própria conta MP (token cifrado por `user_id`, igual `lib/wa-token-crypto.ts`).

**MVP sem gateway:** mostrar o valor das extras e o estúdio cobra por fora (Pix manual) — tira pagamento do caminho crítico do MVP.

---

## 7. Integração com o CRM
- **Entrada:** `PUT /api/jobs/:id` → etapa `is_final` → cria `gallery` draft (+ botão manual "Criar galeria" no `JobDetailDrawer` como fallback previsível).
- **Saída:** seleção finalizada → notifica estúdio (WhatsApp/e-mail/in-app), grava nomes das selecionadas no job, opcional mover card pra "Edição". ZIP via `archiver` (já no projeto).
- **Pagou:** webhook MP → galeria `paid` → lança receita em `fin_receitas` (já existe).

---

## 8. Plano em fases
- **Fase 0 — Fundação (1 sem):** migrations `026_*`, buckets, `sharp` dep direta, `getStorageUrl()`.
- **Fase 1 — MVP "para de pagar R$119" (2–3 sem):** aba Galeria no CRM, upload em massa (signed URL), **watermark server-side**, página pública `/g/:token` com seleção + deterrentes + contador, aviso (e-mail/WhatsApp), download da lista de nomes selecionados. *Pagamento ainda manual.*
- **Fase 2 — Pagamento + integração (1–2 sem):** Mercado Pago + webhook, auto-criar pré-galeria, receita no Financeiro, ZIP dos originais.
- **Fase 3 — SaaS multi-estúdio (2–4 sem):** migrar pra R2, subdomínio dedicado, worker assíncrono, cota/lifecycle por estúdio, watermark personalizado, galeria avulsa vendável.

**Esforço:** Fases 0–2 ≈ **5–7 semanas**; Fase 3 ≈ +3–4 semanas. Maiores riscos: watermark/pipeline de imagem e e-mail/domínio.

---

## 9. Decisões que dependem do dono
1. **Storage:** Supabase no MVP (rápido) → R2 na Fase 3 (egress zero)?
2. **Pagamento:** Pix manual no MVP → Mercado Pago na Fase 2? Cada estúdio na própria conta ou marketplace com split?
3. **Aviso ao cliente:** WhatsApp (pronto, grátis), e-mail (precisa verificar domínio), ou os dois?
4. **"Fotos incluídas":** digitado manual por galeria (MVP) ou amarrado ao pacote/produto (Fase 3)?
5. **Domínio:** subdomínio `galeria.` (melhor, +DNS) ou `/g/:token` no app atual (simples)?
6. **Infra:** worker de imagem + webhooks exigem serviço pago no Render (o free dorme).

---

## 10. Requisitos do painel do fotógrafo (voz do dono, 2026-06-11)

Decisões já tomadas: aviso = e-mail **e** WhatsApp; pagamento = **Mercado Pago integrado já**; visual da página da cliente aprovado em mockup.

**Lado da CLIENTE (além do que já foi aprovado):**
- Clicar na foto abre **maior (lightbox)** — navegar entre fotos, selecionar dali mesmo.
- **Comentar/observações por foto** (ex: "essa em P&B").

**Painel do FOTÓGRAFO (módulos):**
1. **Projetos (galerias)** — organização em **Kanban** (ex: Preparando → Enviada → Seleção feita → Paga/Entregue). Criar galeria, subir fotos, ver status de cada cliente.
2. **Clientes** — CRUD próprio. Pode vincular ao CRM Trilha, mas funciona **standalone** (cadastrar cliente avulso) porque o produto é vendido separado.
3. **Receita** (não "pedidos") — a receber, recebido, ticket médio; pedidos com código, cliente, galeria, status (pago / Pix gerado e não pago / não finalizou seleção); **exportar CSV**.
4. **Configurações** — logo, nome, e-mail remetente das notificações, **domínio personalizado**, conta de pagamento (Mercado Pago), **marca d'água** (texto/intensidade), **categorias** de ensaio (gestante, newborn, casamento...), **proteção anti-cópia ativável** (toggles de botão direito/arrastar — com a honestidade de que screenshot não é bloqueável; a marca d'água é a proteção real).

**Marca d'água (detalhado, 2026-06-11):** o fotógrafo escolhe entre **texto** (padrão do sistema, ex: nome do estúdio) **ou a própria logo** (upload nas configurações, vira o carimbo repetido na diagonal). Intensidade ajustável + opção de embutir o nome da cliente. Mockups do painel do fotógrafo e da página da cliente: **APROVADOS** — início da construção autorizado pelo dono.
