import { execFile as execFileCallback } from 'node:child_process';
import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const WRANGLER = ['--yes', 'wrangler@4.127.1'];
const WORKER_DIR = resolve('workers/marketing-site-bridge');
const WORKER_NAME = 'estudio-gi-pitori-marketing-bridge';
const VERSION_TAG = 'stage1-disabled';
const SITE_KEY_ID = 'gipitori-web-20260828-v1';
const CRM_INGEST_URL = 'https://www.crmtrilha.com.br/api/public/marketing/site-intake';
const TURNSTILE_SERVICE = 'codex-estudio-gi-pitori-turnstile';
const TURNSTILE_ACCOUNT = 'www.gipitorifotografias.com.br';
const SIGNING_SERVICE = 'codex-estudio-gi-pitori-marketing-site-signing';
const INITIAL_DISABLED_DEPLOY = process.argv.includes('--initial-disabled-deploy');
const EXPECTED_ACCOUNT_ID = 'e60d496db278f00f5fa0300df1e76f35';

async function keychainRead(service, account) {
  try {
    const { stdout } = await execFile('security', [
      'find-generic-password', '-s', service, '-a', account, '-w',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function requiredKeychainSecret(service, account, errorCode) {
  const value = await keychainRead(service, account);
  if (!value) throw new Error(errorCode);
  return value;
}

async function wrangler(args) {
  return execFile('npx', [...WRANGLER, ...args], {
    cwd: WORKER_DIR,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function wranglerJsonList(args) {
  try {
    const { stdout } = await wrangler(args);
    return JSON.parse(stdout || '[]');
  } catch (error) {
    const detail = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    if (detail.includes('[code: 10007]')) return [];
    throw error;
  }
}

function uuids(text) {
  return [...new Set(String(text || '').match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi) || [])];
}

async function assertFailClosedWorkerConfig() {
  const rawConfig = await readFile(resolve(WORKER_DIR, 'wrangler.jsonc'), 'utf8');
  const config = JSON.parse(rawConfig);
  if (config.account_id !== EXPECTED_ACCOUNT_ID) throw new Error('CONTA_CLOUDFLARE_INCORRETA');
  if (config.name !== WORKER_NAME) throw new Error('WORKER_INCORRETO');
  if (config.workers_dev !== false) throw new Error('WORKERS_DEV_DEVE_ESTAR_DESATIVADO');
  if (config.preview_urls !== false) throw new Error('PREVIEWS_DEVEM_ESTAR_DESATIVADOS');
  if (config.vars?.BRIDGE_ENABLED !== 'false') throw new Error('BRIDGE_DEVE_ESTAR_DESATIVADA');
  if ('routes' in config || 'route' in config) throw new Error('ROTAS_NAO_AUTORIZADAS');
}

function requireFirstDeploymentState(beforeVersions, beforeDeployments) {
  if (beforeVersions.length !== 0 || beforeDeployments.length !== 0) {
    throw new Error('WORKER_JA_EXISTE_PRIMEIRO_DEPLOY_RECUSADO');
  }
}

async function publishWorker(secretFile, beforeVersions, beforeDeployments) {
  if (!INITIAL_DISABLED_DEPLOY) {
    return wrangler([
      'versions', 'upload',
      '--name', WORKER_NAME,
      '--tag', VERSION_TAG,
      '--message', 'Stage 1: validation only, no public route',
      '--secrets-file', secretFile,
      '--strict',
    ]);
  }
  requireFirstDeploymentState(beforeVersions, beforeDeployments);
  await assertFailClosedWorkerConfig();
  return wrangler([
    'deploy',
    '--name', WORKER_NAME,
    '--tag', VERSION_TAG,
    '--message', 'Stage 1: initial disabled deployment, no public route',
    '--secrets-file', secretFile,
    '--strict',
  ]);
}

function deploymentStatus() {
  return INITIAL_DISABLED_DEPLOY
    ? 'initial_disabled_deployment_created'
    : 'uploaded_not_deployed';
}

function assertExpectedDeploymentDelta(beforeDeployments, deployments) {
  const expectedDelta = INITIAL_DISABLED_DEPLOY ? 1 : 0;
  if (deployments.length !== beforeDeployments.length + expectedDelta) {
    throw new Error('CONTAGEM_DE_DEPLOYMENTS_INESPERADA');
  }
}

async function main() {
  const turnstileSecret = await requiredKeychainSecret(
    TURNSTILE_SERVICE,
    TURNSTILE_ACCOUNT,
    'TURNSTILE_SECRET_AUSENTE',
  );
  const signingSecret = await requiredKeychainSecret(
    SIGNING_SERVICE,
    SITE_KEY_ID,
    'SIGNING_SECRET_AUSENTE',
  );

  const beforeVersions = await wranglerJsonList([
    'versions', 'list', '--name', WORKER_NAME, '--json',
  ]);
  const beforeDeployments = await wranglerJsonList([
    'deployments', 'list', '--name', WORKER_NAME, '--json',
  ]);

  const secretFile = resolve('/private/tmp', `gipitori-worker-secrets-${process.pid}.json`);
  const secrets = {
    CRM_INGEST_URL,
    MARKETING_SITE_KEY_ID: SITE_KEY_ID,
    MARKETING_SITE_SIGNING_SECRET: signingSecret,
    TURNSTILE_SECRET_KEY: turnstileSecret,
  };
  await writeFile(secretFile, JSON.stringify(secrets), { mode: 0o600 });
  await chmod(secretFile, 0o600);
  try {
    const published = await publishWorker(secretFile, beforeVersions, beforeDeployments);
    const versions = await wranglerJsonList([
      'versions', 'list', '--name', WORKER_NAME, '--json',
    ]);
    const deployments = await wranglerJsonList([
      'deployments', 'list', '--name', WORKER_NAME, '--json',
    ]);
    assertExpectedDeploymentDelta(beforeDeployments, deployments);
    console.log(JSON.stringify({
      status: deploymentStatus(),
      worker: WORKER_NAME,
      version_tag: VERSION_TAG,
      site_key_id: SITE_KEY_ID,
      published_version_ids: uuids(published.stdout),
      previous_version_count: Array.isArray(beforeVersions) ? beforeVersions.length : null,
      remote_version_count: Array.isArray(versions) ? versions.length : null,
      deployment_count: Array.isArray(deployments) ? deployments.length : null,
      signing_secret_keychain_service: SIGNING_SERVICE,
      deployed: INITIAL_DISABLED_DEPLOY,
    }, null, 2));
  } finally {
    await unlink(secretFile).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'WORKER_UPLOAD_FAILED');
  process.exitCode = 1;
});
