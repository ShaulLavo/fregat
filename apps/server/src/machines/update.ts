import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import rootPackage from '../../../../package.json' with { type: 'json' }
import { absolutePath, releaseInstallationSchema } from '../installation/descriptor'
import { releaseLauncherSource } from '../installation/install'
import { missingReleaseFiles, RUNTIME_MANIFEST, RUNTIME_LOCK } from '../installation/release-files'
import { shellQuote } from '../utils/shell'
import { runSsh, type SshSpawner } from './forward'
import { buildWorkingTree } from './dev-build'
import { withUpdateLock } from './update-lock'
import { checkpoint, runUpdateScript, validateCandidate } from './update-activation'
import { createSshError, updateErrors } from './structured-errors'

/** The release to install: its local directory holds `server/`, and `name` is its directory. */
export type ReleaseSource = {
  directory: string
  name: string
  manifestSha: string
  origin: 'release' | 'dev-build'
  buildMs?: number
  bundleBytes?: number
  dispose?(): Promise<void>
}

/** A production primary ships its release; a development primary builds and ships its tree. */
export type UpdateChannel = 'prod' | 'dev'

/** Where an update's release comes from, and which channel on the remote it installs into. */
export type ReleaseSupply = {
  channel: UpdateChannel
  available(): Promise<boolean>
  prepare(): Promise<ReleaseSource>
  release?(source: ReleaseSource): Promise<void>
}

/** Where a channel keeps its releases, launcher and state, relative to the remote home. */
type ChannelLayout = { serverRoot: string; launcher: string; stateHome?: string }

// A development build installs beside production, never over it, and keeps its own state.
const channels: Record<UpdateChannel, ChannelLayout> = {
  prod: { serverRoot: '.platform/server', launcher: '.local/bin/platform-server' },
  dev: {
    serverRoot: '.platform/server/dev',
    launcher: '.local/bin/platform-server-dev',
    stateHome: '.platform-dev',
  },
}

export type UpdateStep =
  | 'source'
  | 'probe'
  | 'transfer'
  | 'runtime'
  | 'validate'
  | 'swap'
  | 'restart'
  | 'connect'

export type UpdateEvent = {
  machine: string
  target?: string
  directory?: string
  fromRelease?: string | null
  toRelease?: string
  channel?: UpdateChannel
  source?: ReleaseSource['origin']
  buildMs?: number
  bundleBytes?: number
  platform?: string
  bunVersion?: string | null
  bytesSent: number
  runtimeReused?: boolean
  pruned?: string[]
  step: UpdateStep
  steps: Partial<Record<UpdateStep, number>>
  outcome: 'pending' | 'success' | 'failed' | 'cancelled'
  durationMs?: number
  error?: string
  errorCode?: string
  errorInternal?: Record<string, unknown>
}

type Remote = { spawn: SshSpawner; target: string; signal: AbortSignal }

const releaseNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const requiredBun = rootPackage.packageManager.replace(/^bun@/, '')
const longStepMs = 600_000

// A bundled server's own directory is `<release>/server` (Bun resolves the `current` or `pending`
// link it was started through). A server running from source builds its working tree instead.
export function releaseSource(
  serverDirectory: string = import.meta.dirname,
  build: () => Promise<ReleaseSource> = buildWorkingTree,
): ReleaseSupply {
  if (path.basename(serverDirectory) !== 'server') return devBuildSupply(build)
  return {
    channel: 'prod',
    available: async () => (await bundledRelease(serverDirectory)).directory !== null,
    async prepare() {
      const { directory, missing } = await bundledRelease(serverDirectory)
      if (!directory) throw updateErrors.notARelease({ internal: { serverDirectory, missing } })
      const manifest = await readFile(path.join(directory, 'server', RUNTIME_MANIFEST))
      const lockfile = await readFile(path.join(directory, 'server', RUNTIME_LOCK))
      return {
        directory,
        name: path.basename(directory),
        manifestSha: createHash('sha256').update(manifest).update(lockfile).digest('hex'),
        origin: 'release',
      }
    },
  }
}

// Two updates at once share one build: both would otherwise write apps/server/dist.
const buildSupplies = new WeakMap<() => Promise<ReleaseSource>, ReleaseSupply>()

function devBuildSupply(build: () => Promise<ReleaseSource>): ReleaseSupply {
  const existing = buildSupplies.get(build)
  if (existing) return existing
  let running: Promise<ReleaseSource> | null = null
  const users = new Map<ReleaseSource, number>()
  const supply: ReleaseSupply = {
    channel: 'dev',
    available: async () => true,
    async prepare() {
      running ??= build().finally(() => {
        running = null
      })
      const source = await running
      users.set(source, (users.get(source) ?? 0) + 1)
      return source
    },
    async release(source) {
      const remaining = (users.get(source) ?? 1) - 1
      if (remaining > 0) {
        users.set(source, remaining)
        return
      }
      users.delete(source)
      await source.dispose?.()
    },
  }
  buildSupplies.set(build, supply)
  return supply
}

async function bundledRelease(serverDirectory: string) {
  const missing = await missingReleaseFiles(serverDirectory)
  const directory = path.dirname(serverDirectory)
  if (missing.length > 0 || !releaseNamePattern.test(path.basename(directory)))
    return { directory: null, missing }
  return { directory, missing }
}

export async function timed<T>(event: UpdateEvent, step: UpdateStep, action: () => Promise<T>) {
  event.step = step
  const startedAt = Date.now()
  try {
    return await action()
  } finally {
    event.steps[step] = Date.now() - startedAt
  }
}

/** Puts the release on the remote, then points `current` and the launcher at it. */
export async function installRelease(
  remote: Remote,
  supply: ReleaseSupply,
  event: UpdateEvent,
  activate: (source: ReleaseSource) => Promise<void> = async () => undefined,
  recover: () => Promise<void> = async () => undefined,
) {
  const channel = channels[supply.channel]
  event.channel = supply.channel
  const source = await timed(event, 'source', () => supply.prepare())
  try {
    await installSource(remote, source, channel, event, activate, recover)
  } finally {
    await supply.release?.(source)
  }
}

async function installSource(
  remote: Remote,
  source: ReleaseSource,
  channel: ChannelLayout,
  event: UpdateEvent,
  activate: (source: ReleaseSource) => Promise<void>,
  recover: () => Promise<void>,
) {
  event.toRelease = source.name
  event.source = source.origin
  event.buildMs = source.buildMs
  event.bundleBytes = source.bundleBytes
  const probe = await timed(event, 'probe', () => probeRemote(remote, channel, source.name))
  event.directory = probe.serverRoot
  event.platform = probe.platform
  event.bunVersion = probe.bunVersion
  event.fromRelease = probe.currentRelease
  const bun = requireBun(probe)
  await withUpdateLock(remote, probe.serverRoot, bun, async () => {
    await checkpoint(
      remote,
      bun,
      probe.serverRoot,
      path.posix.join(probe.home, channel.launcher),
      'restore',
    )
    const current = await probeRemote(remote, channel, source.name)
    event.fromRelease = current.currentRelease
    await installLocked(remote, source, current, channel, bun, event, activate, recover)
  })
}

async function installLocked(
  remote: Remote,
  source: ReleaseSource,
  probe: Probe,
  channel: ChannelLayout,
  bun: string,
  event: UpdateEvent,
  activate: (source: ReleaseSource) => Promise<void>,
  recover: () => Promise<void>,
) {
  const files = await releaseFiles(path.join(source.directory, 'server'))
  const valid = await verifyRelease(remote, bun, probe.serverRoot, source.name, files)
  if (!valid)
    event.bytesSent = await timed(event, 'transfer', () =>
      transfer(remote, source, probe.serverRoot),
    )
  if (!(await verifyRelease(remote, bun, probe.serverRoot, source.name, files)))
    throw updateErrors.transfer({ internal: { reason: 'content-mismatch', release: source.name } })
  event.runtimeReused = await timed(event, 'runtime', () =>
    installRuntime(remote, { bun, serverRoot: probe.serverRoot, source }),
  )
  await timed(event, 'validate', () =>
    validateCandidate(remote, bun, probe.serverRoot, source.name),
  )
  const launcher = path.posix.join(probe.home, channel.launcher)
  await checkpoint(remote, bun, probe.serverRoot, launcher, 'save')
  try {
    await timed(event, 'swap', () =>
      swap(remote, {
        bun,
        home: probe.home,
        serverRoot: probe.serverRoot,
        name: source.name,
        channel,
      }),
    )
    await activate(source)
  } catch (error) {
    await checkpoint(
      { ...remote, signal: AbortSignal.timeout(15000) },
      bun,
      probe.serverRoot,
      launcher,
      'restore',
    )
    await recover()
    throw error
  }
  const output = await runUpdateScript(
    remote,
    bun,
    probe.serverRoot,
    pruneScript(source.name, probe.currentRelease),
    'prune',
  )
  event.pruned = v.parse(v.object({ pruned: v.array(v.string()) }), JSON.parse(output)).pruned
  await checkpoint(remote, bun, probe.serverRoot, launcher, 'commit')
}

async function releaseFiles(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files: Record<string, string> = {}
  for (const entry of entries) {
    const relative = path.relative(directory, path.join(entry.parentPath, entry.name))
    if (!entry.isFile() || relative.split(path.sep).includes('node_modules')) continue
    files[relative] = createHash('sha256')
      .update(await readFile(path.join(directory, relative)))
      .digest('hex')
  }
  return files
}

async function verifyRelease(
  remote: Remote,
  bun: string,
  root: string,
  name: string,
  files: Record<string, string>,
) {
  const script = `import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const files = ${JSON.stringify(files)};
const root = ${JSON.stringify(`releases/${name}/server/`)};
for (const [file, hash] of Object.entries(files)) {
  const data = await readFile(root + file).catch(() => null);
  if (!data || createHash('sha256').update(data).digest('hex') !== hash) process.exit(1);
}`
  return (await runSsh({ ...remote, script: bunCommand(bun, root, script) })).exitCode === 0
}

const probeReportSchema = v.object({
  home: absolutePath,
  platform: v.pipe(v.string(), v.maxLength(200)),
  bun: v.union([v.literal(''), absolutePath]),
  bunVersion: v.pipe(v.string(), v.maxLength(200)),
  current: v.pipe(v.string(), v.maxLength(1000)),
  present: v.picklist(['0', '1']),
})

type Probe = Awaited<ReturnType<typeof probeRemote>>

async function probeRemote(remote: Remote, channel: ChannelLayout, name: string) {
  const result = await runSsh({ ...remote, script: probeScript(channel, name) })
  if (result.exitCode !== 0)
    throw createSshError('probe', result.stderr.trim().slice(0, 2000) || undefined)
  const report = v.safeParse(probeReportSchema, reportFields(result.stdout))
  if (!report.success)
    throw createSshError('probe', 'The update probe returned an unexpected report.', report.issues)
  const { home, platform, bun, bunVersion, current, present } = report.output
  return {
    home,
    serverRoot: path.posix.join(home, channel.serverRoot),
    platform,
    bun: bun || null,
    bunVersion: /^\d+\.\d+\.\d+/.exec(bunVersion)?.[0] ?? null,
    currentRelease: releaseNameOf(current),
    present: present === '1',
  }
}

function reportFields(stdout: string) {
  const fields: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const separator = line.indexOf('=')
    if (separator < 1) continue
    fields[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return fields
}

function releaseNameOf(link: string) {
  const name = path.posix.basename(link)
  return link && releaseNamePattern.test(name) ? name : null
}

function requireBun(probe: Probe) {
  if (!probe.bun) throw updateErrors.noBun({ internal: { platform: probe.platform } })
  const found = probe.bunVersion
  if (!found || Bun.semver.order(found, requiredBun) < 0)
    throw updateErrors.oldBun({ found: found ?? 'of an unknown version', required: requiredBun })
  return probe.bun
}

function probeScript(channel: ChannelLayout, name: string) {
  return `home=$HOME
case "$home" in /*) ;; *) printf '%s\\n' 'HOME is not an absolute path.' >&2; exit 2 ;; esac
root="$home"/${shellQuote(channel.serverRoot)}
bun=$(command -v bun 2>/dev/null || true)
case "$bun" in /*) ;; *) bun='' ;; esac
if test -z "$bun" && test -x "$home/.bun/bin/bun"; then bun="$home/.bun/bin/bun"; fi
version=''
if test -n "$bun"; then version=$("$bun" --version 2>/dev/null || true); fi
current=''
if test -L "$root/current"; then current=$(readlink "$root/current"); fi
present=0
if test -f "$root/releases/"${shellQuote(name)}"/server/index.js"; then present=1; fi
printf '%s\\n' "home=$home" "platform=$(uname -sm)" "bun=$bun" "bunVersion=$version" "current=$current" "present=$present"`
}

/** Streams into a transaction-specific staging directory before replacing the release. */
async function transfer(remote: Remote, source: ReleaseSource, serverRoot: string) {
  const archive = Bun.spawn({
    cmd: ['tar', '-cf', '-', '--exclude=server/node_modules', '-C', source.directory, 'server'],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let bytes = 0
  const counted = archive.stdout.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  const [result, archiveExit, archiveError] = await Promise.all([
    runSsh({
      ...remote,
      script: transferScript(serverRoot, source.name),
      stdin: counted,
      timeoutMs: longStepMs,
    }),
    archive.exited,
    new Response(archive.stderr).text(),
  ])
  if (result.exitCode === 0 && archiveExit === 0) return bytes
  throw updateErrors.transfer({
    internal: {
      exitCode: result.exitCode,
      archiveExitCode: archiveExit,
      bytes,
      stderr: tail(result.stderr || archiveError),
    },
  })
}

function transferScript(serverRoot: string, name: string) {
  const partial = shellQuote(`${name}.partial-${randomUUID()}`)
  return `set -e
mkdir -p ${shellQuote(path.posix.join(serverRoot, 'releases'))}
cd ${shellQuote(path.posix.join(serverRoot, 'releases'))}
rm -rf ${partial}
mkdir ${partial}
tar -xf - -C ${partial}
test -f ${partial}/server/index.js
rm -rf ${shellQuote(name)}
mv ${partial} ${shellQuote(name)}`
}

type RuntimeOptions = { bun: string; serverRoot: string; source: ReleaseSource }

/** Installs `runtime/<manifest sha>` once per manifest and links the release to it. */
async function installRuntime(remote: Remote, options: RuntimeOptions) {
  const script = runtimeScript({ name: options.source.name, sha: options.source.manifestSha })
  const result = await runSsh({
    ...remote,
    script: bunCommand(options.bun, options.serverRoot, script),
    timeoutMs: longStepMs,
  })
  if (result.exitCode !== 0)
    throw updateErrors.install({ internal: { step: 'runtime', ...remoteReport(result) } })
  return v.parse(v.object({ reused: v.boolean() }), JSON.parse(result.stdout.trim())).reused
}

type SwapOptions = {
  bun: string
  home: string
  serverRoot: string
  name: string
  channel: ChannelLayout
}

/** Promotes the verified candidate; pruning waits for successful activation. */
async function swap(remote: Remote, options: SwapOptions) {
  const installation = v.parse(releaseInstallationSchema, {
    kind: 'release',
    directory: path.posix.join(options.serverRoot, 'current'),
    executable: options.bun,
    stateHome: options.channel.stateHome
      ? path.posix.join(options.home, options.channel.stateHome)
      : undefined,
  })
  const script = swapScript({
    name: options.name,
    launcher: path.posix.join(options.home, options.channel.launcher),
    launcherSource: releaseLauncherSource(installation),
  })
  const result = await runSsh({
    ...remote,
    script: bunCommand(options.bun, options.serverRoot, script),
  })
  if (result.exitCode !== 0)
    throw updateErrors.install({ internal: { step: 'swap', ...remoteReport(result) } })
  return v.parse(v.object({ pruned: v.array(v.string()) }), JSON.parse(result.stdout.trim())).pruned
}

function bunCommand(bun: string, serverRoot: string, script: string) {
  return `cd ${shellQuote(serverRoot)} && ${shellQuote(bun)} -e ${shellQuote(script)}`
}

function runtimeScript(config: { name: string; sha: string }) {
  return `import { createHash } from 'node:crypto';
import { copyFile, readFile, lstat, mkdir, rename, rm, symlink } from 'node:fs/promises';
const config = ${JSON.stringify(config)};
const runtime = 'runtime/' + config.sha;
const server = 'releases/' + config.name + '/server';
const manifest = await readFile(server + '/${RUNTIME_MANIFEST}');
const lockfile = await readFile(server + '/${RUNTIME_LOCK}');
if (createHash('sha256').update(manifest).update(lockfile).digest('hex') !== config.sha) process.exit(4);
const exists = (file) => lstat(file).then(() => true, () => false);
const reused = await exists(runtime + '/node_modules');
if (!reused) await install();
const staging = server + '/node_modules.' + process.pid + '.tmp';
await rm(staging, { force: true });
await symlink('../../../' + runtime + '/node_modules', staging);
await rename(staging, server + '/node_modules');
process.stdout.write(JSON.stringify({ reused }) + '\\n');
async function install() {
  const partial = runtime + '.partial-' + process.pid;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  await copyFile(server + '/${RUNTIME_MANIFEST}', partial + '/package.json');
  await copyFile(server + '/${RUNTIME_LOCK}', partial + '/bun.lock');
  const child = Bun.spawn({ cmd: [process.execPath, 'install', '--production', '--frozen-lockfile'], cwd: partial, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) {
    await rm(partial, { recursive: true, force: true });
    process.stderr.write(JSON.stringify({ exitCode, log: (stdout + stderr).slice(-4000) }) + '\\n');
    process.exit(3);
  }
  // A manifest without dependencies installs no node_modules, and its absence means "not installed".
  await mkdir(partial + '/node_modules', { recursive: true });
  await rm(runtime, { recursive: true, force: true });
  await rename(partial, runtime);
}
`
}

export function swapScript(config: { name: string; launcher: string; launcherSource: string }) {
  return `import { chmod, mkdir, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
const config = ${JSON.stringify(config)};
const staging = 'current.' + process.pid + '.tmp';
await rm(staging, { force: true });
await symlink('releases/' + config.name, staging);
await rename(staging, 'current');
await mkdir(path.dirname(config.launcher), { recursive: true });
const launcherStaging = config.launcher + '.' + process.pid + '.tmp';
await Bun.write(launcherStaging, config.launcherSource);
await chmod(launcherStaging, 0o700);
await rename(launcherStaging, config.launcher);
process.stdout.write(JSON.stringify({ pruned: [] }) + '\\n');
`
}

function pruneScript(name: string, previous: string | null) {
  return `import { readdir, readlink, rm } from 'node:fs/promises';
import path from 'node:path';
const keep = new Set(${JSON.stringify([name, previous])});
const pruned = [];
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
`
}

function remoteReport(result: { stderr: string; exitCode: number }) {
  try {
    const report: unknown = JSON.parse(result.stderr.trim().split('\n').at(-1) ?? '')
    if (typeof report === 'object' && report !== null && 'log' in report)
      return { exitCode: result.exitCode, log: tail(String(report.log)) }
  } catch {
    // A failure outside the install reports plain stderr.
  }
  return { exitCode: result.exitCode, stderr: tail(result.stderr) }
}

function tail(text: string) {
  return text.trim().slice(-2000)
}
