import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temp = mkdtempSync(path.join(tmpdir(), 'crm-cancel-split-'));
const data = path.join(temp, 'data');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
let started = false;
try {
  run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', data, '-l', path.join(temp, 'server.log'), '-o', `-k ${temp} -c listen_addresses= -p 55481`, '-w', 'start']);
  started = true;
  const output = run('psql', [
    '-h', temp, '-p', '55481', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-f', 'scripts/sale-sessions/schema-fixture.sql',
    '-f', 'migrations/077_sale_sessions.sql',
    '-f', 'scripts/sale-sessions/schema-cancellation-fixture.sql',
    '-f', 'migrations/079_sale_cancellations_and_job_split.sql',
    '-f', 'scripts/sale-sessions/verify-cancellation-and-split.sql',
  ]);
  console.log(output);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
}

