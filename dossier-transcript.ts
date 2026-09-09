export interface DossierMessage {
  message_id: string;
  from_me: boolean;
  type?: string | null;
  body?: string | null;
  transcription?: string | null;
}

function mediaContext(message: DossierMessage): string {
  const description = message.transcription?.trim();
  if (!description || description === message.body?.trim()) return '';
  const label = message.type === 'image'
    ? 'DESCRIÇÃO AUTOMÁTICA DA IMAGEM — não é uma fala da cliente'
    : 'TRANSCRIÇÃO DA MÍDIA';
  return `\n  [${label}]: ${description.slice(0, 2000)}`;
}

export function buildDossierTranscript(messages: DossierMessage[]): string {
  return messages.map((message, index) => {
    const who = message.from_me ? 'ESTÚDIO' : 'CLIENTE';
    const isText = !message.type || ['chat', 'text'].includes(message.type);
    const marker = message.type === 'image' ? '[FOTO]' : `[${String(message.type).toUpperCase()}]`;
    const content = [isText ? '' : marker, message.body?.trim()].filter(Boolean).join(' ');
    const context = mediaContext(message);
    if (!content && !context) return '';
    return `[#${index}] ${who}: ${content}${context}`;
  }).filter(Boolean).join('\n');
}

export function pickDossierPhotoIds(messages: DossierMessage[], indices: unknown): string[] {
  if (!Array.isArray(indices)) return [];
  const validIndices = indices.map(Number).filter(index => Number.isInteger(index) && index >= 0);
  const photos = validIndices.map(index => messages[index])
    .filter(message => message && !message.from_me && message.type === 'image');
  return [...new Set(photos.map(message => message.message_id).filter(Boolean))];
}
