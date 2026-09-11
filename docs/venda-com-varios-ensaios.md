# Venda com vários ensaios e desconto explícito

Implementação local. A migração e a aplicação ainda não foram publicadas no CRM oficial.

Ao fechar uma venda, o operador pode adicionar outros ensaios e dividir o valor bruto entre eles. O primeiro recebe o saldo dessa divisão. Cada ensaio cria um trabalho próprio, com etapa de produção, data e vínculo de contrato independentes. A opção “Definir data depois” permite deixar o newborn aguardando o nascimento.

O campo “Desconto da venda (R$)” aparece no cadastro, no fechamento e na edição da venda; também pode ser alterado no financeiro do trabalho. O desconto e o sinal são distribuídos proporcionalmente entre os ensaios, preservando os centavos. Extras continuam ligados apenas ao trabalho em que foram adicionados.

Exemplo verificado: venda de R$ 2.500, desconto de R$ 300, gestante de R$ 1.000 e newborn de R$ 1.500. Resultado: uma venda de R$ 2.200 e dois trabalhos de R$ 880 e R$ 1.320. Um sinal de R$ 500 é distribuído em R$ 200 e R$ 300, sem duplicar recebimento.

## Compatibilidade

- Vendas existentes não são divididas automaticamente.
- O vínculo antigo `converted_job_id` continua apontando para o primeiro trabalho; os demais usam `jobs.deal_id`.
- A emissão de cada contrato continua no fluxo existente do respectivo trabalho. O fechamento não emite nem envia contratos automaticamente.
- Uma venda com vários ensaios é cancelada pela venda inteira. Contratos e pagamentos são preservados no histórico. Exclusão ou cancelamento isolado de um desses trabalhos é bloqueado para evitar perda do vínculo financeiro.
- Clientes antigos da API continuam usando a conversão anterior quando não enviam `sessions`.

## Validação realizada

- 18 testes de valores, rateio, validação de agenda e confirmação de sincronização com calendário.
- PostgreSQL temporário com dados fictícios: migração executada duas vezes, criação com todos os itens e desconto, conversão repetida sem duplicação, isolamento entre contas, produção e contratos independentes, extras, cancelamento e rollback integral quando falha a criação do segundo trabalho.
- Formulário real em prévia com API simulada: envio dos dois ensaios, desconto acima do total bloqueado e revisão visual a 390 × 844, sem campos fora da tela.
- Build de produção e verificação TypeScript do aplicativo. A verificação global inclui cópias e outros projetos em `private-backups` e `workers`; o arquivo de teste delimita o aplicativo atual.

Reproduzir:

```sh
rtk proxy node --import tsx --test sale-sessions.test.ts calendar-conversion.test.ts
rtk proxy node scripts/sale-sessions/verify-db.mjs
rtk proxy node --max-old-space-size=8192 node_modules/typescript/bin/tsc --project scripts/sale-sessions/typecheck.json --noEmit
rtk npm run build
```

## Publicação pendente

Aplicar `migrations/077_sale_sessions.sql` antes de publicar servidor e interface. A migração adiciona campos e funções, permite data ainda indefinida e amplia a unicidade de trabalhos de uma venda para uma venda e seu índice de ensaio. Não cria, divide ou altera valores de vendas existentes.

O ambiente compartilhado tem alterações de outras funcionalidades. Selecionar apenas esta entrega ao preparar a publicação. Após publicar, validar uma conta de teste autenticada e os registros persistidos; a prévia local não comprova publicação, convite real do Google ou emissão externa de contrato.

Para reverter uma publicação, preservar as colunas, os índices e os trabalhos já criados. Não recriar a restrição antiga de um trabalho por venda se houver vendas com vários ensaios. Desabilitar temporariamente novos fechamentos e restaurar o código com revisão dos registros existentes; não apagar trabalhos, contratos ou pagamentos.
