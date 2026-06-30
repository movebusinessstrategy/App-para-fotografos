# App Review — Roteiro do Screencast (reenvio de `whatsapp_business_management`)

> Objetivo: regravar o screencast que a Meta reprovou e reenviar **apenas** a permissão
> `whatsapp_business_management`. As demais (`whatsapp_business_messaging`, `public_profile`)
> já estão **aprovadas**, e a Business Verification já está **concluída**.
>
> **Motivo da reprovação (verbatim do analista, abr/2026):** "We could not verify template
> creation or management for WhatsApp Business Messaging. Please re-record showing (1) how a
> template is created or selected, (2) where it is approved or managed in your interface (or
> Meta's WhatsApp Manager), and (3) a message sent using that template to a test number."
>
> **Abordagem escolhida:** narração + legendas em **inglês**; a criação/gestão do template é
> mostrada no **WhatsApp Manager da Meta** (já em inglês); o app (PT) aparece com legendas em
> inglês explicando cada botão. Sem mudança de código.

---

## 0. Antes de gravar — checklist

- [ ] App em modo **Live** (já está "Publicado") e idioma do sistema/locale do navegador em inglês onde possível.
- [ ] Ter **1 número de teste** da Meta (WhatsApp Manager → API Setup → "To") e **1 número de destino** cadastrado na allowed list (até 5).
- [ ] Estar logado no app (CRM Trilha) como dono de estúdio.
- [ ] Ter o **WhatsApp Manager** da conta aberto numa aba (business.facebook.com/wa/manage/).
- [ ] Gravar em **inglês** (legendas + narração). Resolução boa, cursor visível, sem cortes que escondam a UI.
- [ ] Duração alvo: **2 a 4 minutos**.

> Observação de nome: o app no painel Meta se chama **fotoMove** (rebrand para **CRM Trilha**).
> Na narração usamos "CRM Trilha"; se quiser evitar qualquer dúvida do revisor, diga uma vez
> "our app, internally registered as fotoMove".

---

## 1. Storyboard (ordem das cenas)

| Cena | O que aparece na tela | Permissão evidenciada | Caption (inglês) |
|---|---|---|---|
| 1 | Tela inicial/login do CRM Trilha | contexto | "CRM Trilha — CRM for photographers (Tech Provider)" |
| 2 | Configurações → Integração WhatsApp → "Conectar" → popup do Embedded Signup (login Facebook, escolher portfólio/WABA/número, conceder permissões) → número conectado | login Meta + concessão de acesso | "Settings → WhatsApp Integration → Connect"; "Meta login & granting permissions" |
| 3a | WhatsApp Manager → Message Templates → **Create template** (nome, categoria Utility, corpo com variável) → Submit | `whatsapp_business_management` (criar) | "Meta WhatsApp Manager — create template" |
| 3b | Lista de templates com status **Pending → Approved** | `whatsapp_business_management` (gerenciar/aprovar) | "Template submitted → Approved" |
| 3c | App → tela de Templates → **Sincronizar** (lê os templates via API e mostra status) | `whatsapp_business_management` (ler/gerenciar via API) | "Our app reads/manages templates via API (Sync)" |
| 4 | App → escolher o template aprovado → **enviar para número de teste** → mensagem chegando no celular de teste | `whatsapp_business_messaging` (enviar) | "Send approved template → test number"; "Delivered via Cloud API" |
| 5 | (Pode narrar sobre a tela do app) nota server-to-server | esclarecimento | "Note: token exchange & template API calls run server-to-server" |

---

## 2. Narração (inglês) — cena a cena

> Leia/encaixe o áudio (gerado em separado) sobre a gravação da tela. As frases entre
> `[ON SCREEN: ...]` são indicações do que mostrar, **não** são lidas.

**Cena 1 — Intro**
`[ON SCREEN: app dashboard/login of CRM Trilha]`
> "Hello. This is CRM Trilha, a customer-relationship platform for professional photographers. We act as a Technology Provider on the WhatsApp Business Platform. In this video, we demonstrate how our app uses the WhatsApp Business Management permission to create and manage WhatsApp message templates on behalf of a business, and the WhatsApp Business Messaging permission to send a message using that template."

**Cena 2 — Login da Meta + concessão de acesso (Embedded Signup)**
`[ON SCREEN: Settings → WhatsApp Integration → click Connect → Meta Embedded Signup popup → Facebook login → choose business/WABA/number → review & grant permissions → finish → connected number appears]`
> "First, the business owner connects their WhatsApp Business account. In our app, they open Settings, then WhatsApp Integration, and click Connect. This launches Meta's Embedded Signup. The business logs in with Facebook and grants our app access. Here you can see the permissions being granted, including WhatsApp Business Management and WhatsApp Business Messaging. After finishing, the connected number appears in our app."

**Cena 3 — Criar e gerenciar um template (o ponto da reprovação)**
`[ON SCREEN: Meta WhatsApp Manager → Message Templates → Create template → name, Utility category, body with a {{1}} variable → Submit]`
> "Now, template management, which uses WhatsApp Business Management. I'll open the WhatsApp Manager for this account, go to Message Templates, and create a new template. I name it, choose the Utility category, write the body with a variable, and submit it for review."
`[ON SCREEN: template list showing status Pending, then Approved]`
> "The template is submitted and, once reviewed by Meta, its status becomes Approved. This is exactly the create-and-manage flow our app performs through the API on behalf of the business."
`[ON SCREEN: switch to our app → Templates screen → click Sync]`
> "Back in our app, the Templates screen reads the same templates from the WhatsApp Business account using WhatsApp Business Management. When I click Sync, the app fetches the template list and shows each template with its approval status."

**Cena 4 — Enviar usando o template para um número de teste**
`[ON SCREEN: our app → select the approved template → send to test number]`
> "Finally, using WhatsApp Business Messaging, the app sends a message built from that approved template to a test number."
`[ON SCREEN: the test phone receiving the templated message]`
> "Here is the message arriving on the test phone, delivered through the Cloud API."

**Cena 5 — Nota server-to-server (exigida pelo feedback)**
`[ON SCREEN: app screen, no special action]`
> "One note for the review: the access-token exchange and the template-management API calls are performed server-to-server from our backend, so part of that authentication is not visible in the front-end. The Meta Embedded Signup login shown earlier is the front-end authorization step. Thank you for reviewing."

---

## 3. Texto para o reenvio (colar no painel)

**Use case description / Notes to reviewer (inglês):**

> CRM Trilha (a CRM for professional photographers; app registered as "fotoMove") is a
> Technology Provider on the WhatsApp Business Platform. This new screencast addresses the
> previous feedback and demonstrates the complete `whatsapp_business_management` use case:
> (1) Meta login and permission grant via Embedded Signup; (2) creating and managing a
> message template — shown in Meta's WhatsApp Manager for the connected WhatsApp Business
> Account; (3) the same template being read and managed inside our app through the API; and
> (4) a message sent using that approved template to a test number, delivered via the Cloud
> API. Note: token exchange and template-management API calls are performed server-to-server
> from our backend; the front-end authorization is the Embedded Signup login shown at the
> start. The app UI is in Portuguese; English narration and on-screen captions explain each
> step and button.

---

## 4. Receita de gravação (Mac, sem instalar nada)

1. **Gravar a tela:** QuickTime Player → Arquivo → Nova Gravação de Tela (ou `Shift+Cmd+5`). Grave em silêncio, executando os passos do storyboard na ordem.
2. **Áudio da narração:** use o arquivo de locução em inglês gerado pelo Claude (MP3/WAV).
3. **Juntar áudio + vídeo:** iMovie → importar a gravação → arrastar o MP3 da narração para a trilha de áudio → alinhar com as cenas (nudge) → exportar.
4. **Legendas (inglês):** no iMovie, use "Títulos" sobre cada cena com os textos da coluna *Caption* acima (ou queime as legendas no vídeo).
5. **Exportar:** Arquivo → Compartilhar → Arquivo, 1080p. Súbam esse MP4 no reenvio.

---

## 5. Como reenviar (no painel Meta)

1. `Casos de uso → Personalizar → Permissões e recursos` → linha `whatsapp_business_management` → **Ações → Ir para a análise do app** (a nova solicitação já está em "Não enviado").
2. Anexar o **screencast** novo, preencher a **descrição de uso** (texto da seção 3) e responder o feedback.
3. Clicar em **Avançar** e enviar **somente** `whatsapp_business_management` (não reabrir as já aprovadas sem necessidade).
4. Prazo típico: 3–7 dias úteis. Cada reprovação reinicia o relógio — por isso o vídeo precisa cobrir exatamente os 3 pontos do analista.
