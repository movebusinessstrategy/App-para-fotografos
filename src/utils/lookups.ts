// Buscas automáticas em APIs públicas brasileiras.
// CEP via ViaCEP (https://viacep.com.br), CNPJ via BrasilAPI (https://brasilapi.com.br).

export interface AddressResult {
  cep: string;
  address_line: string;
  neighborhood: string;
  city: string;
  state: string;
}

export async function fetchAddressByCEP(cep: string): Promise<AddressResult | null> {
  const clean = String(cep || "").replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    const data = await res.json();
    if (data?.erro) return null;
    return {
      cep: clean,
      address_line: data.logradouro || "",
      neighborhood: data.bairro || "",
      city: data.localidade || "",
      state: data.uf || "",
    };
  } catch {
    return null;
  }
}

export interface CompanyResult {
  cnpj: string;
  legal_name: string;       // razão social
  trade_name: string;       // nome fantasia
  email: string;
  phone: string;
  cep: string;
  address_line: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export async function fetchCompanyByCNPJ(cnpj: string): Promise<CompanyResult | null> {
  const clean = String(cnpj || "").replace(/\D/g, "");
  if (clean.length !== 14) return null;
  try {
    // BrasilAPI consulta a Receita sem rate limit dura
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
    if (!res.ok) return null;
    const d = await res.json();
    const phone = [d.ddd_telefone_1, d.ddd_telefone_2].filter(Boolean)[0] || "";
    return {
      cnpj: clean,
      legal_name: d.razao_social || "",
      trade_name: d.nome_fantasia || d.razao_social || "",
      email: d.email || "",
      phone,
      cep: (d.cep || "").replace(/\D/g, ""),
      address_line: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" "),
      address_number: d.numero || "",
      address_complement: d.complemento || "",
      neighborhood: d.bairro || "",
      city: d.municipio || "",
      state: d.uf || "",
    };
  } catch {
    return null;
  }
}
