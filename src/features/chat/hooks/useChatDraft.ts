import { useCallback, useRef, useState, type SetStateAction } from 'react';

/** Mantém o rascunho ao voltar à lista, sem misturar contatos ou setores. */
export function useChatDraft(key: string) {
  const drafts = useRef(new Map<string, string>());
  const [, redraw] = useState(0);
  const setText = useCallback((next: SetStateAction<string>) => {
    const previous = drafts.current.get(key) || '';
    const value = typeof next === 'function' ? next(previous) : next;
    if (value) drafts.current.set(key, value);
    else drafts.current.delete(key);
    redraw(count => count + 1);
  }, [key]);
  return [drafts.current.get(key) || '', setText] as const;
}
