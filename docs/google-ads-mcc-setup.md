# Google Ads MCC — configuração operacional e de privacidade

Este documento descreve a configuração do Google Ads usada pelo CRM Trilha para **relatórios em modo somente leitura**. Ele não contém credenciais e não autoriza alterações em campanhas. Atribuição de vendas é uma etapa separada e permanece indisponível até existir vínculo verificável entre clique, conta, campanha e negócio.

## Estado conhecido

- Projeto Google Cloud dedicado: `crm-trilha-ads-producao`.
- Google Ads API: ativada no projeto.
- Conta técnica criada: `crm-trilha-ads-reader@crm-trilha-ads-producao.iam.gserviceaccount.com`.
- MCC central `Move Business Strategy`: criado e confirmado como conta administradora, com Brasil, fuso de São Paulo e BRL.
- O ID do MCC foi identificado na interface, mas ainda não foi instalado no gerenciador de segredos da produção.
- API Center: aberto e preparado; o formulário, os termos e a solicitação do developer token ainda não foram enviados.
- Vínculo da conta técnica como **Somente leitura**, vínculo de uma conta anunciante piloto e developer token aprovado continuam pendentes.
- CAPTCHA do cadastro do MCC: concluído por uma pessoa. Aceites, envio do formulário do API Center e criação de credenciais permanecem etapas humanas e não devem ser automatizados.

## Separação do Google Agenda

- O Google Ads usa exclusivamente o projeto `crm-trilha-ads-producao`.
- A integração Google Agenda usa o projeto dedicado `crm-trilha-producao-move` e credenciais próprias.
- Não reutilizar client ID, client secret, conta técnica, tokens, consentimento OAuth ou variáveis de ambiente entre as duas integrações.
- A revogação ou falha do Google Ads não pode desconectar o Google Agenda, e o inverso também não.
- O escopo restrito do Google Ads não deve ser adicionado à tela de consentimento usada pelo Google Agenda.

## Princípios obrigatórios

1. O MCC central funciona como raiz operacional e não é exposto aos tenants.
2. A identidade usada pelo servidor recebe o papel **Somente leitura** no MCC. Esse papel é herdado pelas contas filhas vinculadas.
3. O backend usa apenas `GoogleAdsService.Search` ou `GoogleAdsService.SearchStream` e outras chamadas explicitamente somente leitura.
4. Não implementar ou disponibilizar operações `Mutate`, upload de conversões, criação de públicos, alteração de orçamento ou edição de campanhas neste fluxo.
5. Cada tenant acessa somente os `customer_id` que foram validados e associados a ele no banco.
6. O developer token deve ser solicitado com uso permitido **Reporting**. O escopo OAuth do Google Ads não diferencia leitura de escrita; a restrição depende do papel no Google Ads, do uso permitido do token e da lista de operações do backend.
7. Conversões do Google Ads e vendas do CRM são fontes diferentes e devem aparecer separadas no dashboard.
8. A autenticação é central: tenants não recebem nem armazenam OAuth, chaves ou credenciais Google Ads. Cada um guarda somente o vínculo validado ao seu `customer_id`.

## Estado da atribuição de vendas

- A sincronização do MCC habilita somente as métricas nativas do Google Ads: investimento, impressões, cliques, CPC, conversões e valor de conversão informados pelo Google.
- UTM, origem declarada ou presença isolada de GCLID, GBRAID ou WBRAID não bastam para afirmar que uma venda pertence a uma conta ou campanha.
- Vendas atribuídas, CAC e ROAS devem permanecer ocultos enquanto a resposta do backend não confirmar explicitamente `valid=true` e `click_mapping_verified=true`.
- `click_mapping_verified` só pode ser verdadeiro quando houver evidência da cadeia: identificador de clique → conta Google Ads vinculada ao tenant → campanha correspondente → lead ou negócio → venda ganha.
- Ausência de vendas vinculadas não pode ser apresentada como “zero vendas atribuídas”; deve ser comunicada como atribuição indisponível.
- Conversões nativas do Google Ads e vendas do CRM nunca devem ser somadas ou apresentadas como a mesma métrica.

Referências oficiais:

- [Developer token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [Níveis de acesso e uso permitido](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
- [Modelo de acesso do Google Ads](https://developers.google.com/google-ads/api/docs/oauth/access-model)
- [Autorização e cabeçalhos HTTP](https://developers.google.com/google-ads/api/rest/auth)
- [Fluxo com conta de serviço](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)
- [Proteção de credenciais](https://developers.google.com/google-ads/api/docs/productionize/secure-credentials)

## Checklist de configuração

### 1. Criar e conferir o MCC central — etapa humana

- [ ] Abrir o cadastro de conta de administrador do Google Ads com a conta corporativa responsável.
- [ ] Usar um nome visível que represente a agência, por exemplo `Move Business Strategy`.
- [ ] Selecionar o uso para gerenciamento de contas de clientes.
- [ ] Conferir país, fuso horário e moeda antes de concluir; esses dados podem ter limitações de alteração posterior.
- [ ] Uma pessoa deve concluir o reCAPTCHA e os aceites apresentados pelo Google.
- [ ] Registrar internamente o ID do MCC, sem hífens, como `login_customer_id`.
- [ ] Confirmar no seletor de contas que a conta criada é do tipo **Administrador**, não uma conta anunciante comum.

### 2. Solicitar o developer token — etapa humana

- [ ] Entrar no **API Center** do MCC de nível superior.
- [ ] Manter um e-mail de contato acompanhado pela equipe.
- [ ] Solicitar o developer token descrevendo o produto como dashboard de relatórios e atribuição para clientes do CRM.
- [ ] Selecionar ou solicitar o uso permitido **Reporting**.
- [ ] Informar a URL pública, a Política de Privacidade e os Termos de Serviço do CRM Trilha.
- [ ] Responder manualmente a pedidos de esclarecimento e aguardar o status exibido pelo Google.
- [ ] Registrar o nível concedido: Test, Explorer, Basic ou Standard. Não tratar acesso a produção como aprovado enquanto o status não permitir contas reais.
- [ ] Nunca copiar o token para tickets, documentos, repositório ou conversas.

### 3. Autorizar a identidade técnica

- [ ] No Google Ads, abrir **Administrador → Acesso e segurança** no MCC.
- [ ] Adicionar `crm-trilha-ads-reader@crm-trilha-ads-producao.iam.gserviceaccount.com` como usuário com acesso **Somente leitura**.
- [ ] Confirmar que a identidade aparece como ativa no MCC e que o acesso herdado às contas filhas é somente leitura.
- [ ] Não promover a identidade técnica a Administrador ou Padrão.
- [ ] Gerar a credencial da conta de serviço somente no ambiente administrativo aprovado e instalá-la diretamente no gerenciador de segredos; não salvar uma cópia no repositório ou em uma pasta compartilhada.

### 4. Vincular contas anunciantes

- [ ] O operador autorizado envia ou aceita a solicitação de vínculo entre o MCC e cada conta anunciante.
- [ ] O titular da conta anunciante confirma o vínculo no Google Ads.
- [ ] Registrar o ID da conta anunciante, sem hífens, como `customer_id`.
- [ ] Confirmar o nome visível e a empresa proprietária antes de associar o ID a um tenant.
- [ ] Não vincular contas apenas por semelhança de nome ou e-mail.
- [ ] Não conceder ao cliente acesso ao MCC raiz ou às demais contas da hierarquia.

## IDs e mapeamento por tenant

- `login_customer_id`: ID do MCC pelo qual a chamada é autenticada. Deve ser enviado no cabeçalho `login-customer-id`, sem hífens.
- `customer_id`: ID da conta anunciante consultada no endpoint `customers/{customer_id}/googleAds:search` ou `searchStream`, sem hífens.
- O developer token identifica a aplicação; ele não substitui a autorização da identidade técnica nem o vínculo da conta anunciante.

Antes de liberar um tenant, o cadastro deve conter no mínimo:

- ID interno do tenant;
- `customer_id` validado;
- nome da conta conferido no Google Ads;
- `login_customer_id` do MCC autorizado;
- data, operador e evidência do vínculo;
- estado `pending`, `active`, `revoked` ou `error`;
- data da última sincronização bem-sucedida.

Toda consulta deve resolver o `customer_id` a partir do tenant autenticado no servidor. Não aceitar um ID arbitrário enviado pela interface e não retornar a lista completa de contas acessíveis pelo MCC.

## Segredos e configuração de produção

Armazenar somente no gerenciador de segredos do ambiente de produção:

- `GOOGLE_ADS_DEVELOPER_TOKEN`;
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`;
- `GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL`;
- `GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY`;
- `GOOGLE_ADS_API_VERSION`.

Controles mínimos:

- [ ] Nenhum segredo em `.env` versionado, logs, banco acessível ao frontend ou documentação.
- [ ] Armazenar a chave privada como segredo, limitar o acesso à aplicação e definir sua rotação.
- [ ] Redigir logs para nunca registrar `Authorization`, `developer-token`, chave privada ou refresh token.
- [ ] Antes da liberação, implementar e validar um interruptor operacional, como `GOOGLE_ADS_SYNC_ENABLED=false`, para impedir sincronizações durante o teste ou rollback.
- [ ] Manter mutações desabilitadas por desenho. Não adicionar credenciais ou endpoints que permitam edição de campanhas neste produto.
- [ ] Aplicar criptografia e controle de acesso aos dados de conexão e de sincronização.

## Teste controlado

1. Usar primeiro uma conta de teste ou uma única conta piloto aprovada.
2. Com a sincronização global ainda desativada, chamar uma consulta de identificação da conta e conferir se `login_customer_id` e `customer_id` estão corretos.
3. Executar somente `Search` ou `SearchStream` com intervalo curto e campos mínimos.
4. Conferir, no Google Ads e no CRM:
   - moeda e fuso da conta;
   - custo, impressões, cliques e conversões no mesmo período;
   - ausência de alteração no histórico de mudanças do Google Ads;
   - isolamento: outro tenant não consegue consultar o `customer_id` piloto;
   - ausência de credenciais ou IDs de outras empresas na resposta e nos logs.
5. Conferir que o dashboard rotula separadamente:
   - conversões e valor de conversão informados pelo Google Ads;
   - métricas nativas e indicadores internos do CRM;
   - CAC, ROAS e vendas atribuídas ocultos enquanto não houver vínculo de clique verificável.
6. Só depois ativar a sincronização para o tenant piloto. A liberação para outros tenants deve ser individual.

## Monitoramento operacional

- Registrar cada execução com tenant, conta, período, status, quantidade de linhas, duração e `request-id` do Google; nunca registrar credenciais.
- Alertar para falha de autorização, vínculo removido, quota excedida, token sem acesso a produção e divergência de moeda ou fuso.
- Expor ao usuário a data da última atualização e um estado claro de dados atrasados ou indisponíveis.
- Tratar `RESOURCE_EXHAUSTED` e erros transitórios com retentativa limitada e backoff; não repetir indefinidamente.
- Desativar automaticamente a conexão do tenant após revogação confirmada, sem afetar os demais tenants.

## Revogação e exclusão

- **Desvincular no CRM:** a equipe autorizada remove o mapeamento do `customer_id` para aquele tenant e interrompe novas sincronizações. Não existe OAuth ou credencial individual do tenant para revogar.
- **Remover no Google Ads:** um administrador autorizado remove a conta técnica do MCC ou desfaz o vínculo da conta anunciante no Google Ads.
- **Excluir dados:** métricas armazenadas, identificadores de clique e vínculos de atribuição seguem a solicitação registrada em `/excluir-dados` e a Política de Privacidade.
- A desconexão não deve apagar automaticamente dados históricos sem confirmação; exclusão é uma ação distinta e auditável.

## Rollback e resposta a incidente

1. Acionar o interruptor operacional de sincronização e interromper os jobs antes de qualquer outra ação.
2. Desativar a conexão afetada no banco sem apagar evidências necessárias ao diagnóstico.
3. Remover a identidade técnica ou o vínculo da conta afetada no Google Ads quando houver acesso indevido.
4. Se houver suspeita de exposição, redefinir o developer token no API Center e rotacionar imediatamente a credencial de autenticação.
5. Limpar filas e retentativas para impedir nova sincronização com a credencial anterior.
6. Verificar logs por tenant e `request-id`, comunicar os responsáveis e aplicar o procedimento de incidente e LGPD quando necessário.
7. Restaurar primeiro uma conta piloto, validar isolamento e somente então reativar tenants individualmente.

## Critério de pronto

A integração só está pronta para produção quando todos os itens abaixo tiverem evidência:

- [ ] MCC central confirmado e ID registrado.
- [ ] Developer token com status que permita a conta alvo e uso permitido Reporting.
- [ ] Identidade técnica ativa com papel Somente leitura.
- [ ] Conta piloto vinculada e mapeada ao tenant correto.
- [ ] Segredos configurados sem exposição.
- [ ] Teste de relatório concluído e nenhuma mutação detectada.
- [ ] Teste de isolamento entre tenants aprovado.
- [ ] Política de Privacidade, Termos e Exclusão de Dados publicados.
- [ ] Rollback ensaiado com a sincronização desativada.
