export function shouldProcessMessageUpsert(
  type: string,
  fromMe: boolean | null | undefined,
): boolean {
  if (type === 'notify') return true;
  return type === 'append' && fromMe === true;
}
