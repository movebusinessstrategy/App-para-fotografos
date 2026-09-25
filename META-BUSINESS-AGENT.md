# Histórico da Meta Business Agent no CRM

## Diagnóstico de 25/09/2026

O aplicativo do CRM está inscrito em `messages` e `smb_message_echoes`, mas não em
`standby`. O código também não interpretava o conteúdo desse evento. A conexão
da Meta estava ativa e os aplicativos fotoMove e Business Agent estavam vinculados
à conta do WhatsApp. Isso permite receber alguns status sem receber o texto da
resposta produzida pelo outro aplicativo.

Fonte oficial: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/standby

## Correção preparada

- Normaliza `standby.messages`, os pedidos de envio aninhados em
  `standby.message_echoes[].message` e `standby.statuses`.
- Salva texto, destinatário, direção, horário e identificação da origem na fila
  durável e no histórico, usando a deduplicação existente por conta e mensagem.
- Preserva o envelope original, incluindo informações de templates, na fila.
- Atualiza a conversa e informa o funil de mensagens de entrada e de saída.
  A autoria do aplicativo externo permanece desconhecida: standby também pode
  trazer mensagens de outros aplicativos, não apenas da Business Agent.
- Não agenda resposta da Lia para entradas standby nem marca ecos como
  atendimento humano. A rotina de resgate também verifica a origem passiva.
- Exige a coluna de proveniência para salvar standby, evitando perder essa
  proteção em instalações antigas.

## Validação

76 testes passaram nos arquivos de coexistência, processamento e funil, com
dados sintéticos. Incluem gravação via fila, texto de saída, conta/destinatário,
deduplicação e ausência de resposta automática. A checagem global de TypeScript
apontou erros em módulos de follow-up fora da alteração; não houve erro apontado
nos novos trechos. Isso não equivale a uma validação de ponta a ponta em produção.

## Ativação e verificação pendentes

1. Publicar a correção sobre a versão vigente do servidor, preservando outras
   alterações. Esta branch partiu de `followup-cadencia-19set`, commit `5c13406`.
2. Acrescentar `standby` à inscrição do aplicativo sem substituir os demais campos
   ou outras inscrições. Não alterar o dono da conversa nem o roteamento existente.
3. Conferir/conceder visibilidade standby ao fotoMove na configuração de roteamento
   do Meta Business Suite para a conta do estúdio. A Meta exige concessão pela empresa.
4. Aguardar uma conversa real atendida pela Business Agent e comparar seu texto,
   horário e destinatário no WhatsApp e no CRM. Conferir fila processada, uma única
   mensagem salva e ausência de resposta da Lia. Não enviar mensagens a clientes
   para realizar esse teste sem instrução do usuário.

Nenhuma publicação, inscrição, concessão de visibilidade ou envio a clientes foi
feito por esta correção. O acesso ao Chrome está pendente da conexão da extensão.

## Limites

Standby fornece novos eventos; esta mudança não recupera automaticamente respostas
antigas cujo conteúdo nunca chegou ao CRM. Status de envio não contêm esse texto.
Templates são pedidos estruturados, não necessariamente o texto final renderizado;
a mudança preserva o envelope, mas não acrescenta renderização de templates.
Mídias identificadas por ID seguem o processamento atual; links externos de mídia
não são baixados por esta alteração. Indicadores antigos de falta de resposta
precisam de avaliação separada quando só existem status sem conteúdo.
