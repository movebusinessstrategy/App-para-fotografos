export function parseDate(dateStr: string | undefined | null) {
  if (!dateStr) return null;
  try {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts.map(Number);
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date;
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    return null;
  }
}

// Data de HOJE no fuso LOCAL do navegador (YYYY-MM-DD).
// NÃO usar `new Date().toISOString().slice(0,10)`: o toISOString converte pra
// UTC, então entre 21:00 e 23:59 no horário de Brasília a data "de hoje" pulava
// pro dia seguinte — e a venda/ensaio era gravado com +1 dia.
export function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Converte uma data JS pra YYYY-MM-DD no fuso LOCAL (mesmo motivo do acima).
export function toLocalISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
