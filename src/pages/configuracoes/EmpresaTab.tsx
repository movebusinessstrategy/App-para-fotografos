import React, { useEffect, useRef, useState } from "react";
import { Save, Loader2, Check, Search } from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { fetchAddressByCEP, fetchCompanyByCNPJ } from "../../utils/lookups";

interface CompanyInfo {
  trade_name?: string;
  legal_name?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  address_line?: string;
  address_number?: string;
  address_complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  logo_url?: string;
  website?: string;
  instagram?: string;
  about?: string;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  full?: boolean;
  loading?: boolean;
}

function Field({ label, value, onChange, type = "text", placeholder, full = false, loading = false }: FieldProps) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:border-gold-400 outline-none"
        />
        {loading && (
          <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
        )}
      </div>
    </div>
  );
}

function formatCNPJ(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatCEP(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export default function EmpresaTab() {
  const [data, setData] = useState<CompanyInfo>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const cepDebounce = useRef<NodeJS.Timeout | null>(null);
  const cnpjDebounce = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    authFetch("/api/company-info")
      .then(r => r.json())
      .then(d => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  const update = (k: keyof CompanyInfo) => (v: string) => setData(prev => ({ ...prev, [k]: v }));

  // Auto-busca de CNPJ: ao chegar em 14 dígitos, busca na BrasilAPI e preenche os campos vazios
  const onCNPJChange = (v: string) => {
    const formatted = formatCNPJ(v);
    setData(prev => ({ ...prev, cnpj: formatted }));
    const digits = v.replace(/\D/g, "");
    if (cnpjDebounce.current) clearTimeout(cnpjDebounce.current);
    if (digits.length === 14) {
      cnpjDebounce.current = setTimeout(async () => {
        setCnpjLoading(true);
        const res = await fetchCompanyByCNPJ(digits);
        setCnpjLoading(false);
        if (!res) return;
        // Preenche só os campos que estão vazios — não sobrescreve dados editados manualmente
        setData(prev => ({
          ...prev,
          legal_name:        prev.legal_name        || res.legal_name,
          trade_name:        prev.trade_name        || res.trade_name,
          email:             prev.email             || res.email,
          phone:             prev.phone             || res.phone,
          postal_code:       prev.postal_code       || formatCEP(res.cep),
          address_line:      prev.address_line      || res.address_line,
          address_number:    prev.address_number    || res.address_number,
          address_complement: prev.address_complement || res.address_complement,
          neighborhood:      prev.neighborhood      || res.neighborhood,
          city:              prev.city              || res.city,
          state:             prev.state             || res.state,
        }));
      }, 400);
    }
  };

  // Auto-busca de CEP: ao chegar em 8 dígitos, preenche endereço
  const onCEPChange = (v: string) => {
    const formatted = formatCEP(v);
    setData(prev => ({ ...prev, postal_code: formatted }));
    const digits = v.replace(/\D/g, "");
    if (cepDebounce.current) clearTimeout(cepDebounce.current);
    if (digits.length === 8) {
      cepDebounce.current = setTimeout(async () => {
        setCepLoading(true);
        const res = await fetchAddressByCEP(digits);
        setCepLoading(false);
        if (!res) return;
        setData(prev => ({
          ...prev,
          address_line: res.address_line || prev.address_line,
          neighborhood: res.neighborhood || prev.neighborhood,
          city:         res.city         || prev.city,
          state:        res.state        || prev.state,
        }));
      }, 350);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = { ...data, cnpj: data.cnpj?.replace(/\D/g, ""), postal_code: data.postal_code?.replace(/\D/g, "") };
      const res = await authFetch("/api/company-info", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Dados da empresa</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Esses dados aparecem em contratos, cobranças e comunicações com seus clientes.
        </p>
      </div>

      {/* CNPJ no topo — autopreenche tudo */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Search size={14} /> Identificação
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="CNPJ (preenche automático)"
            value={data.cnpj || ""}
            onChange={onCNPJChange}
            placeholder="00.000.000/0001-00"
            loading={cnpjLoading}
          />
          <Field label="Razão social"     value={data.legal_name || ""}  onChange={update("legal_name")}  placeholder="Pitori Fotografia LTDA" />
          <Field label="Nome fantasia"    value={data.trade_name || ""}  onChange={update("trade_name")}  placeholder="Estúdio Pitori" />
          <Field label="Email comercial"  value={data.email || ""}       onChange={update("email")}       type="email" placeholder="contato@empresa.com" />
          <Field label="Telefone"         value={data.phone || ""}       onChange={update("phone")}       placeholder="(43) 99999-9999" />
          <Field label="Site"             value={data.website || ""}     onChange={update("website")}     placeholder="https://" />
          <Field label="Instagram"        value={data.instagram || ""}   onChange={update("instagram")}   placeholder="@empresa" />
          <Field label="Logo (URL)"       value={data.logo_url || ""}    onChange={update("logo_url")}    placeholder="https://..." full />
        </div>
      </div>

      {/* CEP primeiro no endereço — autopreenche logradouro/bairro/cidade/UF */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Search size={14} /> Endereço
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="CEP (preenche automático)"
            value={data.postal_code || ""}
            onChange={onCEPChange}
            placeholder="00000-000"
            loading={cepLoading}
          />
          <div /> {/* espaçador */}
          <Field label="Endereço"      value={data.address_line || ""}       onChange={update("address_line")}       placeholder="Rua, Avenida..." full />
          <Field label="Número"        value={data.address_number || ""}     onChange={update("address_number")}     />
          <Field label="Complemento"   value={data.address_complement || ""} onChange={update("address_complement")} />
          <Field label="Bairro"        value={data.neighborhood || ""}       onChange={update("neighborhood")}       />
          <Field label="Cidade"        value={data.city || ""}               onChange={update("city")}               />
          <Field label="Estado (UF)"   value={data.state || ""}              onChange={update("state")}              placeholder="PR" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Sobre</h3>
        <textarea
          rows={3}
          value={data.about || ""}
          onChange={(e) => setData(prev => ({ ...prev, about: e.target.value }))}
          placeholder="Breve descrição da sua empresa (aparece em contratos e propostas)..."
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:border-gold-400 outline-none resize-y"
        />
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Salvar
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <Check size={14} /> Salvo!
          </span>
        )}
      </div>
    </div>
  );
}
