// Emissão de NFS-e DIRETO na API do contribuinte do Sistema Nacional (SEFIN/ADN),
// sem intermediário pago. Validado ponta a ponta em homologação em 2026-07-21
// (HTTP 201, chave gerada) — ver docs/nfse-nacional-arquitetura.md.
//
// Resumo do fluxo: monta o XML da DPS -> assina (XMLDSig RSA-SHA1, enveloped,
// C14N, referência ao Id do infDPS) -> prolog UTF-8 -> gzip -> base64 ->
// POST { dpsXmlGZipB64 } no SEFIN via mTLS com o certificado A1 do estúdio.
// Resposta é SÍNCRONA: 201 { chaveAcesso, nfseXmlGZipB64 } ou 400 { erros[] }.
//
// Segurança do certificado: o .pfx + senha ficam cifrados (AES-256-GCM) numa
// coluna da fiscal_config. A master key vive só na env FISCAL_CERT_MASTER_KEY.
// Nunca logar senha, chave privada ou o buffer do certificado.

import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

export type NacEnv = 'sandbox' | 'production'; // sandbox = produção restrita (homologação)

const HOSTS = {
  sandbox: { sefin: 'sefin.producaorestrita.nfse.gov.br', adn: 'adn.producaorestrita.nfse.gov.br' },
  production: { sefin: 'sefin.nfse.gov.br', adn: 'adn.nfse.gov.br' },
} as const;

// ── Cifra do certificado (AES-256-GCM, master key em env) ────────────────────
function masterKey(): Buffer {
  const raw = process.env.FISCAL_CERT_MASTER_KEY;
  if (!raw) throw new Error('FISCAL_CERT_MASTER_KEY não configurada no ambiente.');
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

// Envelope: base64( iv(12) + tag(16) + ciphertext ). Conteúdo: JSON { pfxB64, senha }.
export function cifrarCertificado(pfx: Buffer, senha: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const plain = Buffer.from(JSON.stringify({ pfxB64: pfx.toString('base64'), senha }), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decifrarCertificado(blobB64: string): { pfx: Buffer; senha: string } {
  const blob = Buffer.from(blobB64, 'base64');
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  const { pfxB64, senha } = JSON.parse(plain);
  return { pfx: Buffer.from(pfxB64, 'base64'), senha };
}

// ── Certificado A1: .pfx (PKCS#12) -> PEM via node-forge ─────────────────────
// (Não usa a flag --openssl-legacy-provider: o forge abre o PKCS#12 legado do
// ICP-Brasil sem depender do OpenSSL do Node.)
export interface KeyPair { keyPem: string; certPem: string; validade: Date; titular: string }

export function abrirCertificado(pfx: Buffer, senha: string): KeyPair {
  const p12Der = forge.util.createBuffer(pfx.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), senha);
  let key: forge.pki.rsa.PrivateKey | null = null;
  for (const t of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType: t })[t];
    if (bags && bags[0] && bags[0].key) { key = bags[0].key as forge.pki.rsa.PrivateKey; break; }
  }
  if (!key) throw new Error('Certificado sem chave privada (confira o arquivo e a senha).');
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = certBags.map((b) => b.cert!).filter(Boolean);
  const leaf = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key!.n)) || certs[0];
  if (!leaf) throw new Error('Certificado inválido: nenhum certificado no arquivo.');
  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(leaf),
    validade: leaf.validity.notAfter,
    titular: leaf.subject.getField('CN')?.value || '',
  };
}

// ── Montagem da DPS ──────────────────────────────────────────────────────────
const soDigitos = (s?: string) => String(s || '').replace(/\D/g, '');
const escXml = (s: string) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const pad = (v: string | number, n: number) => soDigitos(String(v)).padStart(n, '0').slice(-n);

// Horário de Brasília (UTC-3, sem horário de verão), com folga pra nunca ficar
// "posterior ao processamento" no relógio do SEFIN (erro E0008).
function agoraBrasilia(): { iso: string; data: string } {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - 30_000);
  return { iso: d.toISOString().replace(/\.\d+Z$/, '') + '-03:00', data: d.toISOString().slice(0, 10) };
}

export interface DpsConfig {
  cnpjPrestador: string;
  codigoIbge: string;          // cLocEmi/cLocPrestacao (município do estúdio)
  serie: string;               // série da DPS (5 dígitos no Id)
  numero: number;              // nDPS (sequencial reservado atomicamente)
  ambiente: NacEnv;
  cTribNac?: string;           // código de tributação nacional (fotografia = 130301)
  cNBS?: string;               // código NBS (fotografia = 114082000)
  pTotTribSN?: number;         // percentual total de tributos do Simples (ME/EPP)
  verAplic?: string;
}

export interface DpsNota {
  tomadorDoc: string;          // CPF (11) ou CNPJ (14)
  tomadorNome: string;
  valor: number;
  descricao: string;
  tomadorEmail?: string;
  dataCompetencia?: string;    // YYYY-MM-DD (default hoje)
}

export interface DpsMontada { xml: string; dpsId: string; serie: string; numero: number }

export function montarDps(cfg: DpsConfig, nota: DpsNota): DpsMontada {
  const cnpj = pad(cfg.cnpjPrestador, 14);
  const serie5 = pad(cfg.serie, 5);
  const dpsId = 'DPS' + cfg.codigoIbge + '2' + cnpj + serie5 + pad(cfg.numero, 15);
  const { iso, data } = agoraBrasilia();
  const doc = soDigitos(nota.tomadorDoc);
  const tagDoc = doc.length > 11 ? `<CNPJ>${pad(doc, 14)}</CNPJ>` : `<CPF>${pad(doc, 11)}</CPF>`;
  const email = nota.tomadorEmail ? `<email>${escXml(nota.tomadorEmail)}</email>` : '';
  const xml =
    `<DPS versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="${dpsId}">` +
    `<tpAmb>${cfg.ambiente === 'production' ? 1 : 2}</tpAmb>` +
    `<dhEmi>${iso}</dhEmi>` +
    `<verAplic>${escXml(cfg.verAplic || 'CRM-Trilha-1.0')}</verAplic>` +
    `<serie>${Number(serie5)}</serie>` +
    `<nDPS>${cfg.numero}</nDPS>` +
    `<dCompet>${nota.dataCompetencia || data}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${cfg.codigoIbge}</cLocEmi>` +
    // Simples Nacional ME/EPP: opSimpNac=3 + regime de apuração pelo SN.
    `<prest><CNPJ>${cnpj}</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>` +
    `<toma>${tagDoc}<xNome>${escXml(nota.tomadorNome)}</xNome>${email}</toma>` +
    `<serv><locPrest><cLocPrestacao>${cfg.codigoIbge}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${cfg.cTribNac || '130301'}</cTribNac><xDescServ>${escXml(nota.descricao)}</xDescServ><cNBS>${cfg.cNBS || '114082000'}</cNBS></cServ></serv>` +
    `<valores><vServPrest><vServ>${Number(nota.valor).toFixed(2)}</vServ></vServPrest>` +
    // ME/EPP: ISS dentro do DAS (sem alíquota na nota); totTrib usa pTotTribSN.
    `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
    `<totTrib><pTotTribSN>${Number(cfg.pTotTribSN ?? 2).toFixed(2)}</pTotTribSN></totTrib></trib></valores>` +
    `</infDPS></DPS>`;
  return { xml, dpsId, serie: serie5, numero: cfg.numero };
}

// ── Assinatura XMLDSig (RSA-SHA1, enveloped, C14N — o que o SEFIN valida) ────
export function assinarDps(xml: string, kp: KeyPair): string {
  const sig = new SignedXml({ privateKey: kp.keyPem, publicCert: kp.certPem });
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='DPS']", action: 'append' } });
  // Prolog UTF-8 é obrigatório (E1229 sem ele) e entra DEPOIS da assinatura.
  return '<?xml version="1.0" encoding="UTF-8"?>' + sig.getSignedXml();
}

// ── HTTP com mTLS ────────────────────────────────────────────────────────────
interface HttpResp { status: number | string; body: string; buffer?: Buffer }

function requestMtls(kp: KeyPair, host: string, path: string, method: string, jsonBody?: unknown): Promise<HttpResp> {
  const data = jsonBody === undefined ? null : Buffer.from(JSON.stringify(jsonBody), 'utf8');
  return new Promise((resolve) => {
    const req = https.request({
      host, port: 443, path, method,
      key: kp.keyPem, cert: kp.certPem, timeout: 45_000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode || 0, body: buffer.toString('utf8'), buffer });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '' }); });
    req.on('error', (e: any) => resolve({ status: 'ERRO', body: e?.code || e?.message || 'falha de rede' }));
    if (data) req.write(data);
    req.end();
  });
}

// Mensagens amigáveis pros erros mais comuns do SEFIN.
const ERROS_AMIGAVEIS: Record<string, string> = {
  E1229: 'XML sem codificação UTF-8 (erro interno de montagem).',
  E0008: 'Data de emissão ficou no futuro (relógio do servidor).',
  E0160: 'Situação do Simples Nacional não bate com o cadastro da Receita.',
  E0166: 'Faltou o regime de apuração do Simples (ME/EPP).',
  E0712: 'Campo de total de tributos incompatível com ME/EPP.',
  E0143: 'Já existe NFS-e para esta DPS (número/série repetidos). Tente novamente (novo número).',
};

export interface EmissaoResultado {
  ok: boolean;
  chaveAcesso?: string;
  nfseXml?: string;
  erros?: { codigo: string; descricao: string }[];
  mensagem?: string;
  httpStatus: number | string;
}

function parseErros(body: string): { codigo: string; descricao: string }[] {
  try {
    const j = JSON.parse(body);
    const lista = j?.erros || j?.Erros || [];
    return lista.map((e: any) => {
      const codigo = e?.Codigo || e?.codigo || '';
      const desc = e?.Descricao || e?.descricao || '';
      const comp = e?.Complemento || e?.complemento || '';
      return { codigo, descricao: (ERROS_AMIGAVEIS[codigo] || desc) + (comp ? ` (${comp})` : '') };
    });
  } catch { return [{ codigo: '', descricao: body.slice(0, 300) }]; }
}

// ── Emissão (síncrona) ───────────────────────────────────────────────────────
export async function emitir(env: NacEnv, kp: KeyPair, dpsXmlAssinado: string): Promise<EmissaoResultado> {
  const dpsXmlGZipB64 = zlib.gzipSync(Buffer.from(dpsXmlAssinado, 'utf8')).toString('base64');
  const r = await requestMtls(kp, HOSTS[env].sefin, '/SefinNacional/nfse', 'POST', { dpsXmlGZipB64 });
  if (r.status === 201 || r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const nfseXml = j.nfseXmlGZipB64
        ? zlib.gunzipSync(Buffer.from(j.nfseXmlGZipB64, 'base64')).toString('utf8')
        : undefined;
      return { ok: true, chaveAcesso: j.chaveAcesso, nfseXml, httpStatus: r.status };
    } catch {
      return { ok: false, mensagem: 'Resposta inesperada do SEFIN.', httpStatus: r.status };
    }
  }
  const erros = parseErros(r.body);
  return { ok: false, erros, mensagem: erros.map((e) => `${e.codigo} ${e.descricao}`.trim()).join('; '), httpStatus: r.status };
}

// ── Consulta por chave (retorna o XML da NFS-e) ──────────────────────────────
export async function consultar(env: NacEnv, kp: KeyPair, chaveAcesso: string): Promise<EmissaoResultado> {
  const r = await requestMtls(kp, HOSTS[env].sefin, `/SefinNacional/nfse/${chaveAcesso}`, 'GET');
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const nfseXml = j.nfseXmlGZipB64
        ? zlib.gunzipSync(Buffer.from(j.nfseXmlGZipB64, 'base64')).toString('utf8')
        : undefined;
      return { ok: true, chaveAcesso, nfseXml, httpStatus: r.status };
    } catch { return { ok: false, mensagem: 'Resposta inesperada.', httpStatus: r.status }; }
  }
  return { ok: false, erros: parseErros(r.body), httpStatus: r.status };
}

// ── DANFSe (PDF) via ADN — servimos pelo nosso backend (a URL exige mTLS) ────
export async function danfsePdf(env: NacEnv, kp: KeyPair, chaveAcesso: string): Promise<{ ok: boolean; pdf?: Buffer; status: number | string }> {
  const r = await requestMtls(kp, HOSTS[env].adn, `/danfse/${chaveAcesso}`, 'GET');
  if (r.status === 200 && r.buffer && r.buffer.subarray(0, 4).toString() === '%PDF') {
    return { ok: true, pdf: r.buffer, status: r.status };
  }
  return { ok: false, status: r.status };
}
