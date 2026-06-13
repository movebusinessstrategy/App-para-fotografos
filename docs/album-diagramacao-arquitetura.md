# Diagramação de Álbum — CRM Trilha
### Editor visual de álbum (estilo Alboom Diagramação / SmartAlbums), módulo novo

> Decisões do dono (2026-06-13): saída = **só prévia pra aprovar** (sem PDF de gráfica); fotos = **galeria selecionada + upload próprio**; quem monta = **fotógrafo E cliente**; templates = **~8 prontos**; **drag-and-drop no MVP**; saída final = **lista (foto por página) + JPG de referência de cada lâmina**.

## Conceito
Editor onde o usuário monta as **lâminas** (spreads = 2 páginas) do álbum arrastando fotos pra dentro de **templates de layout** ("modos de diagramação"). É só prévia visual (sem sangria/DPI/CMYK). A cliente também monta numa versão pública; o fotógrafo aprova.

## Modelo de dados (migration 033_album.sql)
- **album_projects**: id uuid, user_id text, job_id bigint?, gallery_id uuid?, client_id bigint?, client_name/email/phone, title, size text ('sq30'|'sq20'|'land40x30'|'port20x30'), status ('draft'|'sent'|'approved'), share_token text unique, allow_client_edit bool, created_at, updated_at.
- **album_assets**: id uuid, album_id fk, source ('gallery'|'upload'), preview_path, thumb_path, original_name, sort_order. (As fotos disponíveis na bandeja.)
- **album_spreads**: id uuid, album_id fk, position int, template_id text, slots jsonb (`[{asset_id|null, zoom, offset_x, offset_y}]`), updated_at.

Templates NÃO vivem no banco — são ~8 fixos definidos no frontend (geometria). Backend só guarda `template_id` (string) + `slots`.

## Templates (~8, fixos) — src/features/album/templates.ts
Cada template define layout da página esquerda + direita (grid de slots): Clássico (1+1), Painel (foto única atravessando), Dupla (2+1), Trio (3+1), Mosaico (4+2), Respiro (1 com margem), Tira (3 horizontais), Capa. Cada layout = grid CSS + nº de slots.

## Backend (server.ts, seção álbum)
Autenticadas (estúdio): GET/POST/PUT/DELETE /api/albums(/:id); POST /:id/assets/sign-upload + /:id/assets/:aid/process (sharp, reusa padrão da galeria, bucket `album-assets`); POST /:id/assets/import-gallery (puxa selecionadas da galeria vinculada); PUT /:id/spreads (autosave em lote); POST/DELETE /:id/spreads(/:sid); POST /:id/send (notifica cliente, reusa mailer+Baileys); GET /:id/export (lista página→foto, JSON/CSV).
Públicas (cliente): GET /api/public/album/:token; PUT /api/public/album/:token/spreads (se allow_client_edit); POST /api/public/album/:token/approve (→ approved, notifica estúdio). Mesmas defesas da galeria (rate-limit, token forte, fail-closed).

## Frontend
- **@dnd-kit** já existe no projeto (kanban) — reusar pro drag-and-drop foto→slot e reordenar lâminas.
- src/features/album/AlbumListPage.tsx (rota /album) — lista de álbuns + criar.
- src/features/album/AlbumEditorPage.tsx (rota /album/:id) — editor: bandeja (Galeria|Upload) + lâmina central + paleta de templates + tira de lâminas; autosave (PUT /spreads com debounce); auto-preencher; export JPG.
- src/features/album/templates.ts — geometria dos 8 templates.
- src/features/album-publica/AlbumPublicoPage.tsx (rota /a/:token) — editor da cliente (mesma base, mais enxuto) + aprovar.
- Sidebar: item "Álbuns". App.tsx: rotas /album, /album/:id (protegidas) e /a/:token (pública).

## JPG de referência
Gerado **no navegador** (canvas) — desenha cada lâmina (fotos nos slots) e baixa JPG média-resolução. Sem compositing no servidor (é só referência). A "lista" (página→foto+layout) vem do GET /:id/export.

## Fases
- **Fase 0:** migration + templates.ts + backend CRUD + assets (upload/import) + buckets.
- **Fase 1 (MVP):** editor do estúdio com drag-and-drop, auto-preencher, autosave, 8 templates, tamanhos de álbum.
- **Fase 2:** editor público da cliente + fluxo de aprovação + envio (e-mail/WhatsApp).
- **Fase 3:** export (lista CSV + JPG das lâminas), ajuste fino de enquadramento (zoom/offset por slot).
