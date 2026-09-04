# Arquivos no R2; login e registros no Supabase

O aplicativo usa `app-storage.ts` para capas, galerias, álbuns, PDFs e áudios do agente. O provedor de cada bucket é selecionado por `R2_BUCKETS`; WhatsApp já usa `object-storage.ts` diretamente.

Configuração de destino, após conferir as cópias:

```dotenv
R2_BUCKETS=wa-media,job-covers,galeria-originais,galeria-previews,album-assets,agente-materiais,agente-audios
```

Não habilitar acesso público ao bucket físico: ele também contém originais, mídias privadas e backups. Capas, previews e assets de álbum mantêm o acesso que já tinham no aplicativo por `/api/public/storage/:bucket/*`, com redirecionamento para URL assinada válida por uma hora. O redirecionamento é cacheável por cinco minutos e não consulta o banco. Originais, PDFs, áudios e WhatsApp continuam usando suas rotas de autorização. Capas antigas do Supabase são resolvidas na resposta de `/api/jobs` após a mudança do provedor.

## Conferência em 4 de setembro de 2026

- Inventário atual, fora do WhatsApp: 354 objetos, 681.394.459 bytes. Uma capa nova de 12.262 bytes foi copiada; os outros 353 objetos mantinham os metadados do inventário de agosto.
- Os 354 objetos no R2 passaram na conferência de tamanho e SHA-256 registrado na migração.
- CORS configurado e conferido para `https://crmtrilha.com.br`, `https://www.crmtrilha.com.br` e `https://app-para-fotografos.onrender.com`: GET, HEAD, PUT; cabeçalhos content-type/range; ETag exposto. Endereço externo recusado.
- Testes reais com conteúdo sintético: upload do servidor, leitura assinada, link permanente, upload direto com PUT e bloqueio do bucket de originais na rota pública. Objetos de teste removidos.
- Doze testes automatizados, TypeScript e build passaram. O erro de inferência de `User` na listagem de administradores já ocorria no código anterior; a anotação explícita corrige apenas a tipagem.

Evidências operacionais, sem credenciais nem conteúdos de clientes no Git, estão na pasta privada `private-backups/r2-cutover-2026-09-04` da cópia principal do projeto.

## Ativação e retorno

1. Publicar o código e conferir o commit ativo no Render.
2. Acrescentar os buckets verificados a `R2_BUCKETS`, preservando as credenciais atuais, e aplicar a configuração.
3. Conferir as telas autenticadas de produção, galerias, álbuns, agente e atendimento. Confirmar que os links resolvem para o R2 e que os originais permanecem privados.
4. Manter as cópias do Supabase até concluir a conferência em produção. A retirada das cópias antigas é uma etapa separada; não está embutida no código nem nos scripts de inventário.

Antes de qualquer upload após o corte, o retorno é repor a lista anterior (`wa-media`). Depois de novos uploads no R2, é necessário copiar o delta de volta antes de reverter o provedor. Não reverter a configuração isoladamente e deixar arquivos novos inacessíveis.

O R2 substitui armazenamento de arquivos. Ele não substitui autenticação, tabelas relacionais ou consultas do CRM; a disponibilidade dessas funções continua dependendo do banco.
