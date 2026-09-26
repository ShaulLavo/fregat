import { shellQuote } from '../utils/shell'
import { runSsh, type SshSpawner } from './forward'
import { updateErrors } from './structured-errors'

type Remote = { spawn: SshSpawner; target: string; signal: AbortSignal }

export async function runUpdateScript(
  remote: Remote,
  bun: string,
  root: string,
  script: string,
  step: string,
) {
  const result = await runSsh({
    ...remote,
    script: `cd ${shellQuote(root)} && ${shellQuote(bun)} -e ${shellQuote(script)}`,
  })
  if (result.exitCode !== 0)
    throw updateErrors.install({
      internal: { step, exitCode: result.exitCode, stderr: result.stderr.slice(-2000) },
    })
  return result.stdout
}

export async function checkpoint(
  remote: Remote,
  bun: string,
  root: string,
  launcher: string,
  action: 'save' | 'restore' | 'commit',
) {
  const script = `import { chmod, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
const launcher = ${JSON.stringify(launcher)};
const action = ${JSON.stringify(action)};
const file = '.update-recovery.json';
if (action === 'save') {
  const current = await readlink('current').catch(() => null);
  const source = await readFile(launcher, 'utf8').catch(() => null);
  await writeFile(file + '.tmp', JSON.stringify({ current, source }), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
if (action === 'restore') {
  const saved = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (saved) await restore(saved);
}
if (action !== 'save') await rm(file, { force: true });
async function restore(saved) {
  await rm('current.rollback', { force: true });
  if (saved.current) {
    await symlink(saved.current, 'current.rollback');
    await rename('current.rollback', 'current');
  } else await rm('current', { force: true });
  if (saved.source === null) return rm(launcher, { force: true });
  await writeFile(launcher + '.rollback', saved.source, { mode: 0o700 });
  await rename(launcher + '.rollback', launcher);
}`
  await runUpdateScript(remote, bun, root, script, action)
}

export async function validateCandidate(remote: Remote, bun: string, root: string, name: string) {
  const script = `import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
const home = await mkdtemp(path.resolve('.candidate-'));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const child = Bun.spawn([process.execPath, ${JSON.stringify(`releases/${name}/server/index.js`)}], {
  env: { ...process.env, PLATFORM_HOME: home, FS_METADATA_DB: home + '/metadata.sqlite', FS_HOST: '127.0.0.1', PORT: String(port), SERVER_ALLOWED_ORIGINS: 'http://localhost' },
  stdin: 'ignore', stdout: 'ignore', stderr: 'pipe'
});
const stderr = new Response(child.stderr).text();
let ready = false;
try {
  ready = await health();
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await child.exited;
  clearTimeout(timer);
  await rm(home, { recursive: true, force: true });
}
if (!ready) { process.stderr.write((await stderr).slice(-2000)); process.exit(5); }
async function health() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    const response = await fetch('http://127.0.0.1:' + port + '/health', { headers: { Origin: 'http://localhost' }, signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok && (await response.json()).ok === true) return true;
    await Bun.sleep(50);
  }
  return false;
}`
  await runUpdateScript(remote, bun, root, script, 'validate')
}
