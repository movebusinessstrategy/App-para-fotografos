export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55'))
    return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55'))
    return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length >= 10) return `+${d}`;
  return phone;
}

export function getDisplayName(conv: any): string {
  // Tenta todos os campos possíveis de nome
  const candidates = [
    conv?.contact_name,
    conv?.contact?.name,
    conv?.contact?.pushName,
    conv?.contact?.verifyName,
    conv?.contact?.notify,
    conv?.push_name,
    conv?.pushName,
    conv?.name,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'string' && c.trim() && !/^\d+$/.test(c.trim())) {
      return c.trim();
    }
  }

  // Fallback: formata o número
  const phone =
    conv?.phone ||
    conv?.number ||
    conv?.jid?.split('@')[0] ||
    '';
  return phone ? formatPhone(phone) : 'Desconhecido';
}
