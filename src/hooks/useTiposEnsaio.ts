import { useMemo } from "react";
import { useApi } from "../utils/useApi";

// FONTE ÚNICA dos tipos de ensaio (Gestante, Newborn, ...). A lista mestre
// vive na tabela tipo_ensaio_precos, gerenciada em Configurações →
// Oportunidades ("Tipos de ensaio e valor mínimo"). Os selects do app inteiro
// leem daqui — não crie novos arrays hardcoded de tipos.
//
// Conta que nunca personalizou cai na lista padrão abaixo (união das listas
// que antes ficavam espalhadas pelo código).
export const DEFAULT_TIPOS_ENSAIO = [
  "Gestante",
  "Newborn",
  "Acompanhamento",
  "Smash the Cake",
  "Aniversário",
  "Família",
  "Casamento",
  "Batizado",
  "Corporativo",
  "Ensaio Externo",
  "Marca Pessoal",
  "Outros",
];

interface TipoEnsaioRow {
  id: string;
  tipo_nome: string;
  preco_minimo: number;
}

export function useTiposEnsaio(): string[] {
  const { data } = useApi<TipoEnsaioRow[]>("/api/tipo-ensaio-precos");
  return useMemo(() => {
    const fromDb = Array.isArray(data)
      ? data.map((r) => String(r.tipo_nome || "").trim()).filter(Boolean)
      : [];
    return fromDb.length > 0 ? fromDb : DEFAULT_TIPOS_ENSAIO;
  }, [data]);
}

// Garante que o valor atual apareça no select mesmo se o tipo foi removido
// da lista mestre (ex.: job antigo com tipo que não existe mais).
export function tiposComValorAtual(tipos: string[], atual?: string | null): string[] {
  const v = String(atual || "").trim();
  if (!v || tipos.includes(v)) return tipos;
  return [v, ...tipos];
}
