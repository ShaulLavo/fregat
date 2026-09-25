// Shared by replacement admission and pruning; old or uncertain live records protect all releases.
const releaseProtectionSource = `
async function protectedReleases() {
  const keep = new Set();
  const records = await readdir('.platform-ssh-launch').catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of records.filter(file => file.endsWith('.process'))) {
    const record = JSON.parse(await readFile('.platform-ssh-launch/' + file, 'utf8'));
    if (!Number.isInteger(record.pid) || record.pid <= 0) return null;
    try { process.kill(record.pid, 0); } catch (error) {
      if (error.code === 'ESRCH') continue;
      return null;
    }
    const start = Bun.spawnSync(['ps', '-p', String(record.pid), '-o', 'lstart=']);
    if (start.exitCode !== 0) return null;
    if (start.stdout.toString().trim() !== record.startedAt) continue;
    if (typeof record.releaseDirectory !== 'string') return null;
    const directory = path.resolve(record.releaseDirectory);
    if (path.dirname(directory) !== path.resolve('releases')) return null;
    keep.add(path.basename(directory));
  }
  return keep;
}
`

export function pruneScript(name: string, previous: string | null) {
  return `import { mkdir, readdir, readFile, readlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { Database } from 'bun:sqlite';
${releaseProtectionSource}
await mkdir('.platform-ssh-launch', { recursive: true });
const lock = new Database('.platform-ssh-launch/lock.sqlite');
lock.exec('PRAGMA busy_timeout = 10000; BEGIN IMMEDIATE');
try { await prune(); } finally { lock.close(); }
async function prune() {
  const pruned = [];
  const live = await protectedReleases();
  if (live === null) { process.stdout.write(JSON.stringify({ pruned }) + '\\n'); return; }
  const keep = new Set([...live, ...${JSON.stringify([name, previous])}]);
  for (const entry of await readdir('releases')) {
    if (keep.has(entry)) continue;
    await rm('releases/' + entry, { recursive: true, force: true });
    pruned.push(entry);
  }
  const linked = new Set();
  for (const entry of keep) {
    const target = await readlink('releases/' + entry + '/server/node_modules').catch(() => null);
    if (target) linked.add(path.basename(path.dirname(target)));
  }
  for (const entry of await readdir('runtime').catch(() => [])) {
    if (!linked.has(entry)) await rm('runtime/' + entry, { recursive: true, force: true });
  }
  for (const entry of await readdir('.')) {
    if (/^current\\.[0-9]+\\.tmp$/.test(entry)) await rm(entry, { force: true });
  }
  process.stdout.write(JSON.stringify({ pruned }) + '\\n');
}
`
}

export function replaceableReleaseScript(name: string) {
  return `import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
${releaseProtectionSource}
const name = ${JSON.stringify(name)};
const current = await readlink('current').catch(() => null);
if (current && path.basename(current) === name) process.exit(6);
const live = await protectedReleases();
if (live === null || live.has(name)) process.exit(6);
`
}
