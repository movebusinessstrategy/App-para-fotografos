import { Link2, Plus, Trash2 } from 'lucide-react';
import {
  PORTFOLIO_NICHES,
  portfolioLinksValidationMessage,
  type PortfolioLink,
  type PortfolioNiche,
} from '../../../agent-portfolio';

const NICHE_LABELS: Record<PortfolioNiche, string> = {
  geral: 'Todos os ensaios',
  gestante: 'Gestante',
  newborn: 'Newborn',
  familia: 'Família',
  smash_the_cake: 'Smash the Cake',
  aniversario: 'Aniversário',
  infantil: 'Infantil',
  casal: 'Casal',
  feminino: 'Feminino',
  marca_pessoal: 'Marca pessoal',
  revelacao: 'Revelação',
  batizado: 'Batizado',
};

type AgentPortfolioLinksEditorProps = {
  value: PortfolioLink[];
  onChange: (links: PortfolioLink[]) => void;
  disabled?: boolean;
};

function emptyPortfolioLink(): PortfolioLink {
  return { label: '', url: '', niche: 'geral' };
}

export function AgentPortfolioLinksEditor({
  value,
  onChange,
  disabled = false,
}: AgentPortfolioLinksEditorProps) {
  const validationMessage = portfolioLinksValidationMessage(value);

  function updateLink(index: number, patch: Partial<PortfolioLink>) {
    onChange(value.map((link, current) => (current === index ? { ...link, ...patch } : link)));
  }

  function removeLink(index: number) {
    onChange(value.filter((_, current) => current !== index));
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-gold-500/10 p-2 text-gold-600 dark:text-gold-400">
          <Link2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white">Portfólio que a Lia pode enviar</h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Cadastre somente páginas aprovadas do estúdio. A Lia não transforma links recebidos de clientes em portfólio.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {value.map((link, index) => (
          <div
            key={`${index}-${link.niche}`}
            className="grid gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/50 sm:grid-cols-[150px_1fr_auto]"
          >
            <select
              value={link.niche}
              onChange={(event) => updateLink(index, { niche: event.target.value as PortfolioNiche })}
              disabled={disabled}
              aria-label={`Tipo de ensaio do link ${index + 1}`}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {PORTFOLIO_NICHES.map((niche) => (
                <option key={niche} value={niche}>{NICHE_LABELS[niche]}</option>
              ))}
            </select>

            <div className="grid gap-2 sm:grid-cols-[minmax(130px,0.7fr)_minmax(220px,1.3fr)]">
              <input
                value={link.label}
                onChange={(event) => updateLink(index, { label: event.target.value })}
                disabled={disabled}
                maxLength={120}
                placeholder="Ex.: Ensaio em estúdio"
                aria-label={`Nome do link ${index + 1}`}
                className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <input
                value={link.url}
                onChange={(event) => updateLink(index, { url: event.target.value })}
                disabled={disabled}
                inputMode="url"
                placeholder="https://..."
                aria-label={`Endereço do link ${index + 1}`}
                className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>

            <button
              type="button"
              onClick={() => removeLink(index)}
              disabled={disabled}
              aria-label={`Excluir link ${index + 1}`}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}

        {!value.length && (
          <p className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400 dark:border-gray-700">
            Nenhum link cadastrado. A Lia continuará o fluxo sem inventar um endereço.
          </p>
        )}

        {validationMessage && (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {validationMessage}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange([...value, emptyPortfolioLink()])}
        disabled={disabled || value.length >= 30}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-gold-400 hover:text-gold-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:border-gold-600 dark:hover:text-gold-300"
      >
        <Plus size={16} />
        Adicionar página
      </button>
    </section>
  );
}
