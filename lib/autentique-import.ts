// Biblioteca pra importar histórico de contratos do Autentique.
// - Listagem: usa só metadados do GraphQL (rápido, sem PDF)
// - Import: baixa o PDF assinado e extrai CPF/telefone/endereço/valor
//   com regex (lento mas dados completos)

const AUTENTIQUE_GQL = (sandbox: boolean) =>
  sandbox
    ? 'https://api.autentique.com.br/v2/graphql?sandbox=true'
    : 'https://api.autentique.com.br/v2/graphql';

export interface AutentiqueSigner {
  public_id: string;
  name: string | null;
  email: string | null;
  signed_at: string | null;
}

export interface AutentiqueDoc {
  id: string;
  name: string;
  created_at: string;
  signers: AutentiqueSigner[];
  pdf_url: string | null;
}

export async function fetchAutentiqueDocsPage(
  apiKey: string,
  sandbox: boolean,
  page = 1,
  limit = 60,
): Promise<{ docs: AutentiqueDoc[]; total: number; last_page: number; current_page: number }> {
  const query = `
    query Documents($page: Int!, $limit: Int!) {
      documents(page: $page, limit: $limit) {
        total
        last_page
        current_page
        data {
          id
          name
          created_at
          files { signed original }
          signatures {
            public_id name email
            signed { created_at }
          }
        }
      }
    }
  `;
  const r = await fetch(AUTENTIQUE_GQL(sandbox), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { page, limit } }),
  });
  const json: any = await r.json();
  if (json.errors?.length) {
    throw new Error('Autentique: ' + (json.errors[0]?.message || 'erro desconhecido'));
  }
  const root = json.data?.documents || {};
  const docs: AutentiqueDoc[] = (root.data || []).map((d: any) => ({
    id: d.id,
    name: d.name || '',
    created_at: d.created_at,
    signers: (d.signatures || []).map((s: any) => ({
      public_id: s.public_id,
      name: s.name || null,
      email: s.email || null,
      signed_at: s.signed?.created_at || null,
    })),
    pdf_url: d.files?.signed || d.files?.original || null,
  }));
  return {
    docs,
    total: root.total || 0,
    last_page: root.last_page || 1,
    current_page: root.current_page || page,
  };
}

// ─── Extração de metadados ─────────────────────────────────────────────

export interface ExtractedFromDoc {
  client_name: string | null;
  client_email: string | null;
  job_type: string | null;
  job_date: string;
  doc_name: string;
}

// Tenta detectar tipo de ensaio no NOME do documento (sem PDF).
// Convenção comum: "Contrato - Marina - Newborn", "Pacote Gestante - Júlia", etc.
const SESSION_KEYWORDS: Array<[RegExp, string]> = [
  [/\bnewborn\b/i, 'Newborn'],
  [/\brec[ée]m[\s-]?nascido\b/i, 'Newborn'],
  [/\bgestante\b/i, 'Gestante'],
  [/\bgr[áa]vida\b/i, 'Gestante'],
  [/\bsmash\b/i, 'Smash the Cake'],
  [/\bfam[íi]lia\b/i, 'Família'],
  [/\bm[ãa]e\s+e\s+filh/i, 'Mãe e Filha'],
  [/\bcasamento\b/i, 'Casamento'],
  [/\bwedding\b/i, 'Casamento'],
  [/\bpr[ée][\s-]?wedding\b/i, 'Pre-wedding'],
  [/\baniversário|aniversario\b/i, 'Aniversário'],
  [/\b15\s+anos\b/i, '15 Anos'],
  [/\bdebutante\b/i, '15 Anos'],
  [/\bbook\b/i, 'Book'],
  [/\bcorporativo\b/i, 'Corporativo'],
  [/\bpet\b/i, 'Pet'],
  [/\bensaio\s+externo\b/i, 'Externo'],
  [/\bdia\s+das\s+m[ãa]es\b/i, 'Dia das Mães'],
  [/\bdia\s+dos\s+pais\b/i, 'Dia dos Pais'],
  [/\bnatal\b/i, 'Natal'],
];

function detectJobType(text: string): string | null {
  for (const [re, type] of SESSION_KEYWORDS) {
    if (re.test(text)) return type;
  }
  return null;
}

// Extrai nome do cliente a partir do nome do documento, removendo
// prefixos como "Contrato -", "Pacote -" etc.
function extractClientNameFromDocName(docName: string): string | null {
  if (!docName) return null;
  let cleaned = docName
    .replace(/^(contrato|pacote|documento|sess[ãa]o|ensaio)\s*[-–—:]?\s*/i, '')
    .replace(/\s*[-–—:]\s*(newborn|gestante|fam[íi]lia|smash|casamento|aniversário|aniversario|book|pet|natal|p[áa]scoa).*$/i, '')
    .trim();
  // Se sobrou pelo menos um nome próprio (palavra capitalizada), retorna
  const match = cleaned.match(/^([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+(?:\s+[A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+){0,5})/);
  return match ? match[1].trim() : null;
}

export function extractFromDoc(doc: AutentiqueDoc): ExtractedFromDoc {
  // Cliente: prioriza primeiro signatário (mais confiável que o nome do doc)
  const firstSigner = doc.signers?.[0] || null;
  const fromSigner = firstSigner?.name?.trim() || null;
  const fromDocName = extractClientNameFromDocName(doc.name);

  return {
    client_name: fromSigner || fromDocName || null,
    client_email: firstSigner?.email?.toLowerCase().trim() || null,
    job_type: detectJobType(doc.name) || detectJobType(firstSigner?.name || ''),
    job_date: (doc.created_at || '').slice(0, 10),
    doc_name: doc.name,
  };
}

// ─── PDF parse (rico — pra modo de import) ─────────────────────────────

export interface FullParsedContract extends ExtractedFromDoc {
  client_cpf?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  client_cep?: string | null;
  client_city?: string | null;
  client_state?: string | null;
  job_value?: number | null;
  // Sobrescreve job_date se achar uma "data do ensaio" explícita no PDF
  pdf_text_preview?: string;
}

function parsePdfText(text: string, base: ExtractedFromDoc): FullParsedContract {
  const r: FullParsedContract = { ...base };

  // CPF — primeira ocorrência válida
  const cpfMatch = text.match(/(\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\s]?\d{2})/);
  if (cpfMatch) {
    const d = cpfMatch[1].replace(/\D/g, '');
    if (d.length === 11) r.client_cpf = d;
  }

  // Email — só sobrescreve se o do GraphQL tava vazio
  if (!r.client_email) {
    const em = text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (em) r.client_email = em[1].toLowerCase();
  }

  // Telefone BR (com ou sem 9, com ou sem DDD entre parênteses)
  const ph = text.match(/\(?(\d{2})\)?\s*9?\s*(\d{4,5})[-\s]?(\d{4})/);
  if (ph) {
    const all = ph[0].replace(/\D/g, '');
    if (all.length >= 10 && all.length <= 11) r.client_phone = all;
  }

  // CEP
  const cep = text.match(/\b(\d{5})-?(\d{3})\b/);
  if (cep) r.client_cep = cep[1] + cep[2];

  // Valor — pega o PRIMEIRO R$ encontrado (geralmente o total do contrato)
  // Aceita formatos: R$ 1.200,00 / R$1200 / R$ 850,50
  const val = text.match(/R\$\s*([\d.]+,\d{2}|\d+[.,]\d{2}|\d{2,7})/);
  if (val) {
    const raw = val[1].replace(/\./g, '').replace(',', '.');
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0 && n < 1_000_000) r.job_value = n;
  }

  // Nome do cliente — se a versão da API veio vazia, tenta no texto
  if (!r.client_name) {
    const m = text.match(/(?:CONTRATANTE|Cliente|Nome\s+completo|Nome)\s*:?\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+(?:\s+[A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+){1,6})/);
    if (m && m[1].trim().length > 4) r.client_name = m[1].trim();
  }

  // Endereço — linha logo após "Endereço:"
  const addr = text.match(/endere[çc]o\s*:?\s*([^\n\r]{5,120})/i);
  if (addr) r.client_address = addr[1].trim().replace(/\s+/g, ' ');

  // Cidade / UF
  const city = text.match(/cidade\s*:?\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý\s]{2,40}?)(?:[\s\/,]+([A-Z]{2}))?(?:\s|$|\n)/i);
  if (city) {
    r.client_city = city[1].trim();
    if (city[2]) r.client_state = city[2];
  }

  // Tipo de ensaio — se não veio do nome do doc, tenta no texto
  if (!r.job_type) r.job_type = detectJobType(text) || null;

  // Data do ensaio — explícita no PDF tem prioridade sobre created_at
  const dateLabels = [
    /(?:data\s+do\s+ensaio|data\s+da\s+sess[ãa]o|dia\s+do\s+ensaio|agendado\s+para|data\s+do\s+evento|data\s+do\s+casamento)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
  ];
  for (const re of dateLabels) {
    const m = text.match(re);
    if (m) {
      const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
      r.job_date = `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      break;
    }
  }

  r.pdf_text_preview = text.slice(0, 200);
  return r;
}

// Baixa e parseia o PDF assinado de um documento Autentique.
// Usa pdf-parse v1 (legado, sem worker — funciona sem setup em Node).
export async function downloadAndParsePdf(
  url: string,
  base: ExtractedFromDoc,
  timeoutMs = 15_000,
): Promise<FullParsedContract> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`PDF download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    // @ts-ignore — pdf-parse v1 não tem types publicados
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buf);
    return parsePdfText(parsed.text || '', base);
  } finally {
    clearTimeout(t);
  }
}
