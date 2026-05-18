// Biblioteca pra importar histórico de contratos do Autentique.
// Lista documentos via GraphQL, baixa o PDF assinado, faz parse de texto
// e devolve dados estruturados pra match/import na base.

// @ts-ignore - pdf-parse não tem types oficiais
import pdfParse from 'pdf-parse';

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

export async function fetchAllAutentiqueDocs(
  apiKey: string,
  sandbox: boolean,
): Promise<AutentiqueDoc[]> {
  const all: AutentiqueDoc[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const res = await fetchAutentiqueDocsPage(apiKey, sandbox, page, 60);
    all.push(...res.docs);
    lastPage = res.last_page;
    page++;
    // Delay leve entre páginas pra não bater no rate limit
    if (page <= lastPage) await new Promise((r) => setTimeout(r, 250));
  } while (page <= lastPage);
  return all;
}

// ─── PDF Parser ──────────────────────────────────────────────────────────

export interface ParsedContract {
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  client_cpf?: string;
  client_address?: string;
  client_cep?: string;
  client_city?: string;
  client_state?: string;
  job_type?: string;
  job_value?: number;
  job_date?: string;
  raw_text_preview?: string;
}

// Mapeamento de palavras-chave → tipo de ensaio
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

export function parseContractText(text: string): ParsedContract {
  const result: ParsedContract = {};
  result.raw_text_preview = text.slice(0, 300);

  // CPF
  const cpfMatch = text.match(/(\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\s]?\d{2})/);
  if (cpfMatch) {
    const digits = cpfMatch[1].replace(/\D/g, '');
    if (digits.length === 11) result.client_cpf = digits;
  }

  // Email
  const emailMatch = text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (emailMatch) result.client_email = emailMatch[1].toLowerCase();

  // Telefone — formato BR comum
  const phoneMatch = text.match(/\(?(\d{2})\)?\s*9?\s*(\d{4,5})[-\s]?(\d{4})/);
  if (phoneMatch) {
    const all = phoneMatch[0].replace(/\D/g, '');
    if (all.length >= 10 && all.length <= 11) result.client_phone = all;
  }

  // CEP
  const cepMatch = text.match(/\b(\d{5})-?(\d{3})\b/);
  if (cepMatch) result.client_cep = cepMatch[1] + cepMatch[2];

  // Valor — primeiro R$ que aparece (geralmente o valor do contrato)
  const valueMatch = text.match(/R\$\s*([\d\.]+,\d{2})/);
  if (valueMatch) {
    const n = parseFloat(valueMatch[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0) result.job_value = n;
  }

  // Nome — após labels comuns OU primeiras palavras capitalizadas
  const nameLabels = [
    /(?:CONTRATANTE|Cliente|Nome\s+completo|Nome)\s*:?\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+(?:\s+[A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý]+){1,6})/,
  ];
  for (const re of nameLabels) {
    const m = text.match(re);
    if (m && m[1].trim().length > 4) { result.client_name = m[1].trim(); break; }
  }

  // Endereço — linha após "Endereço:"
  const addrMatch = text.match(/endere[çc]o\s*:?\s*([^\n\r]{5,120})/i);
  if (addrMatch) result.client_address = addrMatch[1].trim().replace(/\s+/g, ' ');

  // Cidade
  const cityMatch = text.match(/cidade\s*:?\s*([A-ZÀ-Ý][a-zà-ÿA-ZÀ-Ý\s]{2,40}?)(?:[\s\/,]+([A-Z]{2}))?(?:\s|$|\n)/i);
  if (cityMatch) {
    result.client_city = cityMatch[1].trim();
    if (cityMatch[2]) result.client_state = cityMatch[2];
  }

  // Tipo de ensaio
  for (const [re, type] of SESSION_KEYWORDS) {
    if (re.test(text)) { result.job_type = type; break; }
  }

  // Data do ensaio — labels comuns
  const dateLabels = [
    /(?:data\s+do\s+ensaio|data\s+da\s+sess[ãa]o|dia\s+do\s+ensaio|agendado\s+para|data\s+do\s+evento|data\s+do\s+casamento)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
  ];
  for (const re of dateLabels) {
    const m = text.match(re);
    if (m) {
      const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
      result.job_date = `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      break;
    }
  }

  return result;
}

export async function downloadAndParsePdf(url: string): Promise<ParsedContract> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download falhou: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const parsed = await pdfParse(buf);
  return parseContractText(parsed.text || '');
}
