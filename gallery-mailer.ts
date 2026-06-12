// E-mails transacionais da galeria de proofing via Resend (fetch puro, sem SDK).
// Nunca lança: retorna false se não configurado ou se a API falhar.
//
// Env vars:
//   RESEND_API_KEY  — chave da API do Resend (sem ela, e-mails são pulados)
//   RESEND_FROM     — remetente default (ex.: "Estúdio <galeria@dominio.com>")

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'onboarding@resend.dev';

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface GalleryReadyEmailInput {
  to: string;
  from?: string | null;
  studioName: string;
  clientName?: string | null;
  galleryTitle: string;
  link: string;
  includedCount: number;
  extraPrice: number;
}

export interface SelectionDoneEmailInput {
  to: string;
  from?: string | null;
  studioName: string;
  clientName?: string | null;
  galleryTitle: string;
  selectedCount: number;
  extraCount: number;
  amount: number;
}

// Cliente: galeria pronta pra seleção
export async function sendGalleryReadyEmail(input: GalleryReadyEmailInput): Promise<boolean> {
  return sendEmail({
    to: input.to,
    from: input.from,
    subject: `Suas fotos estão prontas — ${input.galleryTitle}`,
    html: galleryReadyHtml(input),
  });
}

// Estúdio: cliente finalizou a seleção
export async function sendSelectionDoneEmail(input: SelectionDoneEmailInput): Promise<boolean> {
  const who = input.clientName?.trim() || 'Um cliente';
  return sendEmail({
    to: input.to,
    from: input.from,
    subject: `${who} finalizou a seleção — ${input.galleryTitle}`,
    html: selectionDoneHtml(input),
  });
}

// Mensagem livre (texto do estúdio) com botão pro link da galeria.
// Diferente das outras: retorna o MOTIVO da falha pro front mostrar a
// verdade ("enviado" só quando o Resend aceitou de fato).
export interface GalleryMessageEmailInput {
  to: string;
  from?: string | null;
  studioName: string;
  subject: string;
  messageText: string; // texto puro; quebras de linha viram <br>
  link: string;
}

export async function sendGalleryMessageEmail(
  input: GalleryMessageEmailInput,
): Promise<{ ok: boolean; error?: string }> {
  const html = emailShell(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3d3833;white-space:pre-line;">${escapeHtml(input.messageText)}</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${input.link}" style="display:inline-block;background:#D4537E;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:999px;">Abrir minha galeria</a>
      </p>
      <p style="margin:0;font-size:12px;color:#8a8377;">Se o botão não funcionar, copie e cole este link: ${input.link}</p>
  `, input.studioName);
  return sendEmailDetailed({ to: input.to, from: input.from, subject: input.subject, html });
}

// ── Envio ─────────────────────────────────────────────────────────────────────

interface SendArgs {
  to: string;
  from?: string | null;
  subject: string;
  html: string;
}

async function sendEmailDetailed({ to, from, subject, html }: SendArgs): Promise<{ ok: boolean; error?: string }> {
  if (!isMailerConfigured()) return { ok: false, error: 'E-mail não configurado no servidor (RESEND_API_KEY ausente).' };
  if (!to) return { ok: false, error: 'Cliente sem e-mail cadastrado.' };
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || process.env.RESEND_FROM || DEFAULT_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[gallery-mailer] Resend respondeu ${res.status}: ${body.slice(0, 300)}`);
      // 403 do remetente de teste = caso mais comum: domínio não verificado.
      if (res.status === 403 && body.includes('testing')) {
        return { ok: false, error: 'O remetente de teste do Resend só entrega pro dono da conta. Verifique seu domínio no Resend e configure RESEND_FROM.' };
      }
      let apiMsg = '';
      try { apiMsg = JSON.parse(body)?.message || ''; } catch { /* corpo não-JSON */ }
      return { ok: false, error: `Resend recusou (${res.status})${apiMsg ? `: ${apiMsg}` : ''}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error('[gallery-mailer] erro ao enviar e-mail:', err);
    return { ok: false, error: `Falha de rede ao enviar: ${err?.message || 'desconhecida'}` };
  }
}

async function sendEmail(args: SendArgs): Promise<boolean> {
  return (await sendEmailDetailed(args)).ok;
}

// ── Templates ─────────────────────────────────────────────────────────────────

function galleryReadyHtml(input: GalleryReadyEmailInput): string {
  const greeting = input.clientName?.trim()
    ? `Olá, <strong>${escapeHtml(input.clientName.trim())}</strong>!`
    : 'Olá!';
  const extraLine = input.extraPrice > 0
    ? ` Fotos adicionais: <strong>${formatBRL(input.extraPrice)}</strong> cada.`
    : '';

  return emailShell(`
      <h1 style="margin:0 0 16px;font-size:22px;color:#1f1b16;">Suas fotos estão prontas!</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3d3833;">${greeting}</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3d3833;">
        <strong>${escapeHtml(input.studioName)}</strong> preparou a galeria
        <strong>&ldquo;${escapeHtml(input.galleryTitle)}&rdquo;</strong> para você escolher suas fotos favoritas.
      </p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3d3833;">
        Seu pacote inclui <strong>${input.includedCount} foto(s)</strong>.${extraLine}
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(input.link)}"
           style="background:#1f1b16;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;display:inline-block;">
          Escolher minhas fotos
        </a>
      </div>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9a948b;">
        Se o botão não funcionar, copie e cole este link no navegador:<br>
        <a href="${escapeHtml(input.link)}" style="color:#9a948b;word-break:break-all;">${escapeHtml(input.link)}</a>
      </p>`,
    input.studioName
  );
}

function selectionDoneHtml(input: SelectionDoneEmailInput): string {
  const who = input.clientName?.trim() ? escapeHtml(input.clientName.trim()) : 'O cliente';
  const amountRow = input.amount > 0
    ? summaryRow('Valor das extras', formatBRL(input.amount))
    : summaryRow('Valor das extras', 'sem fotos extras');

  return emailShell(`
      <h1 style="margin:0 0 16px;font-size:22px;color:#1f1b16;">Seleção concluída</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3d3833;">
        <strong>${who}</strong> finalizou a seleção da galeria
        <strong>&ldquo;${escapeHtml(input.galleryTitle)}&rdquo;</strong>.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#f7f5f1;border-radius:8px;margin:0 0 16px;">
        ${summaryRow('Fotos selecionadas', String(input.selectedCount))}
        ${summaryRow('Fotos extras', String(input.extraCount))}
        ${amountRow}
      </table>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#3d3833;">
        Acesse o painel para conferir a seleção e dar sequência à entrega.
      </p>`,
    input.studioName
  );
}

function summaryRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 16px;font-size:14px;color:#6b655d;">${label}</td>
    <td style="padding:10px 16px;font-size:14px;color:#1f1b16;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

function emailShell(content: string, studioName: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background-color:#f0ede7;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border-radius:12px;padding:32px 28px;">
      ${content}
    </div>
    <p style="text-align:center;color:#9a948b;font-size:12px;margin-top:16px;">
      Enviado por ${escapeHtml(studioName)} &middot; e-mail automático, não é necessário responder.
    </p>
  </div>
</body>
</html>`;
}

function formatBRL(value: number): string {
  const n = Number(value) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
