import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, FileText, Loader2, X } from 'lucide-react';
import { useDossier, type DossierController, type DossierMedia, pendingMessage } from './useDossier';
import './DossierSection.css';

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dossier-modal" onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}>
    <header><h3>{title}</h3><button onClick={close} aria-label="Fechar"><X size={20} /></button></header>{children}
  </dialog>;
}
function References({ model, readOnly }: { model: DossierController; readOnly: boolean }) {
  const [selected, setSelected] = useState<DossierMedia | null>(null);
  const photos = model.media.filter(p => p.kind === 'reference');
  const excluded = model.dossier?.content.excluded_reference_ids || [];
  const toggle = (id: string) => model.save({ excludedReferences: excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id] });
  return <section className="dossier-block"><div className="dossier-section-title"><span>02</span><h4>As referências dela</h4></div>
    {model.mediaLoading && <p className="dossier-muted">Buscando as fotos da conversa…</p>}
    {!model.mediaLoading && !photos.length && <p className="dossier-muted">Nenhuma foto de referência identificada nesta conversa.</p>}
    <div className="dossier-photos">{photos.map((photo, i) => <figure key={photo.id} className={excluded.includes(photo.id) ? 'dossier-photo-excluded' : ''}>
      {photo.data_url ? <button className="dossier-photo" onClick={() => setSelected(photo)} aria-label={`Ampliar referência ${i + 1}`}><img src={photo.data_url} alt={`Referência ${i + 1} compartilhada na conversa`} /></button> : <div className="dossier-photo-missing">Esta imagem não está disponível. Confira o arquivo no WhatsApp.</div>}
      <figcaption><span className="dossier-label">Referência {String(i + 1).padStart(2, '0')}</span><p>{photo.caption || 'Ela enviou esta imagem, mas ainda não explicou o que gostaria de aproveitar.'}</p>
        {photo.quote && <blockquote>“{photo.quote}”</blockquote>}
        {!readOnly && <label className="dossier-photo-choice"><input type="checkbox" checked={!excluded.includes(photo.id)} disabled={model.busy} onChange={() => toggle(photo.id)} />Usar no dossiê</label>}
      </figcaption>
    </figure>)}</div>
    {selected?.data_url && <Modal title="Referência da conversa" close={() => setSelected(null)}><img className="dossier-lightbox" src={selected.data_url} alt="Referência ampliada, sem recorte" /><p>{selected.caption}</p></Modal>}
  </section>;
}
function Known({ model }: { model: DossierController }) {
  const content = model.dossier!.content;
  const choices = content.alignment?.choices || [];
  return <section className="dossier-block"><div className="dossier-section-title"><span>01</span><h4>O que já sabemos</h4></div>
    {choices.length ? <dl className="dossier-known">{choices.map(choice => <div key={choice.id}><dt>{choice.title}</dt><dd>{choice.value}</dd></div>)}</dl> : <p className="dossier-muted">{content.resumo || 'Leia a conversa para reunir as escolhas.'}</p>}
    {content.alignment && <p className="dossier-origin">Aproveitado do trabalho e da conversa. Essas informações não serão perguntadas novamente.</p>}
  </section>;
}
function Questions({ model, readOnly }: { model: DossierController; readOnly: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = model.dossier?.content.alignment?.questions || [];
  const review = model.dossier?.content.alignment?.review || [];
  if (!model.dossier?.content.alignment) return null;
  return <section className="dossier-block"><div className="dossier-section-title"><span>03</span><h4>{questions.length ? 'Só falta perguntar' : 'Tudo reunido para conferir'}</h4></div>
    {!questions.length && <p className="dossier-muted">{review.length ? 'Há informações do trabalho que precisam de conferência antes de finalizar.' : 'As escolhas foram reunidas. Agora veja o PDF e envie para ela conferir.'}</p>}
    <ol className="dossier-questions">{questions.map(question => <li key={question.id}><p>{question.question}</p>
      {!readOnly && <details><summary>Ela já respondeu? Anotar aqui</summary><label><span className="sr-only">Resposta sobre {question.title}</span><textarea value={answers[question.id] || ''} maxLength={1200} onChange={e => setAnswers({ ...answers, [question.id]: e.target.value })} placeholder="Anote a escolha que ela confirmou" rows={2} /></label></details>}
    </li>)}</ol>
    {!readOnly && Object.values(answers).some(v => v.trim()) && <button className="dossier-secondary" disabled={model.busy} onClick={() => model.save({ answers })}>Salvar respostas</button>}
    {!!questions.length && !readOnly && <div className="dossier-question-actions">
      <details><summary>Ver a mensagem completa</summary><p className="dossier-message">{pendingMessage(model.dossier.content.alignment)}</p></details>
      <button className="dossier-primary" disabled={model.busy || model.uncertain || !model.dossier.phone} onClick={model.asked ? model.prepare : model.sendQuestions}>{model.asked ? 'Ler respostas' : 'Enviar perguntas'}<ArrowRight size={16} /></button>
      <p className="dossier-recipient">Para {model.dossier.client_name} · {model.dossier.phone} · WhatsApp de pós-venda</p>
    </div>}
  </section>;
}
function PdfAction({ model, readOnly }: { model: DossierController; readOnly: boolean }) {
  return <section className="dossier-export"><div><p className="dossier-label">O dossiê do ensaio</p><h4>As escolhas e as fotos,<br />prontas para conferir.</h4></div>
    <button className="dossier-primary" disabled={model.busy || model.mediaLoading} onClick={model.openPdf}><FileText size={16} />Ver PDF</button>
    {model.pdf && <Modal title="Confira o PDF antes de enviar" close={() => model.setPdf(null)}>
      <iframe src={model.pdf.url} title="Dossiê do ensaio em PDF" className="dossier-pdf-frame" />
      <div className="dossier-pdf-actions"><p>{model.confirmationMessage}</p><a href={model.pdf.url} download="Seu-ensaio.pdf">Baixar PDF</a>
        {!readOnly && <button className="dossier-primary" disabled={model.busy || model.uncertain || model.sentPdf || !model.dossier?.phone || Boolean(model.dossier.content.alignment?.review?.length)} onClick={model.sendPdf}>{model.sentPdf ? 'PDF enviado' : 'Enviar para conferir'}<ArrowRight size={16} /></button>}
        <span className="dossier-recipient">{model.dossier?.client_name} · {model.dossier?.phone} · Pós-venda</span>
      </div>
    </Modal>}
  </section>;
}
export function DossierSection({ jobId, readOnly = false }: { jobId: number; readOnly?: boolean }) {
  const model = useDossier(jobId);
  if (model.loading) return <p className="dossier-muted"><Loader2 size={14} className="animate-spin inline" /> Carregando o ensaio…</p>;
  const plan = model.dossier?.content.alignment;
  return <section className="studio-dossier" aria-label="Preparar o ensaio">
    <header className="dossier-header"><div><p className="dossier-label">Alinhamento do ensaio</p><h3>Vamos preparar<br />essas fotos?</h3><p>Uma leitura da conversa reúne os combinados, as referências e o que ainda falta perguntar.</p></div>
      {!readOnly && <button className="dossier-primary" disabled={model.busy} onClick={model.prepare}>{model.busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{model.busy ? 'Preparando…' : plan ? 'Atualizar pela conversa' : 'Ler conversa e fotos'}</button>}
    </header>
    {model.error && <p className="dossier-error" role="alert">{model.error}</p>}
    {model.notice && <p className="dossier-notice" role="status"><Check size={14} />{model.notice}</p>}
    {model.uncertain && <p className="dossier-error">O envio não foi confirmado. Confira o WhatsApp antes de tentar de novo. <button onClick={() => model.setUncertain(false)}>Já conferi a conversa</button></p>}
    {model.dossier && <><Known model={model} /><References model={model} readOnly={readOnly} /><Questions model={model} readOnly={readOnly} /><PdfAction model={model} readOnly={readOnly} /></>}
    {!!plan?.review?.length && <p className="dossier-error">{plan.review.join(' ')} Atualize os dados e leia a conversa novamente.</p>}
  </section>;
}
