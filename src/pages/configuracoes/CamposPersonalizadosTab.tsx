import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Loader2, GripVertical, AlertCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { cn } from '../../utils/cn';

type FieldType = 'text' | 'date' | 'number' | 'select' | 'textarea';

interface CustomField {
  id: string;
  field_key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  required: boolean;
  sort_order: number;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  textarea: 'Texto longo',
  date: 'Data',
  number: 'Número',
  select: 'Lista de opções',
};

export default function CamposPersonalizadosTab() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // formulário "criar novo"
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<FieldType>('text');
  const [newOptions, setNewOptions] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/custom-fields');
      if (r.ok) setFields(await r.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const options = newType === 'select'
        ? newOptions.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const r = await authFetch('/api/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          field_type: newType,
          options,
          required: newRequired,
          sort_order: fields.length,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.error || 'Erro ao criar campo');
        return;
      }
      setNewLabel('');
      setNewType('text');
      setNewOptions('');
      setNewRequired(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, patch: Partial<CustomField>) => {
    const r = await authFetch(`/api/custom-fields/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) await reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apagar este campo? Os valores já preenchidos nos clientes serão preservados.')) return;
    const r = await authFetch(`/api/custom-fields/${id}`, { method: 'DELETE' });
    if (r.ok) await reload();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          Campos personalizados do cliente
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Adicione campos extras pro cadastro de cliente (ex: DPP, convênio, signo,
          área de atuação). Eles aparecem no formulário e no painel da extensão do WhatsApp.
        </p>
      </div>

      {/* Lista de campos existentes */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Campos atuais</h3>
          <span className="text-xs text-gray-400">{fields.length} campo(s)</span>
        </div>
        {loading ? (
          <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" /> Carregando...
          </div>
        ) : fields.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Nenhum campo personalizado ainda. Crie o primeiro logo abaixo.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {fields.map(f => (
              <li key={f.id} className="px-4 py-3 flex items-center gap-3">
                <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{f.label}</p>
                    {f.required && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400">
                        OBRIGATÓRIO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {FIELD_TYPE_LABELS[f.field_type]}
                    {f.field_type === 'select' && f.options.length > 0 && (
                      <> · {f.options.join(', ')}</>
                    )}
                    {' · '}<code className="text-[10px]">{f.field_key}</code>
                  </p>
                </div>
                <button
                  onClick={() => handleUpdate(f.id, { required: !f.required })}
                  className="text-xs text-gray-500 hover:text-gold-600 px-2 py-1"
                  title="Alternar obrigatório"
                >
                  {f.required ? 'Tornar opcional' : 'Tornar obrigatório'}
                </button>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  title="Remover"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form criar novo */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Criar novo campo</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Nome do campo
            </label>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Ex: DPP, Convênio, Signo..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Tipo
            </label>
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as FieldType)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400"
            >
              {(Object.entries(FIELD_TYPE_LABELS) as [FieldType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {newType === 'select' && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Opções (separe por vírgula)
            </label>
            <input
              value={newOptions}
              onChange={e => setNewOptions(e.target.value)}
              placeholder="Particular, Unimed, SulAmérica..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-gold-400"
            />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={newRequired}
              onChange={e => setNewRequired(e.target.checked)}
              className="rounded border-gray-300 text-gold-600 focus:ring-gold-500"
            />
            Obrigatório no cadastro
          </label>
          <button
            onClick={handleCreate}
            disabled={saving || !newLabel.trim()}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors",
              "bg-gold-600 hover:bg-gold-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Adicionar campo
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
