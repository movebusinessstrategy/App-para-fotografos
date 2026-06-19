// "Ouvidos e olhos" da Lia: transcreve áudio (Whisper via OpenAI) e descreve
// imagem (Claude Vision) das mensagens recebidas. Tudo best-effort: sem chave ou
// com erro, retorna '' (nunca quebra o fluxo de recebimento).
//
// Whisper é chamado por fetch puro (o pacote `openai` NÃO é dependência deste
// servidor). Precisa de OPENAI_API_KEY no ambiente pra transcrever áudio.
// A imagem usa o @anthropic-ai/sdk, que já está instalado (ANTHROPIC_API_KEY).

import Anthropic from '@anthropic-ai/sdk';

const openaiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

// Transcreve um áudio/PTT recebido. Retorna o texto falado (ou '' se não der).
export async function transcribeAudio(buffer: Buffer, mimetype: string): Promise<string> {
  if (!openaiKey) return '';
  try {
    const ext = mimetype.includes('mpeg') ? 'mp3' : mimetype.includes('wav') ? 'wav' : 'ogg';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!res.ok) { console.warn('[media] whisper HTTP', res.status); return ''; }
    const data: any = await res.json();
    return (data?.text || '').trim();
  } catch (e: any) {
    console.warn('[media] transcrição falhou:', e?.message || e);
    return '';
  }
}

const VISION_MODEL = 'claude-haiku-4-5-20251001'; // barato e rápido pra descrever foto

// Descreve, em 1 frase, o que o cliente mandou numa imagem (contexto: estúdio).
export async function describeImage(buffer: Buffer, mimetype: string): Promise<string> {
  if (!anthropic) return '';
  try {
    const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimetype)
      ? mimetype
      : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const r = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
          },
          {
            type: 'text',
            text: 'Você atende um estúdio de fotografia no WhatsApp. Em UMA frase curta em português, diga o que o cliente mandou nesta imagem e o que parece querer (ex.: "foto da barriga de grávida", "print de um pacote perguntando preço", "foto do bebê", "comprovante de pagamento"). Sem rodeios.',
          },
        ],
      }],
    });
    return r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (e: any) {
    console.warn('[media] descrição de imagem falhou:', e?.message || e);
    return '';
  }
}

// Entende a mídia conforme o tipo. O prefixo deixa claro pra IA que veio de mídia.
export async function understandMedia(
  type: 'audio' | 'image',
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  if (type === 'audio') {
    const t = await transcribeAudio(buffer, mimetype);
    return t ? `[áudio do cliente] ${t}` : '';
  }
  const d = await describeImage(buffer, mimetype);
  return d ? `[imagem do cliente] ${d}` : '';
}
