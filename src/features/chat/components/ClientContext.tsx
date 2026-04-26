import React, { useState } from 'react';
import {
  User, Info, Pencil, Check, Copy, ExternalLink,
  Loader2, UserPlus, Save, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Deal, PipelineStage } from '../../../types';
import { useCrmPanel } from '../hooks/useCrmPanel';
import { Avatar } from './shared/Avatar';
import { LinkedSessionBanner } from './LinkedSessionBanner';

interface Props {
  phone: string;
  contactName: string | null;
  deals: Deal[];
  stages: PipelineStage[];
  onDealUpdated: () => void;
}

type Tab = 'contact' | 'crm';

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length === 13)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith('55') && d.length === 12)
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return phone;
}

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'agora há pouco';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400)
    return `hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (diff < 172800) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function ClientContext({ phone, contactName, deals, stages, onDealUpdated }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('contact');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [noteText, setNoteText] = useState('');
  const [stagesOpen, setStagesOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const {
    contactInfo, loadingInfo, deal,
    saveName, savingName,
    changeStage, savingStage,
    saveNote, savingNote,
    createDeal, creating,
  } = useCrmPanel(phone, deals, onDealUpdated);

  // Sincroniza nota quando deal muda
  React.useEffect(() => {
    setNoteText(deal?.notes || '');
  }, [deal?.id]);

  const displayName = contactInfo?.contact_name || contactName || null;
  const photoUrl = contactInfo?.profile_picture_url ?? null;
  const currentStage = stages.find((s) => s.id === deal?.stage);
  const activeStages = stages.filter((s) => !s.is_final);
  const finalStages = stages.filter((s) => s.is_final);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const labelStyle = { color: '#6A6A65', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' };

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{
        background: 'var(--color-chat-panel)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        fontFamily: "'Instrument Sans', sans-serif",
      }}
    >
      {/* Tabs */}
      <div
        className="flex flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {(['contact', 'crm'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors"
            style={
              activeTab === t
                ? { color: '#B5C19D', borderBottom: '2px solid #B5C19D' }
                : { color: '#6A6A65', borderBottom: '2px solid transparent' }
            }
          >
            {t === 'contact' ? <User size={12} /> : <Info size={12} />}
            {t === 'contact' ? 'Contato' : 'CRM'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'contact' ? (
          /* ── Aba Contato ── */
          <div className="flex flex-col">
            <div
              className="flex flex-col items-center gap-3 px-5 pt-6 pb-5"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              {loadingInfo ? (
                <div
                  className="w-16 h-16 rounded-full animate-pulse"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                />
              ) : (
                <Avatar phone={phone} name={displayName} photoUrl={photoUrl} size="lg" />
              )}

              {/* Nome editável */}
              <div className="w-full text-center">
                {editingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          saveName(nameInput);
                          setEditingName(false);
                        }
                        if (e.key === 'Escape') {
                          setEditingName(false);
                          setNameInput(displayName || '');
                        }
                      }}
                      placeholder="Nome do contato"
                      className="flex-1 px-2 py-1.5 text-sm rounded-lg outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(181,193,157,0.30)',
                        color: '#ECEAE3',
                      }}
                    />
                    <button
                      onClick={() => { saveName(nameInput); setEditingName(false); }}
                      disabled={savingName || !nameInput.trim()}
                      className="p-1.5 rounded-lg disabled:opacity-40 transition-colors"
                      style={{ background: '#B5C19D', color: '#0E0E0C' }}
                    >
                      {savingName ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5">
                    <p className="text-base font-bold" style={{ color: '#ECEAE3', fontFamily: "'Instrument Serif', serif" }}>
                      {displayName || (
                        <span className="font-normal italic text-sm" style={{ color: '#6A6A65' }}>
                          Sem nome
                        </span>
                      )}
                    </p>
                    <button
                      onClick={() => { setEditingName(true); setNameInput(displayName || ''); }}
                      className="p-1 rounded transition-colors"
                      style={{ color: '#6A6A65' }}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
              </div>

              {contactInfo?.last_message_at && (
                <p className="text-[11px]" style={{ color: '#6A6A65' }}>
                  Última mensagem: {timeAgo(contactInfo.last_message_at)}
                </p>
              )}
            </div>

            <div className="px-4 py-4 space-y-4">
              {/* Telefone */}
              <div>
                <p style={labelStyle} className="mb-1">Telefone</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-mono" style={{ color: '#ECEAE3' }}>
                    {formatPhone(phone)}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCopyPhone}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: '#6A6A65' }}
                      title="Copiar"
                    >
                      {copied ? <Check size={12} style={{ color: '#B5C19D' }} /> : <Copy size={12} />}
                    </button>
                    <a
                      href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: '#6A6A65' }}
                      title="Abrir no WhatsApp"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

              {/* Sobre */}
              <div>
                <p style={labelStyle} className="mb-1">Sobre (WhatsApp)</p>
                {loadingInfo ? (
                  <div className="h-3 rounded animate-pulse" style={{ width: '70%', background: 'rgba(255,255,255,0.06)' }} />
                ) : contactInfo?.about ? (
                  <p className="text-sm italic leading-snug" style={{ color: '#9A9A93' }}>
                    "{contactInfo.about}"
                  </p>
                ) : (
                  <p className="text-xs italic" style={{ color: '#6A6A65' }}>Nenhuma descrição</p>
                )}
              </div>

              {/* Fase atual (se tiver deal) */}
              {currentStage && (
                <>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
                  <div>
                    <p style={labelStyle} className="mb-1.5">Fase no Funil</p>
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{ background: `${currentStage.color}22`, color: currentStage.color }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: currentStage.color }} />
                      {currentStage.name}
                    </span>
                  </div>
                </>
              )}

              {!deal && (
                <>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
                  <button
                    onClick={() => createDeal(stages)}
                    disabled={creating}
                    className="flex w-full items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40"
                    style={{ background: '#B5C19D', color: '#0E0E0C' }}
                  >
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    Adicionar ao funil
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── Aba CRM ── */
          <div className="flex flex-col">
            {deal && (
              <LinkedSessionBanner deal={deal} stage={currentStage} />
            )}

            <div
              className="px-4 py-3"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="text-sm font-bold truncate" style={{ color: '#ECEAE3', fontFamily: "'Instrument Serif', serif" }}>
                {displayName || phone}
              </p>
              {displayName && (
                <p className="text-xs mt-0.5" style={{ color: '#6A6A65' }}>{formatPhone(phone)}</p>
              )}
            </div>

            {!deal ? (
              <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 text-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(181,193,157,0.10)' }}
                >
                  <UserPlus size={20} style={{ color: '#B5C19D' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#ECEAE3' }}>Sem lead no pipeline</p>
                  <p className="text-xs mt-1" style={{ color: '#6A6A65' }}>Adicione esta conversa ao funil</p>
                </div>
                <button
                  onClick={() => createDeal(stages)}
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40"
                  style={{ background: '#B5C19D', color: '#0E0E0C' }}
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Adicionar ao funil
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 py-2">
                {/* Fases */}
                <div className="px-4">
                  <button
                    onClick={() => setStagesOpen((v) => !v)}
                    className="flex items-center justify-between w-full py-2"
                  >
                    <span style={labelStyle}>Fase do Lead</span>
                    {stagesOpen
                      ? <ChevronUp size={13} style={{ color: '#6A6A65' }} />
                      : <ChevronDown size={13} style={{ color: '#6A6A65' }} />}
                  </button>
                  {stagesOpen && (
                    <div className="flex flex-col gap-1 pb-3">
                      {activeStages.map((stage) => {
                        const isActive = deal.stage === stage.id;
                        return (
                          <button
                            key={stage.id}
                            onClick={() => changeStage(stage.id)}
                            disabled={savingStage}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all"
                            style={
                              isActive
                                ? { background: `${stage.color}18`, color: stage.color, fontWeight: 600 }
                                : { color: '#9A9A93' }
                            }
                          >
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                            {stage.name}
                            {isActive && savingStage && (
                              <Loader2 size={11} className="animate-spin ml-auto" />
                            )}
                          </button>
                        );
                      })}
                      {finalStages.length > 0 && (
                        <>
                          <p className="px-1 mt-2 mb-1" style={labelStyle}>Finalizar</p>
                          {finalStages.map((stage) => {
                            const isActive = deal.stage === stage.id;
                            return (
                              <button
                                key={stage.id}
                                onClick={() => changeStage(stage.id)}
                                disabled={savingStage}
                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all"
                                style={
                                  isActive
                                    ? { background: `${stage.color}18`, color: stage.color, fontWeight: 600 }
                                    : { color: '#9A9A93' }
                                }
                              >
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                                {stage.name}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mx-4" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                {/* Valor */}
                <div className="px-4 py-3">
                  <p style={labelStyle} className="mb-1.5">Valor Estimado</p>
                  <p className="text-xl font-bold" style={{ color: '#B5C19D', fontFamily: "'Instrument Serif', serif" }}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(deal.value || 0)}
                  </p>
                </div>

                <div className="mx-4" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

                {/* Anotações */}
                <div className="px-4 py-3 flex flex-col gap-2">
                  <p style={labelStyle}>Anotações</p>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escreva sobre essa conversa..."
                    rows={4}
                    className="w-full text-sm rounded-xl px-3 py-2.5 outline-none resize-none placeholder-[#6A6A65] transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#ECEAE3',
                    }}
                  />
                  <button
                    onClick={() => saveNote(noteText)}
                    disabled={savingNote || noteText === (deal.notes || '')}
                    className="flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-30"
                    style={{ background: '#B5C19D', color: '#0E0E0C' }}
                  >
                    {savingNote ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
