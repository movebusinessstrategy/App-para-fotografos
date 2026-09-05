import type { AttributionLeadRecord } from './marketing-attribution-report.js';

export function filterAttributionRecords(records: AttributionLeadRecord[], anonymous: boolean, search: string) {
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const phoneTerm = term.replace(/\D/g, '');
  return records.filter(record => {
    if (Boolean(record.contact_phone) === anonymous) return false;
    if (!term) return true;
    const values = [record.contact_name, record.contact_phone, record.campaign, record.keyword,
      record.source_label, ...(record.campaigns || []), ...record.pages];
    if (values.some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(term))) return true;
    return phoneTerm.length >= 4 && String(record.contact_phone || '').replace(/\D/g, '').includes(phoneTerm);
  });
}
