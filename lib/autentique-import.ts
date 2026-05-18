// Biblioteca pra importar histórico de contratos do Autentique.
// Modo "leve": só usa metadados da API GraphQL (nome do doc, signatários,
// data de criação). Não baixa PDFs — é instantâneo. Suficiente pra
// vincular cliente e criar histórico de sessão; campos detalhados
// (CPF, endereço, valor) ficam vazios e podem ser editados depois.

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
