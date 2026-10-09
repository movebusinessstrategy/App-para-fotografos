export interface MetaSignupSelection {
  waba_id: string;
  phone_number_id?: string;
}

type SelectionInput = { waba_id?: unknown; phone_number_id?: unknown };

function metaId(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

function requestedSelection(input: SelectionInput): MetaSignupSelection | null {
  if (input.waba_id == null && input.phone_number_id == null) return null;
  const waba_id = metaId(input.waba_id);
  const phone_number_id = metaId(input.phone_number_id);
  if (!waba_id) throw new Error('Selecione a conta e o número do WhatsApp na Meta.');
  if (input.phone_number_id != null && !phone_number_id) throw new Error('Número de identificação do WhatsApp inválido.');
  return phone_number_id ? { waba_id, phone_number_id } : { waba_id };
}

export function resolveMetaSignupSelection(
  authorizedWabas: string[], requested: SelectionInput, current: SelectionInput | null,
): MetaSignupSelection {
  const selection = requestedSelection(requested) ?? requestedSelection(current ?? {});
  if (selection) {
    if (authorizedWabas.length && !authorizedWabas.includes(selection.waba_id)) {
      throw new Error('A conta selecionada não foi autorizada na Meta. O número atual foi preservado.');
    }
    return selection;
  }
  if (authorizedWabas.length !== 1) {
    throw new Error('A Meta retornou várias contas ou nenhuma seleção. Edite as configurações e escolha a conta e o número desejados.');
  }
  return { waba_id: authorizedWabas[0] };
}

export function selectMetaSignupPhone<T extends { id: string }>(phones: T[], expectedId?: string): T {
  const phone = expectedId ? phones.find(item => item.id === expectedId) : phones.length === 1 ? phones[0] : undefined;
  if (!phone) throw new Error('A Meta não confirmou o número selecionado nesta conta. A conexão atual foi preservada.');
  return phone;
}

function decodeSignupEvent(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseMetaSignupSession(origin: string, raw: unknown): MetaSignupSelection | null {
  if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(origin)) return null;
  const event = decodeSignupEvent(raw);
  if (event?.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (!['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(event.event)) return null;
  // No fluxo de Coexistência a Meta pode retornar somente waba_id.
  // O servidor resolve o telefone nessa WABA e recusa listas ambíguas.
  if (event.event === 'FINISH' && !metaId(event.data?.phone_number_id)) return null;
  try { return requestedSelection(event.data ?? {}); } catch { return null; }
}
