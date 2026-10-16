import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';

const directory = await mkdtemp(join(tmpdir(), 'dropmine-redis-test-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Redis did not start within 10 seconds')), 10_000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', () => { clearTimeout(timeout); reject(new Error('Redis exited before it was ready')); });
    server.stdout.on('data', data => {
      log += data.toString();
      if (log.includes('Ready to accept connections')) { clearTimeout(timeout); resolve(); }
    });
    server.stderr.on('data', data => { log += data.toString(); });
  });
  const command = process.argv.includes('--e2e') ? ['--import', 'tsx', 'scripts/redis-e2e.ts'] : ['node_modules/vitest/vitest.mjs', 'run', 'tests/backend/redis.test.ts'];
  const tests = spawn(process.execPath, command, {
    stdio: 'inherit', env: { ...process.env, TEST_REDIS_URL: `redis://127.0.0.1:${port}` },
  });
  const [exitCode] = await once(tests, 'exit');
  process.exitCode = exitCode ?? 1;
} catch (error) {
  console.error(error.message, log);
  process.exitCode = 1;
} finally {
  if (server.pid && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    const deadline = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(deadline);
  }
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Refusing to remove a directory outside the temporary folder');
  await rm(directory, { recursive: true, force: true });
}
