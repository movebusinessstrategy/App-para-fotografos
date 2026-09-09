# Alinhamento e dossiê do ensaio

Em Produção, abra o ensaio e, em Detalhes → Alinhamento do ensaio, clique em
Ler conversa e fotos. O fluxo reaproveita dados do trabalho, venda, contrato,
dossiê e histórico de WhatsApp. Mostra os combinados, referências e perguntas
pendentes. Ver PDF abre o documento para baixar ou enviar para conferência.

O envio depende de clique da equipe e usa o WhatsApp de pós-venda. Publicar
esta versão não envia mensagens nem ativa atendimento autônomo. As escolhas
são gravadas no JSON da tabela alignment_dossiers existente (migração 058);
nenhuma nova migração é necessária.

O PDF usa fundo claro e marca com transparência. Para o endereço legado de
logo do Estúdio Pitori no Drive, usa a marca original aprovada incluída em
public/branding/pitori-dossier.png. Outros estúdios continuam usando sua
própria logo cadastrada. A versão para cliente não inclui links financeiros,
comprovantes ou notas internas; essas informações permanecem no cadastro.

Fotos são selecionadas a partir das mensagens da cliente, com legendas
apoiadas nas falas registradas. Arquivos indisponíveis são identificados;
links de portfólio enviados pelo estúdio não são tratados como fotos enviadas
pela cliente. A leitura considera até 400 mensagens e requer venda vinculada.

Verificação: testes de contexto, roteiro, escolhas e marca; build isolado;
checagem de tipos; revisão visual do PDF. A publicação deve conferir tanto
frontend (Vercel) quanto servidor (Render), pois o PDF é gerado pelo servidor.
