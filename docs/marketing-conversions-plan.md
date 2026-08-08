# Meta e Google — rastreamento de origem e vendas

## Objetivo

Identificar de qual anúncio cada lead veio e devolver as vendas confirmadas ao Meta e ao Google, sem criar leads automaticamente a partir de qualquer conversa do WhatsApp.

## Arquitetura aprovada

1. O webhook oficial do WhatsApp captura o identificador de clique do anúncio e grava um ponto de contato separado do funil.
2. Quando o usuário cria o lead manualmente, os pontos de contato recentes do mesmo telefone são vinculados ao negócio.
3. Quando `converted_at` passa de vazio para uma data, um gatilho do banco cria eventos idempotentes de compra para Meta e Google.
4. Um worker envia a fila, com retentativa, diagnóstico e proteção contra duplicidade. Nenhuma chamada externa participa da transação da venda.
5. Telefone e e-mail são normalizados e transformados em SHA-256 somente no momento do envio. Dados pessoais brutos e tokens não entram nos logs.

## Fases

- [x] Auditar e proteger a migração das mídias para Cloudflare R2.
- [x] Criar tabelas de origem, configuração e fila de conversões.
- [x] Capturar a origem de anúncios Click-to-WhatsApp recebida pelo webhook oficial da Meta.
- [x] Enfileirar vendas feitas pelo modal ou por arrasto para uma etapa ganha.
- [ ] Aplicar a migration 066 no Supabase e validar com uma venda de teste controlada.
- [ ] Conectar Dataset/Conversions API da Meta e habilitar o worker para a conta.
- [ ] Conectar Google Data Manager API e a ação de conversão `UPLOAD_CLICKS`.
- [ ] Adicionar diagnóstico visual de integração e reprocessamento seguro de falhas.
- [ ] Validar deduplicação, consentimento e correspondência em ambiente de teste antes de ativar produção.

## Dependências externas para ativação

### Meta

- Dataset ID usado pela Conversions API.
- Token com permissão para enviar eventos ao dataset.
- Confirmação do evento e da janela de atribuição desejados.

### Google

- Customer ID da conta Google Ads proprietária da ação de conversão.
- Conversion Action ID do tipo `UPLOAD_CLICKS`.
- Projeto Google Cloud com Data Manager API habilitada e OAuth autorizado.
- Termos de dados do cliente aceitos e conversões otimizadas para leads habilitadas.

## Regra de ativação

As integrações começam desabilitadas. Só serão ligadas depois de um teste que confirme: origem capturada, evento único na fila, dados normalizados, resposta válida da plataforma e ausência de duplicação.
