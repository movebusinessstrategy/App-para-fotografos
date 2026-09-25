import { getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';

// Conteúdo "de verdade" de uma mensagem recebida pelo QR (Baileys).
//
// Antes o handler usava Object.keys(msg.message)[0] como tipo. Mensagens de
// aparelho vinculado e as respostas da IA oficial da Meta chegam com
// messageContextInfo (metadados, inclusive botMetadata) e às vezes dentro de
// um envelope (botInvokeMessage, ephemeralMessage, documentWithCaptionMessage).
// Quando o envelope vinha primeiro, a mensagem era descartada como "tipo
// desconhecido" e a fala da IA nunca chegava ao CRM.
const EXTRA_WRAPPERS = ['botInvokeMessage', 'botForwardedMessage'] as const;
const MAX_UNWRAP = 5;

type AnyContent = Record<string, any> | null | undefined;

function unwrapExtra(content: AnyContent): AnyContent {
  for (const key of EXTRA_WRAPPERS) {
    const inner = content?.[key]?.message;
    if (inner) return inner;
  }
  return null;
}

export function unwrapIncomingContent(message: AnyContent): Record<string, any> {
  let content: AnyContent = message;
  for (let i = 0; i < MAX_UNWRAP && content; i += 1) {
    const normalized = normalizeMessageContent(content as any) as AnyContent;
    const extra = unwrapExtra(normalized);
    if (!extra) return (normalized || {}) as Record<string, any>;
    content = extra;
  }
  return (content || {}) as Record<string, any>;
}

// Tipo da mensagem ignorando metadados (messageContextInfo,
// senderKeyDistributionMessage). '' quando não há conteúdo reconhecível.
export function incomingContentType(content: AnyContent): string {
  return (content && getContentType(content as any)) || '';
}
