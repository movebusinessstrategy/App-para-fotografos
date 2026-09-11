import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// This test never reads .env or contacts the application's database.
const temp = mkdtempSync(path.join(tmpdir(), 'crm-sale-sessions-'));
const data = path.join(temp, 'data');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
let started = false;
try {
  run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', data, '-l', path.join(temp, 'server.log'), '-o', `-k ${temp} -c listen_addresses= -p 55479`, '-w', 'start']);
  started = true;
  const result = run('psql', ['-h', temp, '-p', '55479', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-f', 'scripts/sale-sessions/schema-fixture.sql', '-f', 'migrations/077_sale_sessions.sql',
    '-f', 'migrations/077_sale_sessions.sql', '-f', 'scripts/sale-sessions/verify.sql']);
  console.log(result);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
}
