import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Copy, Save, Loader2, FileText, AlertCircle, CheckCheck,
  Search, Download, RotateCcw, Eye, EyeOff,
} from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { cn } from '../../utils/cn';
import { substituteVariables } from '../../utils/contractTemplate';
import { ContractTemplate } from '../../types';
import { ConfirmModal } from '../ui/ConfirmModal';

type Notify = (kind: 'success' | 'error' | 'info', message: string) => void;

// ─── Variable definitions ────────────────────────────────────────────────────
// Mantém em sync com extract_defaults() do script Python e com o ContractGenerator.
const VARIABLES: Array<{ key: string; label: string; group: 'cliente' | 'servico' | 'pagamento' | 'outros' }> = [
  { key: 'cliente_nome',      label: 'Nome do cliente',  group: 'cliente' },
  { key: 'cliente_cpf',       label: 'CPF',              group: 'cliente' },
  { key: 'cliente_endereco',  label: 'Endereço',         group: 'cliente' },
  { key: 'cliente_telefone',  label: 'Telefone',         group: 'cliente' },
  { key: 'cliente_email',     label: 'E-mail',           group: 'cliente' },
  { key: 'servico_data',      label: 'Data do serviço',  group: 'servico' },
  { key: 'servico_hora',      label: 'Hora do serviço',  group: 'servico' },
  { key: 'servico_endereco',  label: 'Endereço do evento', group: 'servico' },
  { key: 'valor_total',       label: 'Valor total',      group: 'pagamento' },
  { key: 'valor_extenso',     label: 'Valor por extenso', group: 'pagamento' },
  { key: 'autorizacao_imagem', label: 'Autorização de imagem (autoriza/NÃO autoriza)', group: 'outros' },
  { key: 'ano',               label: 'Ano',              group: 'outros' },
];

const SAMPLE_DATA: Record<string, string> = {
  cliente_nome: 'Maria da Silva',
  cliente_cpf: '123.456.789-00',
  cliente_endereco: 'Rua das Flores, 123 - Centro - Cambé/PR, CEP: 86180-000',
  cliente_telefone: '43 99999-9999',
  cliente_email: 'maria@email.com',
  servico_data: '15/06/2026',
  servico_hora: '14h00',
  servico_endereco: 'Buffet Funny Play',
  valor_total: '1.500,00',
  valor_extenso: 'Mil e quinhentos reais',
  autorizacao_imagem: 'autoriza',
  ano: String(new Date().getFullYear()),
};

function renderPreview(body: string, defaults: Record<string, any>): string {
  // Usa defaults onde existirem, senão fallback pra dados de exemplo.
  const merged = { ...SAMPLE_DATA, ...Object.fromEntries(
    Object.entries(defaults).filter(([, v]) => v != null && String(v).trim() !== '')
  )};
  return substituteVariables(body, merged);
}

// ─── Main component ───────────────────────────────────────────────────────────
interface TemplatesManagerProps {
  onNotify: Notify;
}

export function TemplatesManager({ onNotify }: TemplatesManagerProps) {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ContractTemplate | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/contract-templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? templates.filter(t =>
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
        )
      : templates;
    const map = new Map<string, ContractTemplate[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [templates, search]);

  const selected = templates.find(t => t.id === selectedId) || null;

  const importSeed = async () => {
    setImporting(true);
    try {
      const seed = await import('../../data/contract-templates-seed.json');
      const payload = (seed as any).default ?? seed;
      const res = await authFetch('/api/contract-templates/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify('error', 'Erro ao importar: ' + (err.error || res.statusText));
        return;
      }
      const data = await res.json();
      onNotify('success', `${data.inserted} modelo(s) importado(s). ${data.skipped} já existiam.`);
      await reload();
    } finally {
      setImporting(false);
    }
  };

  const createNew = () => {
    setSelectedId(-1); // sentinel = novo
  };

  const handleSaved = (t: ContractTemplate) => {
    setTemplates(prev => {
      const idx = prev.findIndex(p => p.id === t.id);
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = t; return copy;
      }
      return [...prev, t];
    });
    setSelectedId(t.id);
  };

  const handleDuplicate = async (t: ContractTemplate) => {
    const res = await authFetch('/api/contract-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${t.name} (cópia)`,
        category: t.category,
        body: t.body,
        default_data: t.default_data,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onNotify('error', 'Erro ao duplicar: ' + (err.error || res.statusText));
      return;
    }
    const created = await res.json();
    setTemplates(prev => [...prev, created]);
    setSelectedId(created.id);
    onNotify('success', 'Modelo duplicado.');
  };

  const handleDelete = async (t: ContractTemplate) => {
    const res = await authFetch(`/api/contract-templates/${t.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onNotify('error', 'Erro ao excluir: ' + (err.error || res.statusText));
      return;
    }
    setTemplates(prev => prev.filter(p => p.id !== t.id));
    if (selectedId === t.id) setSelectedId(null);
    onNotify('success', 'Modelo excluído.');
  };

  // Empty state: oferece importar
  if (!loading && templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center mb-4">
          <FileText size={26} className="text-gold-600 dark:text-gold-400" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Nenhum modelo cadastrado</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-5">
          Modelos servem como base de cada tipo de contrato (Newborn, Gestante, Casal…).
          Importe os 24 modelos do estúdio agora ou crie um do zero.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={importSeed}
            disabled={importing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Importar 24 modelos do estúdio
          </button>
          <button
            onClick={createNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors"
          >
            <Plus size={14} />
            Criar do zero
          </button>
        </div>
        {selectedId === -1 && (
          <div className="w-full mt-8">
            <TemplateEditor
              key="new"
              template={null}
              allCategories={[]}
              onClose={() => setSelectedId(null)}
              onSaved={(t) => { handleSaved(t); }}
              onNotify={onNotify}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4 min-h-[600px]">
      {/* Lista (esquerda) */}
      <aside className="col-span-12 md:col-span-4 lg:col-span-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden flex flex-col">
        <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400"
            />
          </div>
          <button
            onClick={createNew}
            title="Novo modelo"
            className="p-1.5 rounded-lg bg-gold-600 hover:bg-gold-700 text-white"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-gray-400" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Nenhum modelo encontrado.</p>
          ) : grouped.map(([cat, list]) => (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-2 mb-1">
                {cat}
              </p>
              <div className="space-y-0.5">
                {list.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-2',
                      selectedId === t.id
                        ? 'bg-gold-100 dark:bg-gold-500/20 text-gold-800 dark:text-gold-300 font-semibold'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                  >
                    <FileText size={11} className="flex-shrink-0 opacity-60" />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={importSeed}
            disabled={importing}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] text-gray-500 hover:text-gold-700 dark:hover:text-gold-400 disabled:opacity-60 transition-colors"
            title="Importa modelos do estúdio. Pula nomes que já existem."
          >
            {importing ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            Reimportar modelos do estúdio
          </button>
        </div>
      </aside>

      {/* Editor (direita) */}
      <div className="col-span-12 md:col-span-8 lg:col-span-9">
        {selectedId === null ? (
          <div className="h-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex items-center justify-center text-sm text-gray-400 py-24">
            Selecione um modelo à esquerda ou crie um novo.
          </div>
        ) : selectedId === -1 ? (
          <TemplateEditor
            key="new"
            template={null}
            allCategories={Array.from(new Set<string>(templates.map(t => t.category))).sort()}
            onClose={() => setSelectedId(null)}
            onSaved={(t) => handleSaved(t)}
            onNotify={onNotify}
          />
        ) : selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            allCategories={Array.from(new Set<string>(templates.map(t => t.category))).sort()}
            onClose={() => setSelectedId(null)}
            onSaved={(t) => handleSaved(t)}
            onDuplicate={() => handleDuplicate(selected)}
            onDelete={() => setConfirmDelete(selected)}
            onNotify={onNotify}
          />
        ) : null}
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir modelo"
        message={confirmDelete ? `Excluir o modelo "${confirmDelete.name}"? Contratos já criados a partir dele continuam existindo, mas o modelo não estará mais disponível para novos contratos.` : ''}
        confirmText="Excluir"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) handleDelete(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ─── Editor pane ──────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  template: ContractTemplate | null;
  allCategories: string[];
  onClose: () => void;
  onSaved: (t: ContractTemplate) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onNotify: Notify;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({ template, allCategories, onClose, onSaved, onDuplicate, onDelete, onNotify }) => {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || '');
  const [body, setBody] = useState(template?.body || '');
  const [valorTotal, setValorTotal] = useState((template?.default_data?.valor_total as string) || '');
  const [valorExtenso, setValorExtenso] = useState((template?.default_data?.valor_extenso as string) || '');
  const [prazoDias, setPrazoDias] = useState(
    template?.default_data?.prazo_entrega_dias ? String(template.default_data.prazo_entrega_dias) : ''
  );
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNew = !template;
  const isLegacy = !!template?.is_legacy;

  const insertVariable = (key: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setBody(b => b + `{{${key}}}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const insert = `{{${key}}}`;
    const newBody = before + insert + after;
    setBody(newBody);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const buildDefaultData = () => {
    const d: Record<string, any> = {};
    if (valorTotal.trim()) d.valor_total = valorTotal.trim();
    if (valorExtenso.trim()) d.valor_extenso = valorExtenso.trim();
    if (prazoDias.trim() && !isNaN(Number(prazoDias))) d.prazo_entrega_dias = Number(prazoDias);
    return d;
  };

  const save = async () => {
    if (!name.trim()) {
      onNotify('error', 'Dê um nome ao modelo.');
      return;
    }
    if (!category.trim()) {
      onNotify('error', 'Escolha ou digite uma categoria.');
      return;
    }
    if (!body.trim()) {
      onNotify('error', 'O modelo não pode ficar em branco.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim().toUpperCase(),
        body,
        default_data: buildDefaultData(),
      };
      const res = isNew
        ? await authFetch('/api/contract-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch(`/api/contract-templates/${template!.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify('error', 'Erro ao salvar: ' + (err.error || res.statusText));
        return;
      }
      const saved: ContractTemplate = await res.json();
      onNotify('success', isNew ? 'Modelo criado.' : 'Modelo salvo.');
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  const previewText = useMemo(
    () => renderPreview(body, buildDefaultData()),
    [body, valorTotal, valorExtenso, prazoDias]
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col" style={{ minHeight: 600 }}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome do modelo (ex: Smash Basic)"
            className="font-bold text-gray-900 dark:text-white bg-transparent outline-none border-b border-transparent focus:border-gold-400 transition-colors text-base flex-1 min-w-0"
            disabled={isLegacy}
          />
          {isLegacy && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-800 text-gray-500">
              Legado
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setShowPreview(p => !p)}
            title={showPreview ? 'Esconder preview' : 'Mostrar preview'}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {!isNew && onDuplicate && (
            <button
              onClick={onDuplicate}
              title="Duplicar"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Copy size={14} />
            </button>
          )}
          {!isNew && onDelete && !isLegacy && (
            <button
              onClick={onDelete}
              title="Excluir"
              className="p-2 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Fechar
          </button>
          <button
            onClick={save}
            disabled={saving || isLegacy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gold-600 hover:bg-gold-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Categoria</label>
          <input
            list="cat-options"
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="Ex: NEWBORN"
            disabled={isLegacy}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400 disabled:opacity-60"
          />
          <datalist id="cat-options">
            {allCategories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Valor padrão (R$)</label>
          <input
            value={valorTotal}
            onChange={e => setValorTotal(e.target.value)}
            placeholder="1.290,00"
            disabled={isLegacy}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Por extenso</label>
          <input
            value={valorExtenso}
            onChange={e => setValorExtenso(e.target.value)}
            placeholder="Mil duzentos e noventa reais"
            disabled={isLegacy}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Prazo entrega (dias)</label>
          <input
            type="number"
            value={prazoDias}
            onChange={e => setPrazoDias(e.target.value)}
            placeholder="30"
            disabled={isLegacy}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400 disabled:opacity-60"
          />
        </div>
      </div>

      {/* Variable insert bar */}
      {!isLegacy && (
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 flex-wrap bg-gray-50 dark:bg-gray-800/40">
          <span className="text-[10px] font-bold uppercase text-gray-500 mr-1">Inserir:</span>
          {VARIABLES.map(v => (
            <button
              key={v.key}
              onClick={() => insertVariable(v.key)}
              title={`{{${v.key}}}`}
              className="px-2 py-0.5 text-[11px] rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gold-400 hover:text-gold-700 dark:hover:text-gold-400 transition-colors"
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Body editor + Preview */}
      <div className={cn('flex-1 grid gap-0', showPreview ? 'grid-cols-2' : 'grid-cols-1')}>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={isLegacy}
          placeholder="Texto do contrato. Use os botões acima para inserir variáveis como {{cliente_nome}}, {{valor_total}} etc."
          spellCheck={false}
          className={cn(
            'w-full h-full p-4 text-[13px] leading-relaxed font-mono bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 outline-none resize-none disabled:opacity-70',
            showPreview && 'border-r border-gray-100 dark:border-gray-800',
          )}
          style={{ minHeight: 400 }}
        />
        {showPreview && (
          <div className="p-4 overflow-y-auto bg-gray-50 dark:bg-gray-800/30" style={{ minHeight: 400 }}>
            <p className="text-[10px] font-bold uppercase text-gray-400 mb-2">
              Preview com dados de exemplo
            </p>
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-serif">
              {previewText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
