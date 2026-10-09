// append inclui mensagens recebidas enquanto a sessão estava offline.
// Entradas recuperadas são históricas. Ecos próprios mantêm a detecção de atendimento humano.
export function shouldProcessMessageUpsert(type: string, _fromMe?: boolean | null): boolean {
  return type === 'notify' || type === 'append';
}

export function isHistoricalUpsert(type: string, fromMe?: boolean | null): boolean {
  return type === 'append' && fromMe !== true;
}
