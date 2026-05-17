// Helper para falar com a API do Asaas.
// Docs: https://docs.asaas.com/reference/comece-por-aqui
//
// Env vars necessárias:
//   ASAAS_API_KEY=$aact_YourKeyHere      (sandbox ou produção)
//   ASAAS_ENV=sandbox                    (sandbox | production)
//   ASAAS_WEBHOOK_TOKEN=algo-secreto     (validação simples do webhook)
//   APP_PUBLIC_URL=https://seu-app.com   (pra montar successUrl/failureUrl)

const BASE_URL_SANDBOX = 'https://api-sandbox.asaas.com/v3';
const BASE_URL_PROD = 'https://api.asaas.com/v3';

function baseUrl(): string {
  return (process.env.ASAAS_ENV || 'sandbox').toLowerCase() === 'production'
    ? BASE_URL_PROD
    : BASE_URL_SANDBOX;
}

function apiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error('ASAAS_API_KEY não configurada');
  return key;
}

async function asaasFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data?.errors?.[0]?.description) || data?.error || res.statusText;
    throw new Error(`Asaas ${res.status}: ${msg}`);
  }
  return data as T;
}

// ── Customers ───────────────────────────────────────────────────────────────
export interface AsaasCustomer {
  id: string;
  name: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
}

export async function createCustomer(input: {
  name: string;
  email: string;
  cpfCnpj?: string;
  mobilePhone?: string;
  externalReference?: string;
}): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function findCustomerByEmail(email: string): Promise<AsaasCustomer | null> {
  const r = await asaasFetch<{ data: AsaasCustomer[] }>(`/customers?email=${encodeURIComponent(email)}`);
  return r.data?.[0] || null;
}

// ── Subscriptions ───────────────────────────────────────────────────────────
export type AsaasBillingType = 'PIX' | 'CREDIT_CARD' | 'BOLETO' | 'UNDEFINED';
export type AsaasCycle = 'MONTHLY' | 'YEARLY';

export interface AsaasSubscription {
  id: string;
  customer: string;
  value: number;
  billingType: AsaasBillingType;
  status: string;          // ACTIVE | EXPIRED | INACTIVE
  nextDueDate: string;
  cycle: AsaasCycle;
  description?: string;
}

export async function createSubscription(input: {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;     // YYYY-MM-DD
  cycle: AsaasCycle;
  description?: string;
  externalReference?: string;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone?: string;
    mobilePhone?: string;
  };
  remoteIp?: string;
}): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelSubscription(subscriptionId: string): Promise<{ deleted: boolean; id: string }> {
  return asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}

export async function getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>(`/subscriptions/${subscriptionId}`);
}

// ── Payments (pra ler invoiceUrl e status individual) ───────────────────────
export interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string;
  status: string;
  value: number;
  netValue: number;
  billingType: AsaasBillingType;
  dueDate: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
}

export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>(`/payments/${paymentId}`);
}

// ── Helper: cria ou recupera customer por email ─────────────────────────────
export async function upsertCustomer(input: {
  name: string;
  email: string;
  cpfCnpj?: string;
  mobilePhone?: string;
  externalReference?: string;
}): Promise<AsaasCustomer> {
  const existing = await findCustomerByEmail(input.email).catch(() => null);
  if (existing) return existing;
  return createCustomer(input);
}
