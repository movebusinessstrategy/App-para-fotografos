import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const sender = String(process.argv[2] || '').replace(/\D/g, '');
const recipient = String(process.argv[3] || '').replace(/\D/g, '');
const body = process.argv[4] || 'Teste técnico WABA CRM Trilha — não precisa responder.';
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function requireConfig() {
  const required = {
    VITE_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    sender,
    recipient,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function decryptToken(blob) {
  if (!blob?.startsWith('enc:v1:')) return blob || null;
  const keyHex = process.env.WA_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(keyHex)) return null;
  const [, , ivBase64, tagBase64, ciphertextBase64] = blob.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivBase64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function loadAccount(client) {
  const { data, error } = await client
    .from('whatsapp_business_accounts')
    .select('user_id,phone_number_id,phone_number,access_token,is_active,mode')
    .eq('is_active', true)
    .limit(20);
  if (error) throw new Error(`Falha ao ler conta WABA: ${error.message}`);
  const account = (data || []).find((row) =>
    String(row.phone_number || '').replace(/\D/g, '') === sender
  );
  if (!account) throw new Error(`Nenhuma WABA ativa encontrada para ${sender}`);
  return account;
}

async function sendMetaMessage(account, token) {
  const response = await fetch(`${GRAPH}/${account.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function persistSentMessage(client, account, messageId) {
  const now = new Date().toISOString();
  const waNumber = String(account.phone_number || '').replace(/\D/g, '');
  const message = {
    user_id: account.user_id,
    phone: recipient,
    wa_number: waNumber,
    message_id: messageId,
    body,
    from_me: true,
    timestamp: now,
    type: 'text',
    status: 'sent',
  };
  const { error: messageError } = await client.from('wa_messages').insert(message);
  if (messageError) throw new Error(`Mensagem enviada, mas não persistida: ${messageError.message}`);

  const conversation = {
    user_id: account.user_id,
    phone: recipient,
    wa_number: waNumber,
    last_message: body,
    last_message_at: now,
    updated_at: now,
  };
  const { data: updated, error: updateError } = await client
    .from('wa_conversations')
    .update(conversation)
    .eq('user_id', account.user_id)
    .eq('wa_number', waNumber)
    .eq('phone', recipient)
    .select('id');
  if (updateError) throw new Error(`Mensagem enviada, mas a conversa não foi atualizada: ${updateError.message}`);
  if (updated?.length) return;
  const { error: insertError } = await client.from('wa_conversations').insert(conversation);
  if (insertError) throw new Error(`Mensagem enviada, mas a conversa não foi criada: ${insertError.message}`);
}

function safeFailure(result) {
  const error = result.data?.error || {};
  return {
    sent: false,
    http_status: result.status,
    error_code: error.code || null,
    error_subcode: error.error_subcode || null,
    error_message: error.message || 'Falha desconhecida da Meta',
  };
}

async function main() {
  requireConfig();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const account = await loadAccount(client);
  const token = decryptToken(account.access_token);
  if (!token) throw new Error('Token WABA não pôde ser decifrado');

  const result = await sendMetaMessage(account, token);
  if (!result.ok || result.data?.error) {
    console.log(JSON.stringify(safeFailure(result), null, 2));
    process.exitCode = 2;
    return;
  }

  const messageId = result.data?.messages?.[0]?.id;
  if (!messageId) throw new Error('Meta aceitou a chamada sem retornar message_id');
  await persistSentMessage(client, account, messageId);
  console.log(JSON.stringify({
    sent: true,
    http_status: result.status,
    message_id: messageId,
    persisted: true,
    sender,
    recipient,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
