import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const WRANGLER = ['--yes', 'wrangler@4.127.1'];
const WIDGET_NAME = 'Estúdio Gi Pitori Marketing Bridge';
const DOMAIN = 'www.gipitorifotografias.com.br';
const KEYCHAIN_SERVICE = 'codex-estudio-gi-pitori-turnstile';
const KEYCHAIN_ACCOUNT = DOMAIN;

function findString(value, names) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (names.includes(key) && typeof child === 'string' && child.trim()) return child.trim();
  }
  for (const child of Object.values(value)) {
    const found = findString(child, names);
    if (found) return found;
  }
  return null;
}

async function wrangler(args) {
  return execFile('npx', [...WRANGLER, ...args], {
    cwd: resolve('workers/marketing-site-bridge'),
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function existingWidget() {
  const { stdout } = await wrangler(['turnstile', 'widget', 'list', '--json']);
  const parsed = JSON.parse(stdout);
  const widgets = Array.isArray(parsed) ? parsed : parsed.result || parsed.widgets || [];
  return widgets.find((widget) => widget?.name === WIDGET_NAME) || null;
}

async function createWidget() {
  const { stdout } = await wrangler([
    'turnstile', 'widget', 'create', WIDGET_NAME,
    '--domain', DOMAIN,
    '--mode', 'managed',
    '--clearance-level', 'no_clearance',
    '--region', 'world',
    '--json',
  ]);
  return JSON.parse(stdout);
}

async function storeSecret(secret) {
  await execFile('security', [
    'add-generic-password',
    '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', KEYCHAIN_ACCOUNT,
    '-w', secret,
  ]);
}

async function main() {
  const existing = await existingWidget();
  if (existing) {
    console.log(JSON.stringify({
      status: 'already_exists',
      name: WIDGET_NAME,
      domain: DOMAIN,
      sitekey: findString(existing, ['sitekey', 'site_key']) || null,
      note: 'segredo existente não foi lido nem alterado',
    }, null, 2));
    return;
  }

  const created = await createWidget();
  const sitekey = findString(created, ['sitekey', 'site_key']);
  const secret = findString(created, ['secret', 'secret_key']);
  if (!sitekey || !secret) throw new Error('TURNSTILE_RESPOSTA_INCOMPLETA');
  await storeSecret(secret);
  console.log(JSON.stringify({
    status: 'created',
    name: WIDGET_NAME,
    domain: DOMAIN,
    mode: 'managed',
    sitekey,
    keychain_service: KEYCHAIN_SERVICE,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'TURNSTILE_CREATE_FAILED');
  process.exitCode = 1;
});
