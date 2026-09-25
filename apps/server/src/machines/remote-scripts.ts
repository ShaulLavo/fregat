import path from 'node:path'
import { ORCHESTRATION_WS_PROTOCOL_VERSION, type SshMachineDefinition } from '@workspace/contracts'
import type { RemoteRecord } from './records'
import {
  releaseEnv,
  releaseEntry,
  releaseServerRoot,
  type ServerInstallation,
} from '../installation/descriptor'
import { REMOTE_SUPPORT } from '../installation/release-files'
import { shellQuote } from '../utils/shell'
import type { UpdateChannel } from './update'

type LaunchOptions = {
  machine: SshMachineDefinition
  installation: ServerInstallation
  clientId: string
  webOrigin: string
}

type RemoteLayout = {
  /** The scripts' cwd: `.platform-ssh-launch/` and `logs/` live here. */
  workingDirectory: string
  imports: string
  /** Arguments after the executable that start the server. */
  entry: readonly string[]
  env: Readonly<Record<string, string>>
  /** Defines `installedProtocol()`: the protocol a fresh launch would speak. */
  protocolSource: string
}

/** A development primary probes its own channel's launcher, so it never takes production's. */
export function probeCommand(channel: UpdateChannel = 'prod') {
  const launcher = channel === 'dev' ? 'platform-server-dev' : 'platform-server'
  return `if command -v ${launcher} >/dev/null 2>&1; then
  exec ${launcher} --describe
fi
if test -x "$HOME/.local/bin/${launcher}"; then
  exec "$HOME/.local/bin/${launcher}" --describe
fi
printf '%s\\n' '{"code":"machines.SSH_NOT_INSTALLED","message":"Platform server is not installed for this SSH user."}' >&2
exit 127`
}

// A release's lease state stays in its server root: inside releases/<name> a `current` swap
// would orphan the records, and an update could never find the server it has to stop.
export function remoteLayout(installation: ServerInstallation): RemoteLayout {
  if (installation.kind === 'source')
    return {
      workingDirectory: installation.directory,
      imports: `import { createError } from 'evlog';
import { healthDescriptorSchema } from './packages/contracts/src/health.ts';`,
      entry: ['--env-file=.env', 'apps/server/src/index.ts'],
      env: {},
      protocolSource: `async function installedProtocol() {
  try {
    const source = await readFile('packages/contracts/src/orchestration-ws.ts', 'utf8');
    const match = /ORCHESTRATION_WS_PROTOCOL_VERSION *= *([0-9]+)/.exec(source);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}`,
    }
  const support = path.posix.join(installation.directory, 'server', REMOTE_SUPPORT)
  return {
    workingDirectory: releaseServerRoot(installation),
    imports: `import { createError, healthDescriptorSchema, ORCHESTRATION_WS_PROTOCOL_VERSION as releaseProtocol } from ${JSON.stringify(support)};`,
    entry: [releaseEntry(installation)],
    env: releaseEnv(installation),
    protocolSource: 'async function installedProtocol() { return releaseProtocol; }',
  }
}

/** Names the log a failed launch wrote, which a release keeps in its server root. */
export function launchFailureFix(installation: ServerInstallation) {
  const log = path.posix.join(remoteLayout(installation).workingDirectory, 'logs/ssh-launch.log')
  return `Inspect ${log} on that machine and verify its dependencies are installed, then Retry.`
}

function bunCommand(installation: ServerInstallation, script: string) {
  return `cd ${shellQuote(remoteLayout(installation).workingDirectory)} && ${shellQuote(installation.executable)} -e ${shellQuote(script)}`
}

export function launchCommand(options: LaunchOptions) {
  return bunCommand(options.installation, launchScript(options))
}

export function stopCommand(
  options: { installation: ServerInstallation; clientId: string },
  record: RemoteRecord | null,
) {
  return bunCommand(options.installation, stopScript(options, record))
}

const prelude = (layout: RemoteLayout) => `
import { mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import net from 'node:net';
import { Database } from 'bun:sqlite';
${layout.imports}
const fail = (message, code = 'machines.SSH_REMOTE', details = {}) => { throw Object.assign(createError({ code, status: 502, message, why: 'The remote launcher could not complete the requested lifecycle operation.' }), { details }); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function processStart(pid) {
  const result = Bun.spawnSync({ cmd: ['ps', '-p', String(pid), '-o', 'lstart='], stdout: 'pipe', stderr: 'ignore' });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}
async function readRecord(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeRecord(file, record) {
  const temporary = file + '.' + process.pid + '.tmp';
  await Bun.write(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, file);
}
async function removeRecord(file) {
  try { await unlink(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function withLeaseLock(action) {
  await mkdir('.platform-ssh-launch', { recursive: true, mode: 0o700 });
  const lock = new Database('.platform-ssh-launch/lock.sqlite', { create: true });
  try {
    lock.exec('PRAGMA busy_timeout = 10000');
    lock.exec('BEGIN IMMEDIATE');
    return await runLocked(lock, action);
  } finally { lock.close(); }
}
async function runLocked(lock, action) {
  try {
    const result = await action();
    lock.exec('COMMIT');
    return result;
  } catch (error) {
    lock.exec('ROLLBACK');
    throw error;
  }
}
function managedProcess(record) {
  return record.kind === 'managed' && typeof record.processId === 'string' && /^[a-f0-9-]{36}$/.test(record.processId) && Number.isInteger(record.pid) && record.pid > 0 && typeof record.startedAt === 'string' && record.startedAt.length > 0;
}
function sameManagedProcess(left, right) {
  if (!managedProcess(left) || !managedProcess(right) || left.processId !== right.processId) return false;
  if (left.environmentId && right.environmentId && left.environmentId !== right.environmentId) fail('Recorded environment identity changed.', 'machines.SSH_IDENTITY');
  return true;
}
function processFile(record) {
  if (!managedProcess(record)) fail('Invalid managed process record.');
  return '.platform-ssh-launch/' + record.processId + '.process';
}
async function writeManagedProcess(record) {
  const { leaseId, ...processRecord } = record;
  await writeRecord(processFile(record), processRecord);
}
async function currentRecord(lease) {
  if (lease.kind === 'external') return lease;
  const current = await readRecord(processFile(lease));
  if (!current || !managedProcess(current) || current.processId !== lease.processId) fail('The managed process record is missing or invalid.');
  if (lease.environmentId && current.environmentId && lease.environmentId !== current.environmentId) fail('Recorded environment identity changed.', 'machines.SSH_IDENTITY');
  return { ...current, leaseId: lease.leaseId };
}
async function recordFiles(extension) {
  return (await readdir('.platform-ssh-launch')).filter((name) => name.endsWith(extension)).map((name) => '.platform-ssh-launch/' + name);
}
async function otherLeaseCount(file, record) {
  let count = 0;
  for (const otherFile of await recordFiles('.json')) {
    if (otherFile === file) continue;
    const other = await readRecord(otherFile);
    if (other && sameManagedProcess(other, record)) count += 1;
  }
  return count;
}
async function stopManagedProcess(record) {
  if (alive(record.pid)) process.kill(record.pid, 'SIGTERM');
  const deadline = Date.now() + 3000;
  while (alive(record.pid) && processStart(record.pid) === record.startedAt && Date.now() < deadline) await Bun.sleep(50);
  if (alive(record.pid) && processStart(record.pid) === record.startedAt) process.kill(record.pid, 'SIGKILL');
}
async function health(port, webOrigin) {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/health', { headers: { Origin: webOrigin }, signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    const parsed = await healthDescriptorSchema['~standard'].validate(await response.json());
    return parsed.issues ? null : parsed.value;
  } catch { return null; }
}
`

export function launchScript({ machine, installation, clientId, webOrigin }: LaunchOptions) {
  const layout = remoteLayout(installation)
  return `${prelude(layout)}
const config = ${JSON.stringify({ clientId, webOrigin, remotePort: machine.remotePort ?? null, expectedProtocol: ORCHESTRATION_WS_PROTOCOL_VERSION, installation: installation.kind, entry: layout.entry, env: layout.env })};
const recordFile = '.platform-ssh-launch/' + config.clientId + '.json';
let previousRecord = null;
let managedGroup = null;
await mkdir('.platform-ssh-launch', { recursive: true, mode: 0o700 });
await mkdir('logs', { recursive: true });
function availablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      const address = probe.address();
      const selected = address.port;
      probe.close(() => resolve(selected));
    });
  });
}
async function emit(record, descriptor) {
  const expectedIdentity = previousRecord?.environmentId ?? managedGroup?.environmentId;
  if (expectedIdentity && descriptor.environmentId !== expectedIdentity) fail('Recorded environment identity changed.', 'machines.SSH_IDENTITY');
  const confirmed = { ...record, environmentId: descriptor.environmentId };
  if (confirmed.kind === 'managed') await writeManagedProcess(confirmed);
  await writeRecord(recordFile, confirmed);
  process.stdout.write(JSON.stringify({ ...confirmed, descriptor }) + '\\n');
}
${layout.protocolSource}
function protocolFail(record, descriptor, installed, otherLeases) {
  fail('The remote server speaks protocol ' + descriptor.protocolVersion + ', and this Platform needs protocol ' + config.expectedProtocol + '.', 'machines.SSH_PROTOCOL', { expected: config.expectedProtocol, running: descriptor.protocolVersion, installed, installation: config.installation, kind: record.kind, otherLeases, port: record.port, directory: process.cwd() });
}
async function replaceStale(record, descriptor) {
  if (descriptor.protocolVersion === config.expectedProtocol) return false;
  const installed = await installedProtocol();
  const otherLeases = record.kind === 'managed' ? await otherLeaseCount(recordFile, record) : 0;
  if (record.kind !== 'managed' || installed !== config.expectedProtocol || otherLeases > 0) protocolFail(record, descriptor, installed, otherLeases);
  await stopManagedProcess(record);
  return true;
}
async function reuse() {
  const lease = await readRecord(recordFile);
  if (!lease) return false;
  const record = await currentRecord(lease);
  previousRecord = record;
  if (typeof record.leaseId !== 'string' || !/^[a-f0-9-]{36}$/.test(record.leaseId)) fail('Invalid remote lease identity.');
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !['managed', 'external'].includes(record.kind)) fail('Invalid launch record; inspect ' + recordFile);
  if (record.kind === 'managed' && !managedProcess(record)) fail('Invalid managed process record.');
  if (record.kind === 'managed' && (!alive(record.pid) || processStart(record.pid) !== record.startedAt)) {
    await removeRecord(recordFile);
    return false;
  }
  const descriptor = await health(record.port, config.webOrigin);
  if (descriptor && await replaceStale(record, descriptor)) return false;
  if (descriptor) {
    await emit(record, descriptor);
    return true;
  }
  if (record.kind === 'managed' && Number.isInteger(record.pid) && alive(record.pid)) fail('The recorded managed server is still running but its health endpoint is unavailable.');
  await unlink(recordFile);
  return false;
}
async function launch() {
  if (await reuse()) return;
  const shared = await sharedManagedServer();
  if (shared) return emit({ ...shared.record, leaseId: previousRecord?.leaseId ?? crypto.randomUUID() }, shared.descriptor);
  const descriptor = config.remotePort ? await health(config.remotePort, config.webOrigin) : null;
  if (descriptor) {
    const record = { kind: 'external', processId: null, pid: null, startedAt: null, port: config.remotePort };
    await replaceStale(record, descriptor);
    return emit({ ...record, leaseId: previousRecord?.leaseId ?? crypto.randomUUID() }, descriptor);
  }
  const port = await availablePort(config.remotePort ?? 0);
  managedGroup = previousRecord?.kind === 'managed' ? previousRecord : await dormantManagedRecord(port);
  const log = openSync('logs/ssh-launch.log', 'a', 0o600);
  const child = Bun.spawn({ cmd: ['nohup', process.execPath, ...config.entry], env: { ...process.env, ...config.env, FS_HOST: '127.0.0.1', PORT: String(port), SERVER_ALLOWED_ORIGINS: config.webOrigin }, stdin: 'ignore', stdout: log, stderr: log });
  closeSync(log);
  child.unref();
  const record = { leaseId: previousRecord?.leaseId ?? crypto.randomUUID(), processId: managedGroup?.processId ?? crypto.randomUUID(), kind: 'managed', pid: child.pid, startedAt: processStart(child.pid), port, environmentId: previousRecord?.environmentId ?? managedGroup?.environmentId ?? null };
  try {
    if (!record.startedAt) fail('The launched process could not be identified.');
    await writeManagedProcess(record);
    await writeRecord(recordFile, record);
    const descriptor = await managedHealth(child, port);
    if (descriptor.protocolVersion !== config.expectedProtocol) protocolFail(record, descriptor, await installedProtocol(), 0);
    return await emit(record, descriptor);
  } catch (error) {
    await stopFailedChild(child);
    await removeRecord(recordFile);
    throw error;
  }
}
async function dormantManagedRecord(port) {
  for (const file of await recordFiles('.process')) {
    const record = await readRecord(file);
    if (!record || !managedProcess(record) || record.port !== port) continue;
    if (alive(record.pid) && processStart(record.pid) === record.startedAt) continue;
    return record;
  }
  return null;
}
async function sharedManagedServer() {
  for (const file of await recordFiles('.process')) {
    const record = await readRecord(file);
    if (!record || !managedProcess(record)) continue;
    if (config.remotePort && record.port !== config.remotePort) continue;
    if (!alive(record.pid) || processStart(record.pid) !== record.startedAt) continue;
    const descriptor = await health(record.port, config.webOrigin);
    if (!descriptor) continue;
    if (record.environmentId && record.environmentId !== descriptor.environmentId) fail('Recorded environment identity changed.', 'machines.SSH_IDENTITY');
    if (!(await replaceStale(record, descriptor))) return { record, descriptor };
    await removeRecord(file);
  }
  return null;
}
async function managedHealth(child, port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const descriptor = await health(port, config.webOrigin);
    if (descriptor) return descriptor;
    if (child.exitCode !== null || child.signalCode !== null) break;
    await Bun.sleep(200);
  }
  fail('The remote server did not become ready within 30 seconds.');
}
async function stopFailedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await child.exited; }
  finally { clearTimeout(timeout); }
}
try { await withLeaseLock(launch); }
catch (error) { process.stderr.write(JSON.stringify({ ...error.details, code: error.code, message: error.message }) + '\\n'); process.exit(1); }
`
}

export function stopScript(
  { installation, clientId }: { installation: ServerInstallation; clientId: string },
  expected: RemoteRecord | null,
) {
  return `${prelude(remoteLayout(installation))}
const recordFile = '.platform-ssh-launch/' + ${JSON.stringify(clientId)} + '.json';
const expected = ${JSON.stringify(expected)};
async function stop() {
  const lease = await readRecord(recordFile);
  if (!lease) return;
  if (expected && (lease.leaseId !== expected.leaseId || lease.environmentId !== expected.environmentId)) fail('The launch record changed; refusing to stop another process.');
  if (lease.kind === 'external') { await unlink(recordFile); return; }
  const record = await currentRecord(lease);
  if (record.kind !== 'managed' || !Number.isInteger(record.pid) || record.pid < 1) fail('Invalid managed process record.');
  if (alive(record.pid) && (!record.startedAt || processStart(record.pid) !== record.startedAt)) fail('The PID was reused; refusing to stop another process.');
  if ((await otherLeaseCount(recordFile, record)) > 0) { await unlink(recordFile); return; }
  await stopManagedProcess(record);
  await unlink(recordFile);
  await removeRecord(processFile(record));
}
await withLeaseLock(stop);
`
}
