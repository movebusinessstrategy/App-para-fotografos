import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const sender = String(process.argv[2] || '').replace(/\D/g, '');
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const pageSize = 1000;

function requireConfig() {
  const missing = Object.entries({
    VITE_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    sender,
  }).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function canonicalCustomerPhone(value) {
  const clean = digits(value);
  if (clean.length === 13 && clean.startsWith('55') && clean[4] === '9') {
    return clean.slice(0, 4) + clean.slice(5);
  }
  return clean;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

async function loadAccount(client) {
  const { data, error } = await client
    .from('whatsapp_business_accounts')
    .select('user_id,phone_number,is_active')
    .eq('is_active', true)
    .limit(20);
  if (error) throw new Error(`Falha ao ler conta WABA: ${error.message}`);
  const account = (data || []).find((row) => digits(row.phone_number) === sender);
  if (!account) throw new Error(`Nenhuma WABA ativa encontrada para ${sender}`);
  return account;
}

async function loadAll(client, table, columns, userId, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order(orderColumn, { ascending: true, nullsFirst: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Falha ao ler ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function addToSetMap(map, key, value) {
  let values = map.get(key);
  if (!values) {
    values = new Set();
    map.set(key, values);
  }
  values.add(value);
}

function countBlankSender(rows) {
  return rows.filter((row) => !digits(row.wa_number)).length;
}

function distinctSenders(rows) {
  return [...new Set(rows.map((row) => digits(row.wa_number)).filter(Boolean))].sort();
}

function countBySender(rows) {
  const counts = {};
  for (const row of rows) {
    const key = digits(row.wa_number) || 'blank';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function conversationKey(row) {
  return `${digits(row.wa_number)}|${canonicalCustomerPhone(row.phone)}`;
}

function duplicateConversationGroups(conversations) {
  const counts = new Map();
  for (const row of conversations) {
    const key = conversationKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

function exactDuplicateConversationGroups(conversations) {
  const counts = new Map();
  for (const row of conversations) {
    const key = `${digits(row.wa_number)}|${digits(row.phone)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

function crossChannelCustomers(rows) {
  const byCustomer = new Map();
  for (const row of rows) {
    const customer = canonicalCustomerPhone(row.phone);
    const waNumber = digits(row.wa_number);
    if (customer && waNumber) addToSetMap(byCustomer, customer, waNumber);
  }
  return [...byCustomer.entries()].filter(([, senders]) => senders.size > 1);
}

function orphanMessages(conversations, messages) {
  const conversationKeys = new Set(conversations.map(conversationKey));
  return messages.filter((row) => !conversationKeys.has(conversationKey(row)));
}

function classifyOrphans(conversations, orphans) {
  const sendersByCustomer = new Map();
  for (const row of conversations) {
    addToSetMap(sendersByCustomer, canonicalCustomerPhone(row.phone), digits(row.wa_number));
  }
  const result = { conversation_in_other_channel: 0, no_conversation_in_any_channel: 0 };
  for (const row of orphans) {
    const known = sendersByCustomer.get(canonicalCustomerPhone(row.phone));
    if (known?.size) result.conversation_in_other_channel += 1;
    else result.no_conversation_in_any_channel += 1;
  }
  return result;
}

function anonymizedSamples(groups) {
  return groups.slice(0, 10).map(([key, value]) => ({
    key_hash: hash(key),
    count: typeof value === 'number' ? value : value.size,
  }));
}

async function main() {
  requireConfig();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const account = await loadAccount(client);
  const [conversations, messages] = await Promise.all([
    loadAll(client, 'wa_conversations', 'id,phone,wa_number,last_message_at', account.user_id, 'id'),
    loadAll(client, 'wa_messages', 'id,phone,wa_number,message_id,timestamp', account.user_id, 'id'),
  ]);
  const duplicateConversations = duplicateConversationGroups(conversations);
  const exactDuplicates = exactDuplicateConversationGroups(conversations);
  const crossChannels = crossChannelCustomers(conversations);
  const orphans = orphanMessages(conversations, messages);

  console.log(JSON.stringify({
    audited_at: new Date().toISOString(),
    account_sender: sender,
    conversations: {
      total: conversations.length,
      blank_wa_number: countBlankSender(conversations),
      distinct_wa_numbers: distinctSenders(conversations),
      rows_by_wa_number: countBySender(conversations),
      exact_duplicate_composite_groups: exactDuplicates.length,
      duplicate_composite_groups: duplicateConversations.length,
      duplicate_composite_samples: anonymizedSamples(duplicateConversations),
      customers_present_in_multiple_channels: crossChannels.length,
      cross_channel_samples: anonymizedSamples(crossChannels),
    },
    messages: {
      total: messages.length,
      blank_wa_number: countBlankSender(messages),
      distinct_wa_numbers: distinctSenders(messages),
      rows_by_wa_number: countBySender(messages),
      without_matching_channel_conversation: orphans.length,
      orphan_classification: classifyOrphans(conversations, orphans),
      orphan_samples: orphans.slice(0, 10).map((row) => ({
        key_hash: hash(conversationKey(row)),
        message_id_hash: hash(row.message_id),
      })),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
