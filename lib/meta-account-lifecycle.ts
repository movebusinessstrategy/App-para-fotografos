export const META_RECONNECT_MESSAGE = 'A Meta interrompeu o vínculo oficial deste número. Reconecte a API oficial mantendo o WhatsApp Business no celular.';

export function isMetaAccountOffboarded(details: Record<string, any>): boolean {
  const event = String(details.account_update?.payload?.event || '').toUpperCase();
  return ['ACCOUNT_OFFBOARDED', 'PARTNER_REMOVED'].includes(event) && details.meta_operational === false;
}

export function buildMetaAccountUpdate(raw: Record<string, any>, previous: Record<string, any>, now: string): { sync_details: Record<string, any>; updated_at: string; sync_status?: string; sync_error?: string; sync_updated_at?: string } {
  const details = { ...previous, account_update: { payload: raw, received_at: now } };
  const event = String(raw.event || '').toUpperCase();
  if (!['ACCOUNT_OFFBOARDED', 'PARTNER_REMOVED'].includes(event)) return { sync_details: details, updated_at: now };
  return {
    sync_status: 'failed', sync_error: META_RECONNECT_MESSAGE, sync_updated_at: now,
    sync_details: { ...details, meta_operational: false, meta_status_checked_at: now,
      phone_status: { ...previous.phone_status, status: 'DISCONNECTED' } },
    updated_at: now,
  };
}
