import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch';

interface Session { id: number; job_name: string; job_type: string; job_date: string | null }

export function SaleSessionList({ dealId, currentJobId }: { dealId: string | number; currentJobId?: number }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSessions([]); setError('');
    authFetch(`/api/deals/${dealId}/sessions`).then(async response => {
      if (!response.ok) throw new Error('Não foi possível carregar os ensaios desta venda.');
      const data = await response.json();
      if (active) setSessions(data);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [dealId]);
  if (error) return <p role="alert" className="text-xs text-red-600">{error}</p>;
  if (!sessions.length) return null;
  return <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Ensaios da mesma venda</h3>
    <p className="mt-1 text-xs text-gray-500">Cada card tem seu próprio contrato e andamento.</p>
    <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">{sessions.map(session =>
      <li key={session.id}><Link to={`/jobs?job=${session.id}`} aria-current={session.id === currentJobId ? 'page' : undefined}
        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-gray-800 hover:underline dark:text-gray-200">
        <span>{session.job_name || session.job_type}</span>
        <span className="text-xs text-gray-500">{session.job_date ? session.job_date.slice(0, 10).split('-').reverse().join('/') : 'Aguardando data'}</span>
      </Link></li>)}</ul>
  </section>;
}
