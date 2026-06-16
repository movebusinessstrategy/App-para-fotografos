import React, { useEffect, useState } from "react";
import {
  X, Plus, Trash2, ChevronDown, ChevronRight, Copy, Loader2, Sparkles,
  GripVertical, ArrowUp, ArrowDown, ListChecks, Send,
} from "lucide-react";
import { authFetch } from "../../utils/authFetch";
import { TaskTemplate, TaskTemplateBlock, TaskTemplateItem, TeamMember } from "../../types";

// ─── helpers de mutação imutável da estrutura aninhada ───────────────────────
function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

const inputCls =
  "w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-gold-400 outline-none";

// ─── Editor de uma tarefa/subtarefa ──────────────────────────────────────────
function ItemRow({
  item, members, depth, onChange, onRemove, onMove, onAddChild,
}: {
  key?: React.Key;
  item: TaskTemplateItem;
  members: TeamMember[];
  depth: number;
  onChange: (patch: Partial<TaskTemplateItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddChild?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasOffset = item.due_offset_days != null;
  return (
    <div className={depth > 0 ? "ml-6 border-l border-gray-100 dark:border-gray-800 pl-3" : ""}>
      <div className="flex items-center gap-1.5 py-1">
        <GripVertical size={13} className="text-gray-300 flex-shrink-0" />
        <input
          value={item.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={depth > 0 ? "Subtarefa" : "Tarefa"}
          className="flex-1 px-2 py-1 text-sm bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gold-400 rounded-lg outline-none text-gray-800 dark:text-gray-100"
        />
        <button onClick={() => setOpen((v) => !v)} title="Opções (responsável/prazo)"
          className={`p-1 rounded-md text-xs ${open || item.default_assignee_id || hasOffset ? "text-gold-600 bg-gold-50 dark:bg-gold-500/10" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
          ⚙
        </button>
        <button onClick={() => onMove(-1)} className="p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowUp size={13} /></button>
        <button onClick={() => onMove(1)} className="p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowDown size={13} /></button>
        {onAddChild && (
          <button onClick={onAddChild} title="Adicionar subtarefa"
            className="p-1 rounded-md text-gray-400 hover:text-gold-600 hover:bg-gold-50 dark:hover:bg-gold-500/10"><Plus size={13} /></button>
        )}
        <button onClick={onRemove} className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={13} /></button>
      </div>
      {open && (
        <div className="ml-6 mb-2 grid grid-cols-2 gap-2 items-end">
          <div>
            <label className="text-[10px] uppercase font-semibold text-gray-400">Responsável sugerido</label>
            <select value={item.default_assignee_id || ""} onChange={(e) => onChange({ default_assignee_id: e.target.value || null })} className={inputCls}>
              <option value="">— (definir ao aplicar)</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-gray-400">Prazo (dias do ensaio)</label>
            <div className="flex items-center gap-1">
              <input type="number" placeholder="—"
                value={item.due_offset_days ?? ""}
                onChange={(e) => onChange({ due_offset_days: e.target.value === "" ? null : Number(e.target.value) })}
                className={inputCls + " w-20"} />
              <span className="text-[11px] text-gray-400">
                {hasOffset ? (item.due_offset_days! < 0 ? `${Math.abs(item.due_offset_days!)} dias antes` : item.due_offset_days === 0 ? "no dia" : `${item.due_offset_days} dias depois`) : "sem prazo"}
              </span>
            </div>
          </div>
        </div>
      )}
      {(item.children || []).map((child, ci) => (
        <ItemRow key={ci} item={child} members={members} depth={depth + 1}
          onChange={(patch) => onChange({ children: (item.children || []).map((c, i) => i === ci ? { ...c, ...patch } : c) })}
          onRemove={() => onChange({ children: (item.children || []).filter((_, i) => i !== ci) })}
          onMove={(dir) => onChange({ children: move(item.children || [], ci, dir) })}
        />
      ))}
    </div>
  );
}

// ─── Editor de um bloco (etapa) ──────────────────────────────────────────────
function BlockEditor({
  block, members, onChange, onRemove, onMove,
}: {
  key?: React.Key;
  block: TaskTemplateBlock;
  members: TeamMember[];
  onChange: (patch: Partial<TaskTemplateBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(true);
  const items = block.items || [];
  const setItems = (next: TaskTemplateItem[]) => onChange({ items: next });
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50">
        <button onClick={() => setOpen((v) => !v)} className="text-gray-400">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <input value={block.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Nome da etapa/bloco"
          className="flex-1 px-2 py-1 text-sm font-semibold bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gold-400 rounded-lg outline-none text-gray-900 dark:text-white" />
        <span className="text-[11px] text-gray-400">{items.length} tarefa{items.length === 1 ? "" : "s"}</span>
        <button onClick={() => onMove(-1)} className="p-1 rounded-md text-gray-300 hover:text-gray-600"><ArrowUp size={14} /></button>
        <button onClick={() => onMove(1)} className="p-1 rounded-md text-gray-300 hover:text-gray-600"><ArrowDown size={14} /></button>
        <button onClick={onRemove} className="p-1 rounded-md text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
      </div>
      {open && (
        <div className="p-3">
          <textarea value={block.note || ""} onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Observação da etapa (opcional) — a estrelinha ⭐"
            rows={2} className={inputCls + " mb-2 resize-none text-xs italic"} />
          {items.map((it, ii) => (
            <ItemRow key={ii} item={it} members={members} depth={0}
              onChange={(patch) => setItems(items.map((x, i) => i === ii ? { ...x, ...patch } : x))}
              onRemove={() => setItems(items.filter((_, i) => i !== ii))}
              onMove={(dir) => setItems(move(items, ii, dir))}
              onAddChild={() => setItems(items.map((x, i) => i === ii ? { ...x, children: [...(x.children || []), { title: "" }] } : x))}
            />
          ))}
          <button onClick={() => setItems([...items, { title: "" }])}
            className="mt-1 flex items-center gap-1 text-xs font-semibold text-gold-600 hover:text-gold-700">
            <Plus size={13} /> Adicionar tarefa
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────
export function TaskTemplatesManager({
  members, onClose, onApply,
}: {
  members: TeamMember[];
  onClose: () => void;
  onApply: (template: TaskTemplate) => void;
}) {
  const [list, setList] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [selected, setSelected] = useState<TaskTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const loadList = async () => {
    const res = await authFetch("/api/task-templates");
    const data = res.ok ? await res.json() : { templates: [] };
    setList(data.templates || []);
    setLoading(false);
  };
  useEffect(() => { loadList(); }, []);

  const openTemplate = async (id: string) => {
    const res = await authFetch(`/api/task-templates/${id}`);
    if (res.ok) setSelected(await res.json());
  };

  const createBlank = async () => {
    const res = await authFetch("/api/task-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Novo padrão", blocks: [{ title: "Etapa 1", items: [{ title: "" }] }] }),
    });
    if (res.ok) { const t = await res.json(); await loadList(); openTemplate(t.id); }
  };

  const seedExample = async () => {
    setSeeding(true);
    try {
      const res = await authFetch("/api/task-templates/seed-default", { method: "POST" });
      if (res.ok) { const t = await res.json(); await loadList(); openTemplate(t.id); }
    } finally { setSeeding(false); }
  };

  const saveSelected = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await authFetch(`/api/task-templates/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: selected.name, description: selected.description, blocks: selected.blocks }),
      });
      await loadList();
    } finally { setSaving(false); }
  };

  const duplicate = async (id: string) => {
    const res = await authFetch(`/api/task-templates/${id}/duplicate`, { method: "POST" });
    if (res.ok) await loadList();
  };
  const remove = async (id: string) => {
    if (!confirm("Excluir este padrão? As tarefas já criadas a partir dele NÃO são apagadas.")) return;
    await authFetch(`/api/task-templates/${id}`, { method: "DELETE" });
    if (selected?.id === id) setSelected(null);
    await loadList();
  };

  const patchSel = (patch: Partial<TaskTemplate>) => setSelected((s) => s ? { ...s, ...patch } : s);
  const setBlocks = (blocks: TaskTemplateBlock[]) => patchSel({ blocks });

  return (
    <div className="fixed inset-0 z-[70] flex bg-black/50" onClick={onClose}>
      <div className="m-auto w-full max-w-5xl h-[88vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex" onClick={(e) => e.stopPropagation()}>
        {/* Lista de padrões */}
        <div className="w-64 border-r border-gray-100 dark:border-gray-800 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5"><ListChecks size={15} /> Padrões de tarefas</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-gray-400" /></div> :
              list.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6 px-2">Nenhum padrão ainda. Crie um do zero ou comece pelo exemplo.</p>
              ) : list.map((t) => (
                <button key={t.id} onClick={() => openTemplate(t.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${selected?.id === t.id ? "border-gold-400 bg-gold-50/50 dark:bg-gold-500/10" : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.name}</p>
                  <p className="text-[11px] text-gray-400">{t.item_count || 0} itens</p>
                </button>
              ))}
          </div>
          <div className="p-2 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
            <button onClick={createBlank} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold">
              <Plus size={14} /> Novo padrão
            </button>
            <button onClick={seedExample} disabled={seeding} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60">
              {seeding ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Criar exemplo (Ensaio Padrão)
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">{selected ? "Editar padrão" : "Selecione ou crie um padrão"}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
          </div>

          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-center px-8">
              <div>
                <ListChecks size={36} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">Crie um bloco de tarefas (estilo ClickUp), organize em etapas com subtarefas, e aplique numa venda. Comece pelo <b>Ensaio Padrão</b> de exemplo.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-5">
                <input value={selected.name} onChange={(e) => patchSel({ name: e.target.value })} placeholder="Nome do padrão (ex.: Ensaio Assinante)"
                  className="w-full px-3 py-2 text-lg font-bold bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-gold-400 outline-none text-gray-900 dark:text-white mb-2" />
                <textarea value={selected.description || ""} onChange={(e) => patchSel({ description: e.target.value })} placeholder="Descrição (opcional)"
                  rows={2} className={inputCls + " mb-4 resize-none"} />

                {(selected.blocks || []).map((bl, bi) => (
                  <BlockEditor key={bi} block={bl} members={members}
                    onChange={(patch) => setBlocks((selected.blocks || []).map((x, i) => i === bi ? { ...x, ...patch } : x))}
                    onRemove={() => setBlocks((selected.blocks || []).filter((_, i) => i !== bi))}
                    onMove={(dir) => setBlocks(move(selected.blocks || [], bi, dir))}
                  />
                ))}
                <button onClick={() => setBlocks([...(selected.blocks || []), { title: `Etapa ${(selected.blocks || []).length + 1}`, items: [{ title: "" }] }])}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-500 hover:border-gold-400 hover:text-gold-600">
                  <Plus size={14} /> Adicionar etapa/bloco
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <button onClick={() => duplicate(selected.id)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1"><Copy size={13} /> Duplicar</button>
                  <button onClick={() => remove(selected.id)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 px-2 py-1"><Trash2 size={13} /> Excluir</button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => { await saveSelected(); onApply(selected); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gold-400 text-gold-600 text-sm font-semibold hover:bg-gold-50 dark:hover:bg-gold-500/10">
                    <Send size={14} /> Aplicar numa venda
                  </button>
                  <button onClick={saveSelected} disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold disabled:opacity-60">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
