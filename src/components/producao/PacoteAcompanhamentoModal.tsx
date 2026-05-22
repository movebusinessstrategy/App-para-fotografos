import React, { useState } from "react";
import { X, Plus, Trash2, Loader2, Layers } from "lucide-react";
import { SearchableSelect } from "../ui/SearchableSelect";
import { authFetch } from "../../utils/authFetch";

const SESSOES_PADRAO = ["3 meses", "6 meses", "9 meses", "Smash Cake"];

const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:border-gold-400";

export function PacoteAcompanhamentoModal({
  clients,
  stageId,
  onClose,
  onCreated,
}: {
  clients: { id: string; name: string }[];
  stageId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [identificacao, setIdentificacao] = useState("");
  const [sessoes, setSessoes] = useState<string[]>(SESSOES_PADRAO);
  const [valor, setValor] = useState("");
  const [dataPag, setDataPag] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const setSessao = (i: number, v: string) =>
    setSessoes((prev) => prev.map((s, idx) => (idx === i ? v : s)));
  const removeSessao = (i: number) =>
    setSessoes((prev) => prev.filter((_, idx) => idx !== i));
  const addSessao = () => setSessoes((prev) => [...prev, ""]);

  const submit = async () => {
    setErro("");
    if (!clientId) { setErro("Escolha o cliente."); return; }
    const limpas = sessoes.map((s) => s.trim()).filter(Boolean);
    if (limpas.length === 0) { setErro("Adicione pelo menos uma sessão."); return; }
    setSaving(true);
    try {
      const res = await authFetch("/api/jobs/pacote-acompanhamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          identificacao: identificacao.trim() || null,
          sessoes: limpas,
          production_stage: stageId,
          valor: valor ? Number(valor.replace(",", ".")) : null,
          data_pagamento: dataPag || null,
        }),
      });
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        const b = await res.json().catch(() => ({}));
        setErro(b.error || "Erro ao gerar o pacote.");
      }
    } catch {
      setErro("Erro ao gerar o pacote.");
    } finally {
      setSaving(false);
    }
  };

  const clientOpts = clients.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers size={18} className="text-gold-600" /> Novo pacote de acompanhamento
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cliente *</label>
            <SearchableSelect value={clientId} onChange={setClientId} options={clientOpts} placeholder="Selecionar cliente..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Identificação (opcional)</label>
            <input value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} placeholder="Ex: bebê da Marina" className={inputCls} />
            <p className="text-[11px] text-gray-400 mt-1">Aparece no nome de cada trabalho — ex: "bebê da Marina — 6 meses".</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Sessões do pacote</label>
            <div className="space-y-1.5">
              {sessoes.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={s} onChange={(e) => setSessao(i, e.target.value)} placeholder={`Sessão ${i + 1}`} className={inputCls} />
                  <button onClick={() => removeSessao(i)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <button onClick={addSessao} className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:text-gold-700">
              <Plus size={13} /> Adicionar sessão
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-800 pt-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Valor do pacote (R$)</label>
              <input type="number" min={0} step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data do pagamento</label>
              <input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`} />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Gera um trabalho por sessão (sem data — você agenda cada um depois). O valor entra como uma única receita já recebida no Financeiro.
          </p>
          {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-xl bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-50 flex items-center gap-1.5">
            {saving && <Loader2 size={14} className="animate-spin" />} Gerar pacote
          </button>
        </div>
      </div>
    </div>
  );
}
