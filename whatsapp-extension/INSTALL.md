# FocalPoint — Extensão Chrome para WhatsApp Web

## Instalar no Chrome

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `whatsapp-extension/`
5. A extensão aparecerá na barra do Chrome

## Configurar o token

1. Clique no ícone da extensão FocalPoint na barra do Chrome
2. Cole o token JWT do FocalPoint (Supabase auth token)
3. Clique em **Salvar configurações** — a extensão vai testar o token automaticamente

### Como obter o token
No FocalPoint, abra o DevTools (F12) → Application → Local Storage → `sb-*-auth-token`
Copie o valor de `access_token`.

> **Dica:** Em breve haverá um botão "Copiar token da API" direto no FocalPoint.

## Como usar

1. Abra [web.whatsapp.com](https://web.whatsapp.com) no Chrome
2. O painel lateral do FocalPoint aparece automaticamente no lado direito
3. Clique em qualquer conversa — o painel mostra o estágio do pipeline desse contato
4. **Mover de fase:** clique na fase desejada no painel
5. **Adicionar novo lead:** se o contato ainda não estiver no pipeline, clique em "Adicionar ao Pipeline"
6. **Anotação rápida:** escreva no campo de texto e clique em "Salvar anotação"
7. Use o botão **FP** (lateral direito da tela) para mostrar/ocultar o painel

## O que é salvo no FocalPoint

Tudo que você faz pela extensão é salvo no Supabase:
- Criação de deals (leads)
- Mudanças de fase
- Anotações

O dashboard do FocalPoint (Vendas) mostra o Kanban e as métricas — sem inbox.
