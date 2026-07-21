# NFS-e Nacional (API do contribuinte) — Arquitetura da integração direta

Status: desenho aprovado para construção (2026-07-21). Provider novo `nacional` ao lado do
`plugnotas`, emitindo direto na API do contribuinte do Sistema Nacional de NFS-e (ADN/SEFIN),
custo zero de taxa. Alvo imediato: STUDIO PITORI LTDA (CNPJ 39.732.374/0001-37, Simples
Nacional, Cambé/PR, IBGE 4103701, item LC116 13.03), certificado A1 em mãos.

> Contexto legal: para Simples Nacional, emitir pelo Emissor Nacional passa a ser
> **obrigatório em 01/09/2026** (Resolução CGSN 189/2026). Logo esta integração é o caminho
> que a Pitori terá que seguir de qualquer forma.

## VALIDADO AO VIVO (2026-07-21, com o certificado A1 da Pitori, em homologação)

- **mTLS funciona:** o A1 da Pitori é aceito pelo ambiente de produção restrita (o Swagger do ADN que dava 496 passou a responder 200). A abordagem é viável. Precisou de `--openssl-legacy-provider` no Node 24/OpenSSL 3 para abrir o PKCS#12 do ICP-Brasil (ou converter com node-forge para PEM no build).
- **Cambé está LIVE no nacional:** `GET adn.producaorestrita.nfse.gov.br/parametrizacao/4103701/convenio` retornou `{"parametrosConvenio":{"aderenteAmbienteNacional":1,"aderenteEmissorNacional":1,"situacaoEmissaoPadraoContribuintesRFB":1,"aderenteMAN":1,"permiteAproveitametoDeCreditos":true}}`. Resolve a dúvida "Cambé está parametrizada?": sim.
- **Swaggers oficiais baixados** (via mTLS, guardados no scratchpad): ADN Contribuinte (distribuição por NSU, `GET /DFe/{NSU}`, `GET /NFSe/{chave}/Eventos`), Parametrização (host ADN, prefixo `/parametrizacao/`), DANFSe (`/danfse/{chaveAcesso}`), CNC (`/cnc/CNC`). O Swagger de EMISSÃO (SEFIN, `POST /SefinNacional/nfse`) não está exposto nos caminhos testados; a estrutura da DPS vem do XSD (Anexo I) do pacote de schemas do gov.br.
- **Parametrização por API (host ADN, `/parametrizacao/...`):** `/{codMunicipio}/convenio`; `/{codMunicipio}/{codServico}/{competencia}/aliquota` (dá a ALÍQUOTA de ISS por API, competência no formato `AAAA-MM-DD`, **código de serviço = 9 dígitos** — formato exato do código nacional a confirmar); `/{codMunicipio}/{codServico}/{competencia}/regimes_especiais`; `/{codMunicipio}/{competencia}/retencoes`; `/{codMunicipio}/{cpfCnpj}/beneficio`. Implicação: dá pra AUTOPREENCHER a alíquota de ISS puxando do governo, não precisa só do contador.

## ✅ DPS QUE FUNCIONOU EM HOMOLOGAÇÃO (2026-07-21, HTTP 201)

Emissão de teste ACEITA pelo SEFIN produção restrita (`POST https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse`,
corpo JSON `{ "dpsXmlGZipB64": "<xml assinado, com prolog UTF-8, gzip, base64>" }`,
resposta 201 `{ chaveAcesso, nfseXmlGZipB64 }`). Motor validado ponta a ponta: node-forge (p12→PEM,
sem flag OpenSSL), xml-crypto (RSA-SHA1 enveloped C14N, ref `#infDPS`), zlib, https mTLS com key+cert PEM.

DPS mínima ACEITA para Pitori (Simples ME/EPP, fotografia, Cambé):
```
<?xml version="1.0" encoding="UTF-8"?>   <!-- prolog UTF-8 OBRIGATÓRIO (erro E1229 sem ele) -->
<DPS versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="DPS{IBGE7}{2}{CNPJ14}{serie5}{nDPS15}">
 <tpAmb>2</tpAmb>                         <!-- 1=produção, 2=homologação -->
 <dhEmi>{ISO -03:00, NÃO no futuro}</dhEmi>  <!-- Brasília=UTC-3; usar UTC labelado -03:00 dá E0008 -->
 <verAplic>CRM-Trilha-1.0</verAplic>
 <serie>00001</serie><nDPS>{n}</nDPS>
 <dCompet>{YYYY-MM-DD}</dCompet>
 <tpEmit>1</tpEmit><cLocEmi>4103701</cLocEmi>
 <prest><CNPJ>39732374000137</CNPJ>
   <regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
 <toma><CPF>...</CPF><xNome>...</xNome></toma>
 <serv><locPrest><cLocPrestacao>4103701</cLocPrestacao></locPrest>
   <cServ><cTribNac>130301</cTribNac><xDescServ>...</xDescServ><cNBS>114082000</cNBS></cServ></serv>
 <valores><vServPrest><vServ>1.00</vServ></vServPrest>
   <trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>
         <totTrib><pTotTribSN>2.00</pTotTribSN></totTrib></trib></valores>
</infDPS></DPS>
```

Aprendizados-chave (cada um foi um erro que corrigi):
- **opSimpNac=3** (ME/EPP; a Pitori é LTDA, não MEI que seria 2). E0160 se errado.
- **regApTribSN=1** obrigatório p/ ME/EPP (regime de apuração pelo SN). E0166 sem ele.
- **totTrib usa `pTotTribSN` (percentual, ex. 2.00), NÃO `indTotTrib`** p/ ME/EPP. E0712/E1235 com indTotTrib.
- **cTribNac=130301** (fotografia, LC116 13.03), **cNBS=114082000** (código NBS 9 díg da fotografia).
- Simples NÃO leva alíquota de ISS; só tribISSQN=1 (tributável) + tpRetISSQN=1 (não retido).
- Assinatura **RSA-SHA1** (não SHA256). Id da DPS = DPS+IBGE7+tpInsc(2=CNPJ)+CNPJ14+serie5(zero-pad)+nDPS15(zero-pad).
- Numeração: usar uma **série dedicada** do nosso app (diferente da série da plataforma paga) p/ não colidir nDPS.

Para PRODUÇÃO: trocar host p/ `sefin.nfse.gov.br` e `tpAmb=1`. Motor de teste validado em scratchpad/emit-test.mjs.

## FORMATO REAL DA DPS/NFS-e (extraído de nota real de Cambé, 2026-07-21)

Puxei uma NFS-e real via `GET https://adn.nfse.gov.br/contribuintes/DFe/0` (distribuição por NSU;
o lote trouxe 50 docs do CNPJ da Pitori). Namespace `http://www.sped.fazenda.gov.br/nfse`, versão `1.00`.
Estrutura da DPS confirmada (dados sanitizados):

```xml
<DPS versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse">
 <infDPS Id="DPS{IBGE7}{tpInsc1}{inscFederal14}{serie5}{nDPS15}">
  <tpAmb>1</tpAmb>                 <!-- 1=producao, 2=homologacao -->
  <dhEmi>2024-03-05T18:23:29-03:00</dhEmi>
  <verAplic>...</verAplic>
  <serie>900</serie>              <!-- 5 dig no Id -->
  <nDPS>32</nDPS>                 <!-- 15 dig no Id -->
  <dCompet>2024-03-05</dCompet>   <!-- competencia YYYY-MM-DD -->
  <tpEmit>1</tpEmit>
  <cLocEmi>4103701</cLocEmi>      <!-- IBGE do emitente -->
  <prest>
   <CNPJ>{cnpj_prestador}</CNPJ>
   <fone>...</fone><email>...</email>
   <regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib></regTrib>
  </prest>
  <toma>
   <CNPJ ou CPF>{doc_tomador}</...>
   <xNome>{nome_tomador}</xNome>
   <end><endNac><cMun>4103701</cMun><CEP>86182040</CEP></endNac>
        <xLgr>...</xLgr><nro>...</nro><xBairro>...</xBairro></end>
  </toma>
  <serv>
   <locPrest><cLocPrestacao>4103701</cLocPrestacao></locPrest>
   <cServ>
    <cTribNac>071101</cTribNac>   <!-- codigo tributacao NACIONAL, 6 digitos (este ex.=decoracao). Achar o de FOTOGRAFIA -->
    <xDescServ>...descricao livre...</xDescServ>
   </cServ>
  </serv>
  <valores>
   <vServPrest><vServ>510.00</vServ></vServPrest>
   <trib>
    <tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>
    <totTrib><indTotTrib>0</indTotTrib></totTrib>
   </trib>
  </valores>
 </infDPS>
 <!-- + <Signature> XMLDSig do contribuinte referenciando #infDPS Id -->
</DPS>
```

### Descobertas que mudam o build (confirmadas na nota real)

1. **Simples Nacional NÃO leva alíquota de ISS na nota.** O bloco `<valores><trib>` só tem
   `tribISSQN=1` (tributável) e `tpRetISSQN=1` (não retido); o ISS é recolhido no DAS. Some a
   dependência de "pegar a alíquota com o contador" e o endpoint de alíquota vira opcional.
   Para a Pitori (Simples): `<regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib>`.
2. **Assinatura = RSA-SHA1 + C14N (REC-xml-c14n-20010315) + enveloped**, não SHA-256. A NFS-e
   real vem assinada com `rsa-sha1`/`sha1`. Usar rsa-sha1 no `signDps` (xml-crypto), Reference
   ao `Id` do `infDPS`, transform enveloped + C14N. (Confirmar no manual da DPS, mas o ecossistema é SHA1.)
3. **Id da DPS** = `DPS` + IBGE(7) + tpInsc(1, 2=CNPJ) + inscFederal(14) + serie(5, zero-pad) + nDPS(15, zero-pad).
   Muitos campos que eu havia previsto como coluna (iss_tipo_tributacao, exigibilidade, cloc separado)
   se resolvem com esse leiaute enxuto: para o caminho comum (Simples, tributável no município,
   não retido), o essencial é cTribNac + descrição + valor + os flags fixos.

### Ainda a confirmar
- `cTribNac` exato da FOTOGRAFIA (o exemplo é decoração=071101). Fontes: tabela oficial de código de
  tributação nacional, OU puxar uma NFS-e onde a Pitori seja `prest` (distribuição tem, achar entre os 50).
  Obs.: o endpoint de parametrização pede "código de serviço de 9 dígitos" (formato diferente do cTribNac de 6).

## O que já está confirmado (pesquisa oficial + teste ao vivo dos hosts)

- **Hosts** (respondem ao vivo; ADN exige certificado cliente, retorna 496 sem ele):
  - Homologação (produção restrita): `sefin.producaorestrita.nfse.gov.br/SefinNacional` (emissão) + `adn.producaorestrita.nfse.gov.br` (dados/Swagger)
  - Produção: `sefin.nfse.gov.br/SefinNacional` (emissão) + `adn.nfse.gov.br` (dados/DANFSe)
- **Endpoints do contribuinte:** `POST /nfse` (gera NFS-e da DPS, SÍNCRONO), `GET /nfse/{chaveAcesso}`, `GET|HEAD /dps/{id}`, `POST /nfse/{chaveAcesso}/eventos` (cancelamento), `GET /nfse/{chaveAcesso}/eventos[...]`, `GET /parametros_municipais/...` (alíquota/convênio/retenções), DANFSe PDF no ADN em `/danfse/{chaveAcesso}`.
- **Autenticação:** mTLS com certificado ICP-Brasil A1/A3. Sem token/JWT adicional no fluxo do contribuinte.
- **Formato:** JSON com o XML (assinado em XMLDSig) compactado em GZip e em Base64: envio `{ "dpsXmlGZipB64": "..." }`, retorno `{ chaveAcesso, nfseXmlGZipB64 }`.
- **Id da DPS:** IBGE(7) + tipo inscrição(1) + inscrição federal(14) + série(5) + nº DPS(15).
- Documentação: Manual Contribuintes Emissor Público API v1.2 (out/2025), gov.br/nfse. Swagger oficial em `adn.producaorestrita.nfse.gov.br/contribuintes/docs` (exige certificado).

## Buracos da pesquisa (confirmar antes/no início do build)

- **Schema exato da DPS + assinatura XMLDSig** (o agente de pesquisa caiu). É o Anexo I do manual (XSD v1.01): campos, ordem, domínios de `iss.tipoTributacao`/`exigibilidade`/`regEspTrib`, código de tributação nacional da fotografia. **Primeira tarefa do build.**
- **Mudanças de julho/2026** (DANFSe suspensa? nova NT?): pesquisa veio vazia. Não guiar código nisso; confirmar. IBS/CBS da Reforma ainda não exigidos nesta versão.
- Nomes exatos dos campos JSON do evento de cancelamento e do DANFSe (ler no Swagger autenticado).

## Arquitetura

O "motor" novo é `nfse-nacional.ts` ao lado de `plugnotas.ts`. As rotas `/api/fiscal/*`
escolhem o provider por `fiscal_config.provider` (`plugnotas` | `nacional`). Banco, tela
(`FiscalPage.tsx`) e a regra de "emitir só após ensaio realizado" ficam intactos.

**Diferença crítica vs PlugNotas:** aqui não há intermediário. O certificado A1 (.pfx + senha)
fica **no nosso servidor**, porque é usado para mTLS E para assinar o XML da DPS. Essa é a
maior mudança de responsabilidade do projeto (guarda segura do certificado).

Fluxo de emissão: monta objeto DPS → gera XML (XSD v1.01) → assina (XMLDSig enveloped, C14N,
SHA-256) → gzip+base64 → `POST /SefinNacional/nfse` via `https.Agent` com o A1 (mTLS) →
resposta síncrona `{ chaveAcesso, nfseXml }` → grava na `fiscal_invoices`.

Bibliotecas a instalar (nenhuma existe hoje): `xml-crypto` (assinatura), `node-forge` (abrir
o .pfx PKCS#12 → PEM + ler validade), opcional `xmlbuilder2` (montar o XML). `zlib` e `https`
são nativos. `fetch` nativo não injeta agent mTLS facilmente → usar `https.request`.

### Guarda do certificado A1 (ponto crítico de segurança)

`.pfx` cifrado com AES-256-GCM guardado em coluna `bytea` na `fiscal_config`; a master key só
em env do Render (`FISCAL_CERT_MASTER_KEY`), nunca no banco. A senha do .pfx cifrada à parte.
Em runtime: lê blob, descriptografa em memória, monta o agent e assina, descarta o buffer.
Nunca logar senha/chave/buffer. Rotas com `requirePermission('finance')`. Não usar disco do
Render (efêmero, já queimou com o Baileys).

## Mudanças no banco (migration 044, aditiva e idempotente)

`fiscal_config` +: `dps_serie`, `dps_proximo_numero` (contador atômico), `certificado_pfx`
(bytea cifrado), `certificado_senha_cifrada`, `certificado_cifra_iv`, `certificado_cifra_tag`,
`iss_tipo_tributacao`, `iss_exigibilidade`, `cloc_incidencia` (IBGE incidência), 
`item_lista_servico` (ex.: 13.03), `regime_especial_tributacao`.

`fiscal_invoices` +: `chave_acesso`, `dps_numero`, `dps_serie`, `dps_id`, `danfse_url`, `xml_nfse`.

Numeração da DPS **atômica** (evita nº duplicado em concorrência):
```sql
UPDATE fiscal_config SET dps_proximo_numero = dps_proximo_numero + 1, updated_at = now()
 WHERE user_id = $1 RETURNING dps_proximo_numero - 1 AS numero_reservado, dps_serie;
```

## Rotas (dispatch por provider, sem duplicar)

- `POST /empresa`: no `nacional` não existe "cadastrar no provedor"; vira validação local + `GET /parametros_municipais/{ibge}/convenio` pra confirmar que Cambé está conveniada.
- `POST /certificado`: no `nacional`, cifra o .pfx+senha e grava na `fiscal_config` (não manda pra provedor). Lê validade com node-forge.
- `POST /nfse`: resposta síncrona já grava `chave_acesso` + `autorizada`/`rejeitada`. Muitas vezes dispensa o `refresh`.
- `refresh`: `GET /nfse/{chave}` (ou `GET /dps/{id}`).
- `cancelar`: evento → `POST /nfse/{chave}/eventos` (XML de evento assinado). Justificativa ≥15 já existe.

## Plano de build ordenado (dias de dev focado, 1 dev)

- **Fase 0 (externo, bloqueante):** pré-requisitos do usuário (ver abaixo).
- **Fase 1 — cripto + mTLS (1,5–2,5d):** libs, `loadKeyPair`/`buildMtlsAgent`/`gzipB64`, upload cifrado + `FISCAL_CERT_MASTER_KEY`. Marco: conexão mTLS estabelecida (496 vira 200/403 autenticado).
- **Fase 2 — montar + assinar DPS (2–4d):** `montarDpsXml` (XSD v1.01), `signDps` (XMLDSig), validar contra XSD local, numeração atômica. **Maior risco técnico.**
- **Fase 3 — MARCO DE HOMOLOGAÇÃO (0,5–2d + iterações):** emitir 1 DPS de teste em produção restrita, 1 consulta, 1 cancelamento verdes. **Gate antes de produção.**
- **Fase 4 — rotas + dispatch (1,5–2d):** camada `providers`, adaptar rotas, rodar migration 044.
- **Fase 5 — tela + DANFSe (0,5–1,5d):** seletor de provider + upload de certificado; servir DANFSe/XML.
- **Fase 6 — virada produção (0,5d + acompanhamento):** A1 real, 1 nota real de ensaio realizado.

**Total: ~8 a 14 dias**, com Fases 2 e 3 as de maior risco de estouro.

## Bloqueios do usuário (Pitori) — pré-condições externas

1. **Inscrição Municipal** (Cadastro Mobiliário) ativa em Cambé — obrigatória. Prefeitura de Cambé / Plantão Fiscal (43) 3174-2630.
2. **Primeiro acesso** no Emissor Nacional (`nfse.gov.br/EmissorNacional`) com conta gov.br Prata/Ouro ou e-CNPJ. É o "credenciamento" de fato.
3. Certificado A1 e-CNPJ válido (em mãos; confirmar validade/senha).
4. Confirmar com o Plantão Fiscal se há habilitação municipal do prestador antes de emitir por API, e se Cambé está parametrizada em produção restrita (senão o teste não gera nota).

## Riscos

- **Assinatura XMLDSig errada** = 100% de rejeição (erro nº 1 de quem integra NFS-e). Mitigar: algoritmos exatos do manual + validar XSD antes de enviar + iterar em produção restrita.
- **Guarda do A1** = vazamento permite terceiro emitir no CNPJ da Pitori. Mitigar: AES-GCM, master key em env, nunca em claro/log.
- **DANFSe suspensa 03/08/2026 (não confirmado):** tratar o XML autorizado como o documento fiscal; PDF vira conveniência.
- **Geração síncrona/timeout/duplicidade:** timeout generoso + `GET /dps/{id}` para recuperar a chave sem reemitir.
