import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../../utils/authFetch';
import { Deal, PipelineStage } from '../../../types';
import { ContactInfo } from '../types';

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('55')) {
    if (d.length === 12) return d.slice(0, 4) + '9' + d.slice(4);
    return d;
  }
  if (d.length === 11) return '55' + d;
  if (d.length === 10) return '55' + d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

export function useCrmPanel(
  phone: string,
  deals: Deal[],
  onDealUpdated: () => void
) {
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [creating, setCreating] = useState(false);

  const deal = deals.find(
    (d) => normalizePhone(d.contact_phone || '') === normalizePhone(phone)
  );

  useEffect(() => {
    setContactInfo(null);
    setLoadingInfo(true);
    const clean = phone.replace(/\D/g, '');
    authFetch(`/api/inbox/contact-info/${clean}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setContactInfo(d); })
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [phone]);

  const saveName = useCallback(
    async (name: string) => {
      if (!name.trim() || savingName) return;
      setSavingName(true);
      try {
        const clean = phone.replace(/\D/g, '');
        const res = await authFetch(`/api/inbox/contact-name/${clean}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        if (res.ok) {
          setContactInfo((prev) =>
            prev ? { ...prev, contact_name: name.trim() } : prev
          );
        }
      } finally {
        setSavingName(false);
      }
    },
    [phone, savingName]
  );

  const changeStage = useCallback(
    async (stageId: string) => {
      if (!deal || savingStage) return;
      setSavingStage(true);
      try {
        await authFetch(`/api/deals/${deal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ stage: stageId }),
        });
        onDealUpdated();
      } finally {
        setSavingStage(false);
      }
    },
    [deal, savingStage, onDealUpdated]
  );

  const saveNote = useCallback(
    async (note: string) => {
      if (!deal || savingNote) return;
      setSavingNote(true);
      try {
        await authFetch(`/api/deals/${deal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: note }),
        });
        onDealUpdated();
      } finally {
        setSavingNote(false);
      }
    },
    [deal, savingNote, onDealUpdated]
  );

  const createDeal = useCallback(
    async (stages: PipelineStage[]) => {
      if (creating) return;
      setCreating(true);
      const activeStages = stages.filter((s) => !s.is_final);
      const firstStage = activeStages[0];
      const displayName = contactInfo?.contact_name || null;
      try {
        await authFetch('/api/deals', {
          method: 'POST',
          body: JSON.stringify({
            title: displayName || phone,
            contact_name: displayName || null,
            contact_phone: phone,
            stage: firstStage?.id || 'new',
            value: 0,
            priority: 'medium',
          }),
        });
        onDealUpdated();
      } finally {
        setCreating(false);
      }
    },
    [creating, phone, contactInfo, onDealUpdated]
  );

  return {
    contactInfo,
    loadingInfo,
    deal,
    saveName,
    savingName,
    changeStage,
    savingStage,
    saveNote,
    savingNote,
    createDeal,
    creating,
  };
}
