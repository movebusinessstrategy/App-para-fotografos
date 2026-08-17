import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { ConfirmModal } from "../ui/ConfirmModal";
import { fetchGoogleAdsApi, formatGoogleAdsDate } from "../../features/google-ads/api";

type PlatformAdsAccount = {
  customer_id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: string | null;
  last_tested_at: string | null;
  updated_at: string;
};

type TenantLink = { linked: boolean; account: PlatformAdsAccount | null };

type HierarchyAccount = {
  customer_id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: string | null;
  manager: boolean;
  test_account: boolean;
};

type HierarchyResponse = { manager_customer_id: string; accounts: HierarchyAccount[] };

function customerIdDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function formatCustomerId(value: string) {
  const digits = customerIdDigits(value);
  const sections = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
  return sections.join("-");
}

function isValidCustomerId(value: string) {
  return customerIdDigits(value).length === 10;
}

function accountOptionLabel(account: HierarchyAccount) {
  const name = account.descriptive_name || "Conta sem nome";
  return `${name} · ${formatCustomerId(account.customer_id)}`;
}

export default function GoogleAdsAccountManager({ ownerId }: { ownerId: string }) {
  const [link, setLink] = useState<TenantLink | null>(null);
  const [hierarchy, setHierarchy] = useState<HierarchyResponse | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [authorizationChecked, setAuthorizationChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const endpoint = `/api/platform/tenants/${ownerId}/google-ads-account`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantLink, hierarchyResponse] = await Promise.all([
        fetchGoogleAdsApi<TenantLink>(endpoint),
        fetchGoogleAdsApi<HierarchyResponse>("/api/platform/google-ads/hierarchy"),
      ]);
      setLink(tenantLink);
      setHierarchy(hierarchyResponse);
      setCustomerId(tenantLink.account?.customer_id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a configuração do Google Ads.");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  const eligibleAccounts = useMemo(
    () => (hierarchy?.accounts || []).filter((account) => !account.manager),
    [hierarchy],
  );

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!isValidCustomerId(customerId) || !authorizationChecked) return;
    clearFeedback();
    setBusy("save");
    try {
      const nextLink = await fetchGoogleAdsApi<TenantLink>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ customer_id: customerIdDigits(customerId) }),
      });
      setLink(nextLink);
      setCustomerId(nextLink.account?.customer_id || customerIdDigits(customerId));
      setAuthorizationChecked(false);
      setNotice("Conta validada e vinculada ao estúdio.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível validar esta conta.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    clearFeedback();
    setBusy("test");
    try {
      const response = await fetchGoogleAdsApi<{ ok: true; account: PlatformAdsAccount }>(`${endpoint}/test`, { method: "POST" });
      setLink({ linked: true, account: response.account });
      setNotice("Acesso confirmado com o Google Ads.");
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "O teste de acesso não foi concluído.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    clearFeedback();
    setBusy("delete");
    try {
      await fetchGoogleAdsApi(endpoint, { method: "DELETE" });
      setLink({ linked: false, account: null });
      setCustomerId("");
      setAuthorizationChecked(false);
      setNotice("Vínculo removido. Os dados históricos do tenant não foram apagados.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível remover o vínculo.");
    } finally {
      setBusy(null);
    }
  };

  const currentAccount = link?.account;
  const unchanged = currentAccount?.customer_id === customerIdDigits(customerId);
  const canSave = isValidCustomerId(customerId) && authorizationChecked && !unchanged && !busy;

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <BarChart3 size={19} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Google Ads</h2>
              {currentAccount && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <CheckCircle2 size={10} /> Vinculado
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Mapeamento administrativo da conta autorizada deste tenant.</p>
          </div>
        </div>
        {currentAccount && (
          <button
            type="button"
            onClick={test}
            disabled={Boolean(busy)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-45 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw size={13} className={busy === "test" ? "animate-spin" : ""} />
            Testar acesso
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3 p-5" aria-label="Carregando vínculo do Google Ads">
          <div className="h-4 w-40 rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-10 w-full rounded-lg bg-gray-100 dark:bg-gray-800" />
          <div className="h-4 w-3/4 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ) : (
        <div className="p-5">
          {currentAccount && <CurrentAccount account={currentAccount} />}

          <div className={currentAccount ? "mt-5 border-t border-gray-100 pt-5 dark:border-gray-800" : ""}>
            <label htmlFor="google-ads-customer-id" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {currentAccount ? "Trocar Customer ID" : "Customer ID do estúdio"}
            </label>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              Informe apenas uma conta que já esteja acessível pela estrutura de anúncios da Move e autorizada pelo cliente.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="google-ads-customer-id"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                list="google-ads-customer-accounts"
                value={formatCustomerId(customerId)}
                onChange={(event) => {
                  setCustomerId(customerIdDigits(event.target.value));
                  setAuthorizationChecked(false);
                  clearFeedback();
                }}
                placeholder="123-456-7890"
                aria-describedby="google-ads-customer-help"
                className="min-h-10 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <datalist id="google-ads-customer-accounts">
                {eligibleAccounts.map((account) => (
                  <option key={account.customer_id} value={formatCustomerId(account.customer_id)}>{accountOptionLabel(account)}</option>
                ))}
              </datalist>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Link2 size={13} /> {busy === "save" ? "Validando…" : "Validar e vincular"}
              </button>
            </div>
            <p id="google-ads-customer-help" className="mt-1.5 text-[10px] text-gray-400">
              Use os 10 dígitos exibidos no Google Ads. O vínculo será testado antes de salvar.
            </p>

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
              <input
                type="checkbox"
                checked={authorizationChecked}
                onChange={(event) => setAuthorizationChecked(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span><strong className="font-semibold text-gray-800 dark:text-white">Confirmação de autorização:</strong> conferi que este Customer ID corresponde ao estúdio e que o cliente autorizou o acesso aos dados.</span>
            </label>
          </div>

          {eligibleAccounts.length > 0 && (
            <p className="mt-3 text-[10px] text-gray-400">{eligibleAccounts.length} conta{eligibleAccounts.length === 1 ? "" : "s"} de cliente acessível{eligibleAccounts.length === 1 ? "" : "is"} para conferência administrativa.</p>
          )}

          {(error || notice) && (
            <div role="status" className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${error
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300"}`}>
              {error ? <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />}
              <span>{error || notice}</span>
            </div>
          )}

          {currentAccount && (
            <div className="mt-5 flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40 dark:text-red-400"
              >
                <Trash2 size={13} /> Remover vínculo
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        title="Remover vínculo do Google Ads?"
        message="O tenant deixará de atualizar os anúncios. Os dados históricos já importados serão preservados."
        confirmText="Remover vínculo"
        variant="warning"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}

function CurrentAccount({ account }: { account: PlatformAdsAccount }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/15">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><ShieldCheck size={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{account.descriptive_name || "Conta sem nome no Google Ads"}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-600 dark:text-gray-300">{formatCustomerId(account.customer_id)}</p>
          <dl className="mt-3 grid gap-2 text-[11px] text-gray-500 dark:text-gray-400 sm:grid-cols-3">
            <div><dt>Moeda</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{account.currency_code || "—"}</dd></div>
            <div><dt>Fuso</dt><dd className="mt-0.5 truncate font-medium text-gray-800 dark:text-gray-200" title={account.time_zone || ""}>{account.time_zone || "—"}</dd></div>
            <div><dt>Último teste</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{formatGoogleAdsDate(account.last_tested_at)}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}
