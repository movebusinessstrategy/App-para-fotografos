import { getCachedContact, updateCachedContact } from './contactCache';

export interface ContactInfo {
  name: string;
  avatar: string | null;
  phone: string;
  isGroup: boolean;
}

/**
 * CAMADA 1: Extrai pushName de mensagens recebidas (fromMe=false).
 * Mensagens do DB não persistem pushName, mas mensagens in-memory (webhook) têm.
 */
export function extractNameFromMessages(messages: any[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const fromMe = msg?.from_me ?? msg?.key?.fromMe ?? msg?.fromMe ?? false;
    if (fromMe) continue;
    const pushName = msg?.push_name ?? msg?.pushName ?? msg?.name;
    if (pushName && typeof pushName === 'string' && pushName.trim() && !/^\d+$/.test(pushName.trim())) {
      return pushName.trim();
    }
  }
  return null;
}

/**
 * Resolve nome + foto do contato com 4 camadas de fallback.
 * conversation = objeto flat de /api/inbox/conversations (wa_conversations).
 */
export function extractContact(conversation: any, messages?: any[]): ContactInfo {
  if (!conversation) {
    return { name: 'Desconhecido', avatar: null, phone: '', isGroup: false };
  }

  const phone = String(conversation.phone || '').replace(/\D/g, '');
  const isGroup = conversation.is_group === true;
  const cached = getCachedContact(phone);

  // ═══ NOME: 4 camadas ═══
  let name = '';

  // Camada 1: pushName de mensagens recebidas (webhook/in-memory)
  if (!name && messages && messages.length > 0) {
    const fromMessages = extractNameFromMessages(messages);
    if (fromMessages) name = fromMessages;
  }

  // Camada 2: cache localStorage (persiste entre reloads)
  if (!name && cached?.name) {
    name = cached.name;
  }

  // Camada 3: campos do banco — contact_name é o mais confiável
  if (!name) {
    const candidates = [
      conversation.contact_name,
      conversation.push_name,
      conversation.pushName,
      conversation.name,
      conversation.contact?.name,
      conversation.contact?.pushName,
    ];
    for (const cand of candidates) {
      if (cand && typeof cand === 'string' && cand.trim() && !/^\d+$/.test(cand.trim())) {
        name = cand.trim();
        break;
      }
    }
  }

  // Camada 4: número formatado (sempre funciona)
  if (!name) name = formatBrazilianPhone(phone);

  // ═══ AVATAR ═══
  const avatar =
    cached?.avatar ||
    conversation.profile_pic_url ||
    conversation.profilePicUrl ||
    conversation.profilePictureUrl ||
    conversation.picture ||
    conversation.contact?.profilePicUrl ||
    null;

  // Persiste no cache o que encontramos
  const formattedFallback = formatBrazilianPhone(phone);
  if (phone && (name !== formattedFallback || avatar)) {
    updateCachedContact(phone, {
      name: name !== formattedFallback ? name : undefined,
      avatar: avatar || undefined,
    });
  }

  return { name, avatar, phone, isGroup };
}

export function formatBrazilianPhone(phone: string): string {
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55'))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55'))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11)
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d ? `+${d}` : '';
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const cleaned = name.replace(/[+()\d\s-]/g, ' ').trim();
  if (!cleaned) return name.charAt(0).toUpperCase();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Re-exports para compatibilidade com importações existentes
export function getContactDisplayName(conv: any): string {
  return extractContact(conv).name;
}

export function getContactAvatar(conv: any): string | null {
  return extractContact(conv).avatar;
}
