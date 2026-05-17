import React, { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, QrCode, Loader2, ChevronLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { authFetch } from "../utils/authFetch";
import { useApi } from "../utils/useApi";

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  limits: Record<string, number | boolean>;
}

interface BillingMe {
  subscription_status: string;
  trial_days_left: number;
  trial_ends_at: string | null;
  asaas_subscription_id: string | null;
  plan: Plan | null;
}

type Method = "PIX" | "CREDIT_CARD";

const FEATURES_BY_PLAN: Record<string, string[]> = {
  pro: [
    "Até 500 clientes e 500 jobs",
    "5 membros na equipe",
    "Pipeline de vendas Kanban",
    "Inbox WhatsApp integrado",
    "Contratos e cobranças",
    "Catálogo (produtos/serviços/combos)",
    "Suporte por email",
  ],
  business: [
    "Tudo do Pro, sem limites",
    "Membros da equipe ilimitados",
    "Clientes e jobs ilimitados",
    "Prioridade no suporte",
  ],
};

export default function PlanosPage() {
  const navigate = useNavigate();
  const { data: plansData } = useApi<Plan[]>("/api/platform/plans-public");
  const { data: me, mutate: refreshMe } = useApi<BillingMe>("/api/billing/me");
  const plans = useMemo(
    () => (Array.isArray(plansData) ? plansData.filter(p => p.slug !== "free") : []),
    [plansData]
  );

  const [selectedSlug, setSelectedSlug] = useState<string>("pro");
  const [method, setMethod] = useState<Method>("PIX");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [phone, setPhone] = useState("");
  const [card, setCard] = useState({ holderName: "", number: "", expiry: "", ccv: "" });
  const [holderEmail, setHolderEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ status: string } | null>(null);

  const selectedPlan = plans.find(p => p.slug === selectedSlug);
  const isCurrentActive = me?.subscription_status === "active" && me?.plan?.slug === selectedSlug;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setError(null);
    setLoading(true);
    try {
      const body: any = {
        planSlug: selectedSlug,
        billingType: method,
        cpfCnpj: cpfCnpj.replace(/\D/g, ""),
        mobilePhone: phone.replace(/\D/g, "") || undefined,
      };
      if (method === "CREDIT_CARD") {
        const [mm, yy] = card.expiry.split("/").map(s => s.trim());
        body.creditCard = {
          holderName: card.holderName,
          number: card.number.replace(/\D/g, ""),
          expiryMonth: mm,
          expiryYear: yy?.length === 2 ? `20${yy}` : yy,
          ccv: card.ccv,
        };
        body.creditCardHolderInfo = {
          name: card.holderName,
          email: holderEmail,
          cpfCnpj: cpfCnpj.replace(/\D/g, ""),
          postalCode: postalCode.replace(/\D/g, ""),
          addressNumber,
          mobilePhone: phone.replace(/\D/g, "") || undefined,
        };
      }
      const res = await authFetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao processar pagamento");
      setSuccess({ status: data.status });
      refreshMe();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-sm border border-gray-100 dark:border-gray-700 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Check className="text-green-600 dark:text-green-400" size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            {method === "PIX" ? "Assinatura criada!" : "Pagamento processado!"}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {method === "PIX"
              ? "Você receberá um QR Code por email pra confirmar o primeiro pagamento. As cobranças recorrentes virão automáticas todo mês."
              : "Seu cartão foi cobrado e a assinatura está ativa. Próxima cobrança em 30 dias."}
          </p>
          <button
            onClick={() => navigate("/assinatura")}
            className="px-5 py-2.5 bg-gold-600 hover:bg-gold-700 text-white rounded-lg text-sm font-medium"
          >
            Ver minha assinatura
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-6">
        <ChevronLeft size={16} /> Voltar
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Escolha seu plano</h1>
        {me?.subscription_status === "trial" && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Você está no trial — {me.trial_days_left} {me.trial_days_left === 1 ? "dia restante" : "dias restantes"}.
          </p>
        )}
      </div>

      {/* Cards dos planos */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {plans.map(plan => {
          const selected = selectedSlug === plan.slug;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedSlug(plan.slug)}
              className={`text-left rounded-2xl p-6 border-2 transition-all ${
                selected
                  ? "border-gold-500 bg-gold-50/40 dark:bg-gold-900/10 shadow-md"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                {isCurrentActive && plan.slug === me?.plan?.slug && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Atual</span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">R$ {(plan.price_cents / 100).toFixed(0)}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">/mês</span>
              </div>
              <ul className="space-y-1.5">
                {(FEATURES_BY_PLAN[plan.slug] || []).map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <Check size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* Formulário */}
      <form onSubmit={submit} className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Forma de pagamento</h2>

        <div className="grid grid-cols-2 gap-3">
          {(["PIX", "CREDIT_CARD"] as Method[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                method === m
                  ? "border-gold-500 bg-gold-50/40 dark:bg-gold-900/10 text-gold-700 dark:text-gold-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
              }`}
            >
              {m === "PIX" ? <QrCode size={16} /> : <CreditCard size={16} />}
              {m === "PIX" ? "PIX (recorrente)" : "Cartão de crédito"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">CPF/CNPJ</label>
            <input
              required
              value={cpfCnpj}
              onChange={e => setCpfCnpj(e.target.value)}
              placeholder="000.000.000-00"
              className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Celular</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {method === "CREDIT_CARD" && (
          <div className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-4">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Nome no cartão</label>
              <input
                required
                value={card.holderName}
                onChange={e => setCard({ ...card, holderName: e.target.value })}
                className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Número do cartão</label>
              <input
                required
                value={card.number}
                onChange={e => setCard({ ...card, number: e.target.value })}
                placeholder="0000 0000 0000 0000"
                className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Validade (MM/AAAA)</label>
                <input
                  required
                  value={card.expiry}
                  onChange={e => setCard({ ...card, expiry: e.target.value })}
                  placeholder="MM/AAAA"
                  className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">CCV</label>
                <input
                  required
                  value={card.ccv}
                  onChange={e => setCard({ ...card, ccv: e.target.value })}
                  placeholder="123"
                  className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Email do titular</label>
                <input
                  required
                  type="email"
                  value={holderEmail}
                  onChange={e => setHolderEmail(e.target.value)}
                  className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">CEP</label>
                <input
                  required
                  value={postalCode}
                  onChange={e => setPostalCode(e.target.value)}
                  className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Número do endereço</label>
              <input
                required
                value={addressNumber}
                onChange={e => setAddressNumber(e.target.value)}
                className="w-full mt-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !selectedPlan}
          className="w-full py-3 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {selectedPlan
            ? `Assinar ${selectedPlan.name} — R$ ${(selectedPlan.price_cents / 100).toFixed(2)}/mês`
            : "Selecione um plano"}
        </button>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
          Pagamento processado por Asaas. Cancele quando quiser.
        </p>
      </form>
    </div>
  );
}
