// Presets de gráficas/laboratórios de álbum do Brasil (pesquisa verificada
// 2026-06-13). Nenhuma tem API pública de envio — o fluxo real é: exportar a
// arte no padrão da gráfica (formato + sangria + sRGB) e SUBIR no portal/gabarito
// dela. Aqui guardamos o preset de export + os links oficiais de cada uma.

export type FormatoEnvio = "pdf" | "jpg" | "both";

// Um tamanho de álbum (medida da PÁGINA FECHADA, em cm).
export interface TamanhoModelo { label: string; w: number; h: number }

// Uma linha/coleção da gráfica, com seus tamanhos.
export interface LinhaGrafica { id: string; nome: string; tamanhos: TamanhoModelo[]; obs?: string }

export interface Grafica {
  id: string;
  nome: string;
  site?: string;
  formato: FormatoEnvio; // formato recomendado de envio
  bleedCm: number;       // sangria recomendada (cm por lado)
  jpegQuality: number;   // qualidade do JPG (0..1)
  minPaginas?: number;   // mínimo de páginas exigido (avisa se faltar)
  cor: string;           // espaço de cor exigido
  envio: string;         // como mandar (resumo curto)
  gabaritoUrl?: string;  // link do gabarito oficial
  portalUrl?: string;    // link do portal de envio (quando há)
  obs?: string;          // checklist/observações importantes
  linhas?: LinhaGrafica[]; // linhas/coleções com seus tamanhos (cm)
}

// Converte um tamanho de modelo no `size` string do álbum ("LxA" em cm).
export function tamanhoToSize(t: TamanhoModelo): string {
  return `${t.w}x${t.h}`;
}

// Helper de tamanho (w×h cm, página fechada). Label com vírgula decimal pt-BR.
const s = (w: number, h: number): TamanhoModelo => ({
  label: `${String(w).replace(".", ",")}×${String(h).replace(".", ",")}`,
  w, h,
});

// ── Matrizes de tamanho compartilhadas entre linhas ──────────────────────────
// Grafis (do seletor oficial dos gabaritos): quadrados + retrato + paisagem.
const GRAFIS_FULL = [
  s(15, 15), s(20, 20), s(25, 25), s(30, 30),
  s(15, 20), s(20, 15), s(20, 25), s(25, 20), s(20, 30), s(30, 20),
  s(25, 30), s(30, 25), s(38, 25), s(30, 40), s(40, 30), s(45, 30),
];
const GRAFIS_COMPACTA = [
  s(15, 15), s(20, 20), s(25, 25), s(30, 30),
  s(15, 20), s(20, 15), s(20, 25), s(25, 20), s(20, 30), s(30, 20),
  s(25, 30), s(30, 25), s(38, 25),
];
const GRAFIS_LED = [s(30, 30), s(30, 25), s(40, 30), s(45, 30)];
// Go image — capa rígida 180° (Premium/Signature/Suede/Linho/Shine).
const GOIMAGE_RIGIDA = [
  s(20, 20), s(25, 25), s(30, 30), s(30, 20), s(30, 25), s(40, 30), s(20, 30), s(25, 30), s(30, 40),
];
const GOIMAGE_FASTBOOK = [
  s(15, 15), s(20, 20), s(25, 25), s(30, 30),
  s(20, 15), s(25, 20), s(30, 20), s(30, 25), s(40, 30), s(15, 20), s(20, 25), s(20, 30), s(25, 30),
];
// Criativa — matriz comum (encadernados + photobooks).
const CRIATIVA_FULL = [
  s(15, 15), s(20, 20), s(25, 25), s(30, 30),
  s(15, 21), s(21, 15), s(20, 25), s(25, 20), s(20, 30), s(30, 20), s(25, 30), s(30, 25), s(35, 30), s(40, 30),
];

// Maioria das encadernadoras premium = sRGB + JPEG/PDF 300 DPI + sangria ~0,5 cm
// (exatamente o que o nosso export gera). Exceções (CMYK/fotolivro offset) ficam
// de fora do foco de álbum.
export const GRAFICAS: Grafica[] = [
  {
    id: "generico",
    nome: "Genérico (qualquer gráfica)",
    formato: "both",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Baixe PDF + JPGs com sangria e envie no canal da sua gráfica.",
    obs: "Padrão que atende a maioria das encadernadoras. Confirme a sangria no gabarito da sua gráfica.",
  },
  {
    id: "grafis",
    nome: "Grafis Encadernadora",
    site: "https://www.grafis.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Diagrame no gabarito (PSD) e envie as lâminas em JPEG alta qualidade.",
    gabaritoUrl: "https://www.grafis.com.br/GabaritosLinhaVolga.aspx",
    obs: "sRGB · ~5 mm de sangria · JPEG por lâmina.",
    linhas: [
      { id: "volga", nome: "Volga", tamanhos: GRAFIS_FULL },
      { id: "tip", nome: "Tip", tamanhos: GRAFIS_FULL },
      { id: "havel", nome: "Havel", tamanhos: GRAFIS_FULL },
      { id: "alfaiate", nome: "Alfaiate", tamanhos: GRAFIS_FULL },
      { id: "bambini", nome: "Bambini", tamanhos: GRAFIS_FULL },
      { id: "nobre", nome: "Nobre", tamanhos: GRAFIS_FULL },
      { id: "real", nome: "Real", tamanhos: GRAFIS_FULL },
      { id: "compacta", nome: "Compacta", tamanhos: GRAFIS_COMPACTA },
      { id: "led", nome: "Led", tamanhos: GRAFIS_LED },
    ],
  },
  {
    id: "digipix",
    nome: "Digipix",
    site: "https://www.digipix.com.br",
    formato: "pdf",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    minPaginas: 20,
    cor: "sRGB ou Adobe RGB (CMYK proibido)",
    envio: "Exporte o PDF e suba no portal em “enterprise/enviar arquivos diagramados em outro software”.",
    gabaritoUrl: "https://www.digipix.com.br/gabaritos",
    portalUrl: "https://direto.digipix.com.br/enviar-projeto/",
    obs: "Mínimo de 20 páginas. Cor RGB (sRGB/AdobeRGB) — nunca CMYK. PDF (padrão X-3).",
    linhas: [
      { id: "photo-hd-prime", nome: "Photo HD Prime", tamanhos: [
        { label: "14,8×14,8", w: 14.8, h: 14.8 }, { label: "21×21", w: 21, h: 21 }, { label: "25×25", w: 25, h: 25 }, { label: "29,7×29,7", w: 29.7, h: 29.7 },
        { label: "14,8×21", w: 14.8, h: 21 }, { label: "21×14,8", w: 21, h: 14.8 }, { label: "21×29,7", w: 21, h: 29.7 }, { label: "29,7×21", w: 29.7, h: 21 },
      ] },
      { id: "180-flat", nome: "180° Flat", tamanhos: [
        { label: "29,7×29,7", w: 29.7, h: 29.7 }, { label: "29,7×42", w: 29.7, h: 42 }, { label: "42×29,7", w: 42, h: 29.7 },
      ] },
    ],
  },
  {
    id: "premiere",
    nome: "Encadernadora Premiere",
    site: "http://www.encadernadorapremiere.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Gabarito (Photoshop/InDesign) por tamanho; envie as lâminas em JPEG.",
    gabaritoUrl: "http://www.encadernadorapremiere.com.br/gabaritos-para-albuns-encadernados-fotos/gabaritos",
    obs: "sRGB · guias de sangria no gabarito · não colar texto perto da borda.",
    linhas: [
      { id: "encadernado", nome: "Álbum encadernado", tamanhos: [s(20, 20), s(25, 25), s(30, 30)], obs: "Confirme tamanhos extras no gabarito (sob encomenda também)." },
    ],
  },
  {
    id: "duboni",
    nome: "Duboni",
    site: "https://www.duboni.com.br",
    formato: "both",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Envie PDF + JPGs no canal da Duboni (eles também têm o software Sigi).",
    gabaritoUrl: "http://www.duboni.com.br/downloads",
    obs: "sRGB · ~0,5 cm de margem de segurança. Tabela completa de tamanhos no site/telefone.",
    linhas: [
      { id: "album", nome: "Álbum (tamanhos usuais)", tamanhos: [s(20, 20), s(25, 25), s(30, 30), s(20, 30), s(30, 20), s(40, 30)], obs: "Confirme na Tabela de Tamanhos da Duboni." },
      { id: "minibook", nome: "Minibook", tamanhos: [s(10, 15), s(13, 18), s(15, 20), s(20, 30)] },
    ],
  },
  {
    id: "dreambooks",
    nome: "Dreambooks",
    site: "https://www.dreambooks.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Suba as lâminas (JPG) no editor Dreambooks, ou diagrame pelo gabarito PSD.",
    gabaritoUrl: "https://www.dreambooks.com.br/gabaritos",
    obs: "sRGB (perfil incorporado) · 300 DPI · JPG qualidade máxima · não aceita HEIC.",
    linhas: [
      { id: "album", nome: "Álbum / Fotolivro", tamanhos: [
        { label: "15×15", w: 15, h: 15 }, { label: "21×21", w: 21, h: 21 }, { label: "25×25", w: 25, h: 25 }, { label: "30×30", w: 30, h: 30 },
        { label: "20×30", w: 20, h: 30 }, { label: "30×20", w: 30, h: 20 }, { label: "23×31", w: 23, h: 31 }, { label: "31×23", w: 31, h: 23 }, { label: "40×30", w: 40, h: 30 },
      ] },
    ],
  },
  {
    id: "goimage",
    nome: "Go image Encadernadora",
    site: "https://www.goimage.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Gabarito por modelo; envie as lâminas com a sangria preenchida.",
    gabaritoUrl: "https://www.goimage.com.br/gabaritos",
    obs: "Sangria obrigatória (preencher até a borda do gabarito).",
    linhas: [
      { id: "fastbook", nome: "Fastbook", tamanhos: GOIMAGE_FASTBOOK },
      { id: "premium", nome: "Premium", tamanhos: GOIMAGE_RIGIDA },
      { id: "signature", nome: "Signature", tamanhos: GOIMAGE_RIGIDA },
      { id: "suede", nome: "Suede", tamanhos: GOIMAGE_RIGIDA },
      { id: "linho", nome: "Linho", tamanhos: GOIMAGE_RIGIDA },
      { id: "shine", nome: "Shine", tamanhos: GOIMAGE_RIGIDA },
      { id: "easybook", nome: "Easybook", tamanhos: [s(20, 20), s(25, 25), s(30, 20), s(20, 30)] },
      { id: "glossybook", nome: "Glossybook", tamanhos: [s(24, 24)] },
      { id: "minibook", nome: "Minibook", tamanhos: [s(21, 15), s(15, 21), s(15, 10), s(10, 15)] },
      { id: "pocket", nome: "Pocket Álbum", tamanhos: [s(10, 10)] },
    ],
  },
  {
    id: "profox",
    nome: "Profox / Profoxlab",
    site: "https://profoxlab.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Baixe o gabarito (Linha Ravenna) e envie as lâminas no padrão deles.",
    gabaritoUrl: "https://wp.profoxlab.com.br/downloads/",
    linhas: [
      { id: "ravenna", nome: "Linha Clássica Ravenna", tamanhos: [
        { label: "25×20", w: 25, h: 20 }, { label: "30×20", w: 30, h: 20 }, { label: "30×24", w: 30, h: 24 }, { label: "30×25", w: 30, h: 25 },
        { label: "35×25", w: 35, h: 25 }, { label: "38×25", w: 38, h: 25 }, { label: "35×30", w: 35, h: 30 }, { label: "40×30", w: 40, h: 30 }, { label: "45×30", w: 45, h: 30 },
      ] },
    ],
  },
  {
    id: "criativa",
    nome: "Criativa Álbuns",
    site: "https://criativaalbuns.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.95,
    cor: "sRGB",
    envio: "Gabarito (InDesign/Photoshop); envie as lâminas no padrão da coleção.",
    gabaritoUrl: "https://criativaalbuns.com.br/gabaritos/",
    linhas: [
      { id: "encadernado", nome: "Encadernado (Couro/Corino/Fotográfica/Tecido)", tamanhos: CRIATIVA_FULL },
      { id: "encadernado-acrilica", nome: "Encadernado Acrílica", tamanhos: CRIATIVA_FULL },
      { id: "photobook", nome: "Photobook (Fotográfica/Corino/Tecido)", tamanhos: CRIATIVA_FULL },
      { id: "photobook-acrilica", nome: "Photobook Acrílica", tamanhos: [s(20, 20), s(25, 25), s(30, 30), s(25, 30), s(30, 25), s(35, 30), s(40, 30)] },
      { id: "fotolivro-classic", nome: "Fotolivro Classic", tamanhos: [s(20, 20), s(30, 30)] },
      { id: "revista", nome: "Revista", tamanhos: [s(20, 29)] },
    ],
  },
  {
    id: "illumine",
    nome: "Illumine Encadernadora",
    site: "https://illuminepro.com.br",
    formato: "jpg",
    bleedCm: 0.5,
    jpegQuality: 0.9,
    cor: "RGB (sRGB)",
    envio: "Envie as lâminas em JPEG (qualidade ~10). Área de segurança ~1 cm.",
    gabaritoUrl: "https://illuminepro.com.br/arte-formatos/",
    obs: "RGB · refile/segurança ~1 cm da borda · JPEG qualidade 10 (evitar 11/12).",
    linhas: [
      { id: "topazio", nome: "Topázio", tamanhos: [s(19, 19)] },
      { id: "safira", nome: "Safira", tamanhos: [s(15, 20), s(20, 20), s(20, 25), s(20, 30)] },
      { id: "jade", nome: "Jade", tamanhos: [s(15, 20), s(20, 20), s(20, 25), s(20, 30), s(25, 25), s(25, 30), s(30, 30)] },
      { id: "diamante", nome: "Diamante", tamanhos: [s(20, 25), s(20, 30), s(25, 25), s(25, 30), s(30, 30), s(30, 40), s(30, 45), s(38, 38)] },
    ],
  },
];

const INDEX: Record<string, Grafica> = Object.fromEntries(GRAFICAS.map((g) => [g.id, g]));

export function graficaById(id: string | null | undefined): Grafica {
  return (id && INDEX[id]) || GRAFICAS[0];
}
