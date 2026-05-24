import { useEffect, useState } from 'react';
import { authFetch } from '../../utils/authFetch';

type FieldType = 'text' | 'date' | 'number' | 'select' | 'textarea';

interface CustomField {
  id: string;
  field_key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  required: boolean;
}

interface CustomFieldsFormProps {
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
}

// Renderiza os campos personalizados configurados pelo usuário em
// Configurações → Campos personalizados. Cada campo lê/grava em `value`
// (jsonb que vai pra clients.custom_fields_data).
export function CustomFieldsForm({ value, onChange }: CustomFieldsFormProps) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch('/api/custom-fields')
      .then(r => r.ok ? r.json() : [])
      .then(setFields)
      .catch(() => setFields([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading || fields.length === 0) return null;

  const setField = (key: string, v: any) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mt-2">
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">
        Campos personalizados
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(f => (
          <div key={f.id} className={f.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            {f.field_type === 'select' ? (
              <select
                value={value[f.field_key] ?? ''}
                onChange={e => setField(f.field_key, e.target.value)}
                required={f.required}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-gold-500 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">—</option>
                {f.options.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : f.field_type === 'textarea' ? (
              <textarea
                rows={3}
                value={value[f.field_key] ?? ''}
                onChange={e => setField(f.field_key, e.target.value)}
                required={f.required}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-gold-500 outline-none resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            ) : (
              <input
                type={f.field_type === 'date' ? 'date' : f.field_type === 'number' ? 'number' : 'text'}
                value={value[f.field_key] ?? ''}
                onChange={e => setField(f.field_key, e.target.value)}
                required={f.required}
                className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-gold-500 outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
