// Presets de gráficas/laboratórios de álbum do Brasil (pesquisa verificada
// 2026-06-13). Nenhuma tem API pública de envio — o fluxo real é: exportar a
// arte no padrão da gráfica (formato + sangria + sRGB) e SUBIR no portal/gabarito
// dela. Aqui guardamos o preset de export + os links oficiais de cada uma.

export type FormatoEnvio = "pdf" | "jpg" | "both";

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
}

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
    obs: "sRGB · ~0,5 cm de margem de segurança.",
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
  },
];

const INDEX: Record<string, Grafica> = Object.fromEntries(GRAFICAS.map((g) => [g.id, g]));

export function graficaById(id: string | null | undefined): Grafica {
  return (id && INDEX[id]) || GRAFICAS[0];
}
