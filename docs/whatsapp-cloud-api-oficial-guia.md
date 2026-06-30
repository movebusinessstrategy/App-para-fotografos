# WhatsApp Cloud API Oficial — Guia de Migracao (Tech Provider / Embedded Signup)

> Documento de referencia do CRM Trilha. Versao da Graph API de referencia: **v23.0** (em jun/2026 a estavel mais recente e v25.0; o codigo atual usa v21.0 no envio). Fixe uma versao no codigo e revise no changelog. Onde a doc nao fechou um dado, esta marcado **"confirmar na doc/painel"**.

---

## 1. Resumo executivo

O **caminho oficial** para o CRM Trilha mandar e receber WhatsApp em nome dos fotografos e sermos nos mesmos um **Tech Provider** da Meta: um unico App Meta tipo Business que, via **Embedded Signup**, embarca cada fotografo (cria/conecta a WABA e o numero dele) e passa a operar a **Cloud API** em nome de cada um. **Nao usamos BSP** (Twilio, 360dialog, Infobip etc.) — somos o proprio provedor.

**O codigo ja esta pronto.** A integracao Cloud API foi implementada e depois pausada — nao por falta de codigo, e sim pelo desgaste com o App Review (ver `MEMORY.md`). Ja existem:
- Embedded Signup v4 no front: `src/pages/configuracoes/IntegracaoWhatsApp.tsx`
- Seletor de numero/WABA: `src/pages/configuracoes/PhoneNumberPicker.tsx`
- Gerenciador de templates: `src/components/settings/WhatsAppTemplatesManager.tsx`
- Backend completo em `server.ts`: `/api/meta/whatsapp/exchange-token`, `/available-numbers`, `/select-number`, `/refresh-token`, `/status`, `/diag`, `/disconnect`, `/subscribe-webhook`, `/templates`, `/templates/sync`
- Webhook unificado com validacao HMAC: `POST /api/whatsapp/webhook`
- Cripto de token AES-256-GCM: `lib/wa-token-crypto.ts`
- Tabela `whatsapp_business_accounts` (token encriptado, `mode`, `phone_number_id`, `waba_id`)

**O UNICO gargalo real e burocratico, nao tecnico:** passar no **App Review com Advanced Access** das permissoes `whatsapp_business_messaging` e `whatsapp_business_management`, tendo antes concluido a **Business Verification**. Tudo o mais (Embedded Signup, troca de code por token, subscribe, register, envio) ja existe no codigo e e so questao de virar a chave `WHATSAPP_PROVIDER=meta`.

Detalhe atual da WABA de teste (Pitori): esta `APPROVED`, com negocio verificado, billing com cartao e `subscribed`, **mas** `platform_type=ON_PREMISE`, `code_verification_status=NOT_VERIFIED` e `status=DISCONNECTED`. Isso indica que **falta concluir o registro do numero na Cloud API** (o `/register`) e/ou re-onboardar pelo Embedded Signup com a permissao Advanced ja concedida — ver secao 8.

---

## 2. Os dois caminhos (e qual escolher)

### 2.1 Tech Provider (self-serve) vs Solution Partner (BSP)

| | **Tech Provider** (recomendado) | **Solution Partner / BSP** |
|---|---|---|
| Aprovacao | Self-serve: voce faz sozinho (Business Verification + App Review) | Exige parceria/aprovacao formal da Meta (nao e self-serve) |
| Linha de credito | **Nao tem.** Cada fotografo poe o proprio cartao; a Meta cobra o fotografo direto pelo uso da API | Tem linha de credito; pode faturar o cliente direto pelo uso do WhatsApp |
| Onboarding | Embedded Signup (multi-tenant) sob o seu unico App | Tambem Embedded Signup, com `solutionID` |
| Voce cobra | Apenas o software/servico (assinatura do CRM) | Pode cobrar tambem o trafego de mensagens |

**Recomendacao: Tech Provider.** E exatamente o que o usuario quer (sem intermediario) e o que o codigo ja implementa. A unica consequencia pratica e que **cada fotografo precisa cadastrar o proprio cartao** no fluxo do Embedded Signup, e a Meta cobra ele direto pelo trafego (ver secao 7). Virar BSP so faz sentido se um dia quisermos absorver/repassar a cobranca do WhatsApp — mais burocratico e desnecessario agora.

> Nota: "Tech Partner" = um Tech Provider que tambem virou Meta Business Partner (ganha beneficios e o SMB Accelerator). O caminho tecnico e identico ao do Tech Provider. O antigo **"Access verification" foi REMOVIDO** (2025) — ignore tutoriais de 2023/2024 que mandam passar por ele. Hoje os gates sao so **Business Verification + App Review**.

### 2.2 Modo `cloud_api` puro vs Coexistence

| | **cloud_api puro** | **Coexistence** |
|---|---|---|
| Onde o numero fica | Sai do celular: registrado na Cloud API; o app WhatsApp Business deixa de funcionar (tipicamente migra-se para numero novo) | **Continua no celular.** O fotografo segue respondendo 1:1 pelo app e usa a API em paralelo, com historico sincronizado |
| Etapa `/register` | Obrigatoria (com PIN) | **Pulada** — o numero ja esta registrado pelo app |
| `platform_type` | `CLOUD_API` | `CLOUD_API` + `is_on_biz_app=true` |
| Mensagens pelo app | N/A | **Gratis** e fora da janela de cobranca da API |
| Throughput | Escala mais (tiers) | Fixo em **20 mps** |
| Limitacoes | Sem | Sem grupos/broadcast/catalogo via API; historico so 180 dias; sincronizacao tem janela de 24h; rollout regional faseado |

**Recomendacao para fotografos: Coexistence.** Fotografo nao quer perder o numero do celular nem o app — ele atende cliente na mao. Coexistence deixa o numero vivo no celular, a Lia automatiza pela API e o historico fica sincronizado. O codigo ja suporta os dois modos (campo `mode` na tabela e selecao no `IntegracaoWhatsApp.tsx`).

**Atencao (Coexistence):**
- Requer app WhatsApp Business **2.24.17+** no celular do fotografo.
- **Disponibilidade regional faseada** — confirmar elegibilidade do Brasil/numero antes de prometer ao fotografo (**confirmar na doc/painel**).
- Apos onboard, **24h** para rodar a sincronizacao de contatos e historico (senao offboard + refazer).
- Embedded Signup v2 e descontinuado em **15/out/2026** — usar v4 (ja e o caso).

---

## 3. Pre-requisitos (checklist)

- [ ] **App Meta tipo Business**, categoria **Messaging**, com o produto WhatsApp e o produto **Facebook Login for Business** adicionados. (Ja existe: `META_APP_ID=1258847249782852`.)
- [ ] **Icone 1024x1024**, **politica de privacidade** e **termos de servico** publicos, carregando rapido, com nome/contato da empresa e **mencao explicita aos dados coletados via APIs da Meta/WhatsApp** (a privacy policy e um "silent killer" de reprovacao).
- [ ] **Business Portfolio / Meta Business Account** verificado e vinculado ao App.
- [ ] **Business Verification CONCLUIDA** (ver secao 4). No Brasil: cartao CNPJ, Contrato Social ou CCMEI (MEI) + conta de utilidade/extrato bancario comercial; dados **identicos** aos do Business Manager. Prazo ~10 min a 14 dias uteis. (Historico: ja foi feito para a conta de teste.)
- [ ] **Dominio custom HTTPS** em `App Domains` e `Valid OAuth Redirect URIs`. **`.vercel.app` e bloqueado** (assim como github.io, herokuapp.com, netlify.app) por ser sufixo publico compartilhado. Por isso `crmtrilha.com.br` ja foi configurado — usar esse dominio no front do Embedded Signup.
- [ ] **Configuration do Facebook Login for Business** gerando o `config_id`. (Ja existe: `META_WA_CONFIG_ID=1690598005448884`.)
- [ ] **Billing**: cada fotografo adiciona o proprio cartao a conta dele no fluxo do Embedded Signup. Tech Provider nao tem linha de credito.
- [ ] **App Review aprovado** com Advanced Access nas 2 permissoes (secao 4).

---

## 4. App Review — o gargalo, destrinchado

### 4.1 Permissoes que precisam de Advanced Access (nomes exatos)

- **`whatsapp_business_messaging`** — enviar/receber mensagens e midia, gerenciar perfil, registrar numero. Necessaria com Advanced porque enviamos/recebemos **em nome de clientes** (todo SaaS multi-tenant exige).
- **`whatsapp_business_management`** — ler/gerenciar WABAs, numeros, templates, QR codes e assinaturas de webhook de **WABAs que nao sao nossas**. Sem Advanced, chamadas de management contra WABAs de terceiros retornam **erro/codigo 200** (parece bug de codigo, mas e falta de acesso).

> So peca essas duas. **Nao adicione `business_management` "por seguranca"** se nao for gerenciar ad accounts/portfolio de terceiros — pedir permissao a mais reprova.

**Regra-chave:** com **Standard Access** o App so opera contra numeros/WABAs do proprio negocio e usuarios com role no App (serve para teste). **Multi-cliente em producao SEMPRE exige Advanced Access.** Sem Advanced, a permissao **nem aparece** no fluxo de Embedded Signup e o fotografo nao consegue concede-la (o onboarding falha silenciosamente nesse ponto).

### 4.2 O que a Meta exige no review

Por permissao:
1. **Descricao de uso detalhada** — identifique-se como **"Solution Partner ou Technology Provider"** e explique por que precisa enviar/receber mensagens (messaging) e gerenciar numeros/templates dos clientes (management).
2. **Screencast (video) com narracao**, demonstrando o fluxo **real** na UI, **na perspectiva do NEGOCIO** (nao do consumidor), com **dados reais** (sem telas mock).
3. **App testavel** (nao em modo Development "vazio"). So coloque o App em **Live apos a aprovacao**.

### 4.3 Motivos comuns de rejeicao e como evitar

| Motivo | Como evitar |
|---|---|
| Screencast confuso, sem narracao, com telas mock, na perspectiva do consumidor | Grave na perspectiva do negocio, com narracao, mostrando dados reais e o fluxo de cada permissao (ver 4.6). O reviewer **nao** explora seu app sozinho — o video e a referencia primaria |
| Politica de privacidade ausente/lenta/generica | Publica, rapida, com nome/contato e mencao explicita aos dados via APIs Meta/WhatsApp |
| Pedir permissoes alem do necessario | Peca so as 2 do WhatsApp e justifique cada uma |
| Justificativa vaga | Texto, UI e video deixando obvio **por que** cada permissao e necessaria |
| App em modo Development na hora do review | Deixe testavel; va a Live so depois da aprovacao |
| Business Verification nao concluida | Conclua **antes** — bloqueia a concessao de Advanced |
| Chatbot de proposito geral (mudanca de politica out/2025) | A Lia deve ser claramente um **assistente de atendimento do proprio negocio**, nao um chatbot generico. Reflita isso na descricao de uso |

> Cada rejeicao **reinicia o relogio** (+3-5 dias por tentativa). Vale acertar de primeira.

### 4.4 Prazo tipico e ordem

- **Business Verification:** ~10 min a 14 dias uteis (planeje folga; ha relatos de 10+ dias travando o review).
- **App Review (Advanced Access):** ~3-7 dias uteis (padrao 2-4, avancado 4-7).

**Ordem correta: Business Verification ANTES do App Review.** A Meta nao finaliza a concessao de Advanced Access sem o negocio verificado. Alem disso, o botao **"Request advanced access" so libera apos pelo menos 1 chamada de API bem-sucedida** com a permissao, feita **dentro dos 30 dias** anteriores ao envio. Sequencia:
1. App Business + categoria Messaging + privacy/terms + produto WhatsApp
2. **Business Verification concluida**
3. Fazer 1 chamada de teste de cada permissao (numero de teste serve)
4. `App Review > Permissions and Features > Request Advanced Access` nas 2 permissoes
5. Preencher descricao + subir screencast + submeter
6. **So apos aprovacao**: App em modo **Live** e iniciar onboarding real via Embedded Signup

### 4.5 Onde fica no painel

`App Dashboard > Use cases > Customize` (lapis no caso de uso WhatsApp) `> Tech Provider onboarding` reune os passos (verificar negocio, App Review, webhooks). O App Review em si fica em `App Review > Permissions and Features` (clicar **"Begin App Review"** / "Request Advanced Access").

### 4.6 Como gravar o screencast do nosso fluxo (concreto)

Grave a tela do CRM Trilha, com **narracao em portugues ou ingles**, mostrando:

1. **Login no CRM** como dono de estudio (perspectiva do negocio).
2. Ir em **Configuracoes > Integracao WhatsApp** (`IntegracaoWhatsApp.tsx`).
3. Clicar em **Conectar WhatsApp** → abre o popup do **Embedded Signup** da Meta. Narrar: "Aqui o fotografo conecta a propria conta WhatsApp Business; usamos `whatsapp_business_management` para acessar a WABA e os templates dele."
4. Concluir o onboarding e mostrar o **numero/WABA aparecendo** no `PhoneNumberPicker.tsx`. Narrar a chamada de management (listar `phone_numbers`, subscribe).
5. Abrir a tela de conversas e **enviar uma mensagem real** para um numero de teste, e **receber a resposta** chegando via webhook. Narrar: "Aqui usamos `whatsapp_business_messaging` para enviar e receber em nome do negocio."
6. Opcional mas forte: mostrar a **criacao/sync de um template** em `WhatsAppTemplatesManager.tsx` (evidencia de management).

Cobre as duas permissoes com fluxo real, ponta a ponta. Evite cortes que escondam a UI; mostre dados reais.

---

## 5. Fluxo tecnico ponta a ponta (mapeado ao nosso codigo)

| # | Etapa | Endpoint Meta (v23.0) | Onde ja esta no nosso codigo | Status |
|---|---|---|---|---|
| 1 | Lancar Embedded Signup | `FB.login(cb, { config_id: <VITE_META_WA_CONFIG_ID>, response_type:'code', override_default_response_type:true, extras:{ sessionInfoVersion:'3', ... } })` | `src/pages/configuracoes/IntegracaoWhatsApp.tsx` | **Pronto** (v4, modos cloud_api e coexistence) |
| 2 | Capturar `code` + IDs | `code` em `response.authResponse.code`; IDs (`phone_number_id`, `waba_id`, `business_id`) via `window` message `WA_EMBEDDED_SIGNUP` (`FINISH` / no Coexistence `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) | `IntegracaoWhatsApp.tsx` (listener) | **Pronto** |
| 3 | Trocar code por token (server-to-server) | `GET /v23.0/oauth/access_token?client_id=&client_secret=&code=` → Business Integration System User token | `POST /api/meta/whatsapp/exchange-token` (descobre WABA via `debug_token`, encripta token) | **Pronto** |
| 4 | Guardar token encriptado | — | tabela `whatsapp_business_accounts` + `lib/wa-token-crypto.ts` (AES-256-GCM) | **Pronto** |
| 5 | Listar/escolher numero | `GET /v23.0/{waba_id}/phone_numbers` (campo `id` = `phone_number_id`) | `GET /api/meta/whatsapp/available-numbers` + `POST /select-number` + `PhoneNumberPicker.tsx` | **Pronto** |
| 6 | Assinar app aos webhooks da WABA | `POST /v23.0/{waba_id}/subscribed_apps` (opcional `override_callback_uri` + `verify_token`) | `POST /api/meta/whatsapp/subscribe-webhook` | **Pronto** |
| 7 | **Registrar numero** (so `cloud_api`; **pular** no Coexistence) | `POST /v23.0/{phone_number_id}/register` body `{messaging_product:"whatsapp", pin:"<6 digitos>"}` | `server.ts:15502` (em `exchange-token`) e `server.ts:15693` (em `select-number`); pula no coexistence (`server.ts:15500`) | **Existe, COM RESSALVA**: envia **PIN fixo `000000`** (`server.ts:15512`). Funciona so para numero **sem** 2FA; numero **com** verificacao em duas etapas **falha** e fica `ON_PREMISE`/`NOT_VERIFIED`. Migrar numero com 2FA → coletar PIN real ou desativar 2FA antes |
| 8 | Verificar webhook (GET) + receber eventos (POST) | sua Callback URL: GET ecoa `hub.challenge`; POST valida `X-Hub-Signature-256` (HMAC-SHA256 do raw body com App Secret) | `POST /api/whatsapp/webhook` (HMAC via `META_APP_SECRET`; trata Meta + Baileys) | **Pronto** |
| 9 | Enviar mensagem | `POST /v23.0/{phone_number_id}/messages` | `/api/inbox/send` e `/api/inbox/send-media` (tenta Meta em `graph.facebook.com/v21.0/...`, cai pra Baileys) | **Pronto** (subir versao para v23.0+) |
| 10 | Coexistence: sincronizar contatos/historico | `POST /{phone_number_id}/smb_app_data` (`sync_type:"smb_app_state_sync"` e `"history"`) + webhooks `history`, `smb_app_state_sync`, `smb_message_echoes` | **AUSENTE** no `/api/whatsapp/webhook` | **Falta implementar** se adotarmos Coexistence (handlers dos 3 webhooks + chamada `/smb_app_data`) |

**O que ja temos:** todo o fluxo cloud_api puro (Embedded Signup → token → subscribe → enviar/receber) e a base do Coexistence (modo selecionavel no front).
**Confirmado no codigo (jun/2026):**
- (a) O `/register` **existe** (`server.ts:15502`/`:15693`) mas manda **PIN fixo `000000`** (`server.ts:15512`). Ok para numero novo sem 2FA; **falha** para numero com verificacao em duas etapas (sintoma exato do `ON_PREMISE`/`NOT_VERIFIED`). Correcao futura: receber o PIN real do fotografo no fluxo, ou orientar a desativar a 2FA antes de conectar. No Coexistence isso e irrelevante (register e pulado).
- (b) Os handlers dos webhooks de Coexistence (`history`, `smb_app_state_sync`, `smb_message_echoes`) e a chamada `/smb_app_data` **NAO existem** no `/api/whatsapp/webhook` — precisam ser implementados **se** adotarmos Coexistence. O modo ja e selecionavel no front e o register ja e pulado, mas a sincronizacao de historico/contatos ainda nao seria recebida.

> Tokens: o token da troca e um **Business Integration System User token** (escopado por cliente, **nao expira**). Nao ha refresh_token estilo OAuth2; se um dia usarmos tokens de 60 dias, re-trocar via `grant_type=fb_exchange_token` **antes** de expirar — depois de expirado, o fotografo refaz o Embedded Signup. O `POST /api/meta/whatsapp/refresh-token` ja cobre esse caso.

---

## 6. Webhooks, templates, janela de 24h e envio (pratico)

**Webhooks.** Payload sempre `object="whatsapp_business_account" → entry[] → changes[] (field, value)`. Campos que importam: `messages` (recebidas + `statuses` de envio: sent/delivered/read/failed), `message_template_status_update`, `account_update` (evento `PARTNER_REMOVED` = offboard no Coexistence), `phone_number_quality_update`. Tres cuidados criticos: (1) valide `X-Hub-Signature-256` sobre o **raw body** (re-serializar JSON quebra o hash); (2) responda **HTTP 200 rapido** e processe assincrono — sem 200, a Meta retenta por ate 7 dias; (3) trate **idempotencia pelo `wamid`** — webhooks duplicados sao esperados. Tudo isso ja esta no `POST /api/whatsapp/webhook`.

**Templates.** Toda mensagem **fora** da janela de 24h tem que ser **template aprovado**. Categorias: **MARKETING** (sempre cobrada), **UTILITY** (gratis dentro da janela, cobrada fora), **AUTHENTICATION** (OTP, sempre cobrada). Regra de ouro: qualquer trecho promocional → vira MARKETING. Criar via `WhatsAppTemplatesManager.tsx` / `POST /v23.0/{waba_id}/message_templates` (exemplo obrigatorio para cada `{{1}}`). Rejeicoes comuns: `INVALID_FORMAT` (variavel no inicio/fim, adjacentes, fora de ordem, sem exemplo) e `TAG_CONTENT_MISMATCH` (categoria/idioma nao batem).

**Janela de 24h.** Abre quando o **cliente** manda mensagem (inclui responder a um template); cada nova mensagem dele reinicia o timer. **Dentro**: mensagem livre de qualquer tipo (texto, midia, interativa). **Fora**: so template. Erro classico ao enviar fora da janela: **131047** (re-engagement → use template). No Coexistence, mensagens enviadas pelo **app** nao abrem/estendem a janela nem entram na cobranca da API.

**Envio.** `POST /v23.0/{phone_number_id}/messages`, sempre `messaging_product:"whatsapp"`, `to` em E.164 **sem `+`** (Brasil: `5511999999999`). Guarde `messages[0].id` (wamid) para casar com os webhooks de status. Erros frequentes: **190** (token), **133010** (numero nao registrado → falta `/register`), **131030** (destinatario fora da allowed list — so em numero de teste, max 5), **100** (corpo malformado). Brasil/Mexico: sempre enviar com codigo de pais para evitar entrega ao numero errado.

---

## 7. Precos (atual, 2025/2026)

Desde **01/07/2025** a cobranca e **por mensagem (template) entregue**, nao mais por conversa de 24h. Cobra-se conforme a **categoria** e o **DDI do destinatario**, e so quando o template e **entregue (delivered)**.

- **MARKETING** — sempre cobrada, **sem desconto por volume**.
- **UTILITY** — **gratis dentro** de uma janela de 24h aberta pelo cliente; **cobrada fora** da janela. Tem tiers de volume.
- **AUTHENTICATION** — OTP, sempre cobrada. Tem tiers de volume.
- **SERVICE (free-form dentro da janela)** — **gratis e sem aprovacao** (conversas de servico gratis e ilimitadas desde 01/11/2024).
- **FREE ENTRY POINTS** — anuncio Click-to-WhatsApp (FB/IG) e CTA de WhatsApp na Pagina abrem **72h gratis para tudo** (inclusive marketing), a contar da 1a resposta entregue.

**Brasil (tarifas Meta de atacado em USD, antes de markup):**
- Marketing ~**US$0,0625**/msg.
- Utility a partir de **US$0,0068** (cai ate ~US$0,0054 acima de 10M/mes).
- Authentication a partir de **US$0,0105** (cai ate ~US$0,0086 acima de 35M/mes).
- Service = **gratis**.

> Como somos **Tech Provider** (sem BSP), o fotografo paga **a tarifa de atacado da Meta direto, em USD**, no cartao dele — **sem markup de BSP**. Faturamento BRL local so a partir de **01/07/2026** e apenas para elegiveis com Sold-To Brasil. Ate la, e USD (cambio afeta o custo real).

**Implicacao pratica para um fotografo:** o volume e baixo (dezenas/centenas de conversas/mes). Se a operacao for majoritariamente **atendimento dentro da janela de 24h** (cliente puxa a conversa, Lia responde free-form) e **lembretes UTILITY dentro da janela**, o custo tende a **~R$0** ou centavos. O custo so aparece quando ha **reengajamento fora da janela** (template UTILITY cobrado) ou **disparo MARKETING** (~US$0,06/msg). Para o caso de uso do CRM Trilha (atendimento + funil), o custo de WhatsApp e marginal — o gargalo continua sendo o App Review, nao o preco.

---

## 8. Plano de acao passo a passo (sair do Baileys → Cloud API oficial)

### Fase A — Painel Meta (o USUARIO faz)
1. Confirmar **Business Verification** ainda valida no Business Manager (Centro de Seguranca). Se cair, refazer com CNPJ/Contrato Social/CCMEI batendo com os dados do Business Manager.
2. Garantir **App Domains** e **Valid OAuth Redirect URIs** apontando para `crmtrilha.com.br` (HTTPS), nunca `.vercel.app`.
3. Confirmar **privacy policy/terms** publicos e a politica mencionando dados via APIs Meta/WhatsApp.
4. Fazer **1 chamada de API de teste** de cada permissao (com numero de teste) para liberar o botao de Advanced Access.
5. `App Review > Request Advanced Access` em **`whatsapp_business_messaging`** e **`whatsapp_business_management`**; preencher descricao (identificar-se como Technology Provider) e subir o **screencast** (secao 4.6). Submeter.
6. Aguardar aprovacao. **So entao** colocar o App em **Live**.

### Fase B — Config de ambiente (envs / Render)
7. Confirmar setadas: `META_APP_ID`, `META_APP_SECRET`, `META_WA_CONFIG_ID`, `VITE_META_APP_ID`, `VITE_META_WA_CONFIG_ID`, `WA_TOKEN_ENCRYPTION_KEY`, `WA_WEBHOOK_VERIFY_TOKEN`, `WA_WEBHOOK_VERIFY_SIGNATURE`.
8. Cadastrar a **Callback URL** do webhook (`https://crmtrilha.com.br/api/whatsapp/webhook` ou equivalente em producao) + `WA_WEBHOOK_VERIFY_TOKEN` em `App Dashboard > WhatsApp > Configuration` e **assinar os campos** (`messages`, `message_template_status_update`, e no Coexistence `history`, `smb_app_state_sync`, `smb_message_echoes`, `account_update`).
9. **Ativar o provider:** `WHATSAPP_PROVIDER=meta` no Render (hoje esta `baileys`). Sugestao: rollout gradual (por conta/feature flag) antes de virar global.
10. Manter a versao da Graph API consistente — subir o envio de **v21.0 → v23.0** (ou a estavel atual) em `/api/inbox/send` e `/api/inbox/send-media`.

### Fase C — Codigo (ja pronto / verificar)
11. **Pronto:** Embedded Signup, `exchange-token`, `available-numbers`/`select-number`, `subscribe-webhook`, webhook com HMAC, envio com fallback, templates, cripto de token.
12. **Verificar/completar:** que existe uma chamada **`POST /{phone_number_id}/register`** (com PIN) no modo `cloud_api` — o estado `code_verification_status=NOT_VERIFIED` + `platform_type=ON_PREMISE` da conta de teste indica que isso **nao foi concluido**. No Coexistence, **pular** o register.
13. **Verificar (se usar Coexistence):** handlers dos webhooks `history`, `smb_app_state_sync`, `smb_message_echoes` e da chamada `/smb_app_data` no `/api/whatsapp/webhook`.

### Plano de validacao / teste
14. **Numero de teste primeiro:** com o App em Live e Advanced Access concedido, rodar o Embedded Signup numa conta de teste (desktop — o ES nao funciona em mobile). Cadastrar ate 5 destinatarios na allowed list.
15. Conferir via `GET /api/meta/whatsapp/diag` (ou `GET /v23.0/{phone_number_id}?fields=platform_type,is_on_biz_app,code_verification_status,status`) que o numero esta **`platform_type=CLOUD_API`** (e `is_on_biz_app=true` se Coexistence), `code_verification_status=VERIFIED`, `status=CONNECTED`.
16. **Enviar e receber** uma mensagem real; verificar webhooks `messages` chegando com assinatura HMAC valida e os `statuses` (sent/delivered/read).
17. **Numero real:** repetir com o numero de producao de um fotografo piloto. No modo cloud_api, executar o `/register` com PIN; no Coexistence, validar a sincronizacao de historico dentro das 24h.
18. So depois de validado, virar `WHATSAPP_PROVIDER=meta` para mais contas.

---

## 9. Riscos e decisoes em aberto

- **Coexistence vs cloud_api (decisao):** Coexistence e o melhor encaixe (numero fica no celular), **mas** tem rollout regional faseado — **confirmar elegibilidade do Brasil/numero** antes de prometer (**confirmar na doc/painel**), throughput fixo de 20 mps, janela de 24h para sincronizar e v2 morrendo em 15/out/2026. Mitigacao: usar v4 (ja e o caso), oferecer cloud_api puro como fallback para quem aceita numero novo.
- **App Review reprovar de novo (risco principal):** ja foi o motivo da pausa. Mitigacao: acertar de primeira com screencast real e narrado (secao 4.6), privacy policy correta, descricao se identificando como Technology Provider, **so as 2 permissoes**, App em Live so apos aprovacao, e deixar claro que a Lia e assistente de atendimento do negocio (nao chatbot generico — politica de out/2025).
- **Estado `ON_PREMISE`/`NOT_VERIFIED` da conta de teste:** sintoma de `/register` nao concluido. Decisao: se o destino for Coexistence, isso e irrelevante (register e pulado e o `platform_type` vira CLOUD_API pelo proprio app); se for cloud_api puro, **completar o `/register` com PIN** e checar.
- **Custo (baixo risco):** modelo per-message, em USD ate jul/2026; para o volume de um fotografo, tende a centavos/R$0 se a operacao ficar dentro da janela de 24h. Risco real e so se houver disparo de marketing em massa.
- **Cap de numeros e WABA com 2 parceiros:** novo portfolio comeca com cap de 2 numeros (sobe para 20 apos verificacao). Uma WABA so pode ter **2 parceiros** — se o fotografo ja tem outro provedor, pode bloquear/exigir migracao.
- **Versao da Graph API:** envio ainda em v21.0 enquanto o resto referencia v23.0+. Mitigacao: padronizar a versao e revisar o changelog periodicamente.

---

**Arquivos de referencia no repo:** `src/pages/configuracoes/IntegracaoWhatsApp.tsx`, `src/pages/configuracoes/PhoneNumberPicker.tsx`, `src/components/settings/WhatsAppTemplatesManager.tsx`, `lib/wa-token-crypto.ts`, `server.ts` (rotas `/api/meta/whatsapp/*` e `/api/whatsapp/webhook`).
