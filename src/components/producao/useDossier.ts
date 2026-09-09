import { useEffect, useState } from 'react';
import { authFetch } from '../../utils/authFetch';
import type { DossierPlan } from '../../../dossier-workflow';
export interface DossierMedia { id: string; kind: 'reference' | 'payment'; data_url: string | null; caption: string; quote?: string; unavailable?: boolean; recovered?: boolean; needs_review?: boolean }
export interface StudioDossier { id: string; client_name: string; phone: string; status: string; updated_at: string;
  content: { resumo?: string; preferencias?: string[]; o_que_quer?: string[]; alignment?: DossierPlan; excluded_reference_ids?: string[] } }
export const pendingMessage = (plan: DossierPlan) => ['Vamos combinar os últimos detalhes do seu ensaio? 😊', ...plan.questions.map(q => q.message)].join('\n\n');
const confirmationMessage = 'Reunimos as suas escolhas e referências neste PDF ❤️ É assim que você imaginou? Me avise se quiser ajustar algum detalhe.';
async function jsonResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}
async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
}
export function useDossier(jobId: number) {
  const [dossier, setDossier] = useState<StudioDossier | null>(null);
  const [media, setMedia] = useState<DossierMedia[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [mediaLoading, setMediaLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pdf, setPdf] = useState<{ blob: Blob; url: string; version: string } | null>(null);
  const [uncertain, setUncertain] = useState(false), [asked, setAsked] = useState(false), [sentPdf, setSentPdf] = useState(false);
  const base = `/api/jobs/${jobId}/dossie`;
  useEffect(() => {
    let live = true; setDossier(null); setMedia([]); setLoading(true);
    authFetch(base).then(async response => response.status === 404 ? null : jsonResponse(response))
      .then(result => { if (live) setDossier(result); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [base]);
  useEffect(() => {
    if (!dossier) return;
    let live = true; setMediaLoading(true);
    authFetch(`${base}/media`).then(jsonResponse).then(result => { if (live) setMedia(result); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setMediaLoading(false); });
    return () => { live = false; };
  }, [base, dossier?.updated_at]);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  };
  const prepare = () => run(async () => {
    const result = await jsonResponse(await authFetch(`${base}/prepare`, { method: 'POST' }));
    setDossier(result); setAsked(false); setSentPdf(false); setPdf(null); setNotice('Conversa lida. Combinados, fotos e perguntas atualizados.');
  });
  const save = (values: object) => run(async () => {
    const result = await jsonResponse(await authFetch(`${base}/choices`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, updatedAt: dossier?.updated_at }) }));
    setDossier(result); setSentPdf(false); setPdf(null); setNotice('Escolhas salvas no ensaio.');
  });
  const openPdf = () => run(async () => {
    const response = await authFetch(`${base}/pdf?include_images=1`);
    if (!response.ok) { await jsonResponse(response); return; }
    const blob = await response.blob(); setPdf({ blob, url: URL.createObjectURL(blob), version: dossier!.updated_at });
  });
  const sendQuestions = () => run(async () => {
    if (!dossier?.content.alignment) return;
    setUncertain(true);
    const result = await jsonResponse(await authFetch('/api/inbox/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: dossier.phone, slot: 'posvenda', text: pendingMessage(dossier.content.alignment) }) }));
    setUncertain(false); setAsked(true); setNotice(result.simulated ? 'Simulação: perguntas preparadas. Clique em Ler respostas para ver a continuação.' : 'Perguntas enviadas. Quando ela responder, clique em Ler respostas.');
  });
  const sendPdf = () => run(async () => {
    if (!pdf || pdf.version !== dossier?.updated_at) throw new Error('Abra o PDF atualizado antes de enviar.');
    if (dossier.content.alignment?.review?.length) throw new Error('Confira as informações pendentes do trabalho antes de enviar.');
    setUncertain(true);
    const result = await jsonResponse(await authFetch('/api/inbox/send-media', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: dossier.phone, slot: 'posvenda', mediaBase64: await blobBase64(pdf.blob), mimetype: 'application/pdf', filename: 'Seu-ensaio.pdf', caption: confirmationMessage }) }));
    setUncertain(false); setSentPdf(true); setNotice(result.simulated ? 'Simulação concluída. Nenhum PDF foi enviado por WhatsApp.' : 'PDF enviado para a cliente conferir.');
  });
  return { dossier, media, busy, loading, mediaLoading, error, notice, pdf, setPdf, uncertain, setUncertain, asked, sentPdf, prepare, save, openPdf, sendQuestions, sendPdf, confirmationMessage };
}
export type DossierController = ReturnType<typeof useDossier>;
