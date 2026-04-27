export function formatBrazilianPhone(phone: string): string {
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55'))
    return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55'))
    return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11)
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone;
}

export function getContactDisplayName(conv: any): string {
  // DEBUG temporário — reporte o que aparece no console
  console.log('[Conversation DEBUG]', {
    phone: conv?.phone,
    contact_name: conv?.contact_name,
    push_name: conv?.push_name,
    pushName: conv?.pushName,
    name: conv?.name,
    contact: conv?.contact,
    allKeys: Object.keys(conv || {}),
  });

  const candidates = [
    conv?.contact?.name,
    conv?.contact?.pushName,
    conv?.contact?.verifiedName,
    conv?.contact?.notify,
    conv?.contact_name,
    conv?.push_name,
    conv?.pushName,
    conv?.name,
    conv?.verifiedName,
    conv?.subject,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'string' && c.trim() && !/^\d+$/.test(c.trim())) {
      return c.trim();
    }
  }

  const phone =
    conv?.phone ||
    conv?.number ||
    conv?.contact?.id?.split('@')[0] ||
    conv?.remoteJid?.split('@')[0] ||
    '';

  return phone ? formatBrazilianPhone(phone) : 'Desconhecido';
}

export function getContactAvatar(conv: any): string | null {
  return (
    conv?.contact?.profilePicUrl ||
    conv?.contact?.profilePictureUrl ||
    conv?.profilePicUrl ||
    conv?.profilePictureUrl ||
    conv?.profile_pic_url ||
    conv?.picture ||
    null
  );
}
