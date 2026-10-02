// Bundled into bin/promote.js for machine services and bin/promote.ts for the mesh unit.
// The entry point keeps startup available by logging failures and exiting 0.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { machineServiceIntentSchema } from '../../../packages/contracts/src/server-identity'
import { probeAddress } from '../../service/probe'
import { currentRelease, pointCurrentAt } from '../release-operations'

export const serverPort = 3301
export const serverUnit = 'platform-prod.service'

const liveCheckWaitMs = 120_000
const playwrightCache = '/work/cache/ms-playwright'
const requiredFiles = [
  'server/index.js',
  'web/index.html',
  'build-config.json',
  'server/node_modules',
  'node_modules',
]

export type LiveCheckTarget = {
  name: string
  directory: string
  /** The release whose live-check.json is the baseline. */
  previous: string | null
  /** The checkout that holds live-check.mjs. */
  source: string
}

export type LiveCheckCommand = { argv: string[]; cwd: string; env: Record<string, string> }
export type Launch = (argv: readonly string[]) => boolean
export type PromoteOutcome = 'none' | 'rejected' | 'already-current' | 'promoted' | 'failed'
export type SignalOutcome = 'signalled' | 'incapable' | 'unreachable' | 'failed'

/** Why a release directory cannot be served, or null when it can. */
export function releaseProblem(directory: string): string | null {
  if (!existsSync(directory)) return `${directory} does not exist`
  const missing = requiredFiles.filter((file) => !existsSync(path.join(directory, file)))
  if (missing.length === 0) return null

  return `${directory} is missing ${missing.join(', ')}`
}

export function liveCheckCommand(
  target: LiveCheckTarget,
  root: string,
  waitMs: number,
): LiveCheckCommand {
  const PATH = process.env.PATH ?? '/usr/bin:/bin'
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? existingPath(playwrightCache)
  const baseline = target.previous ? path.join(target.previous, 'live-check.json') : ''
  const argv = [
    Bun.which('node', { PATH }) ?? 'node',
    path.join(target.source, 'scripts/deploy/live-check.mjs'),
    `--release=${target.name}`,
    `--out=${target.directory}`,
    `--baseline=${baseline}`,
    `--logs=${path.join(root, 'logs')}`,
  ]
  if (waitMs > 0) argv.push(`--wait-for-server=${waitMs}`)
  const env: Record<string, string> = { PATH }
  if (browsers) env.PLAYWRIGHT_BROWSERS_PATH = browsers

  return { argv, cwd: target.source, env }
}

export function liveCheckUnitName(target: Pick<LiveCheckTarget, 'name'>) {
  return `platform-live-check-${target.name}`
}

/** A transient user unit outside the service's cgroup, so it outlives the restart it waits for. */
export function liveCheckUnit(target: LiveCheckTarget, root: string): string[] {
  const command = liveCheckCommand(target, root, liveCheckWaitMs)
  const setenv = Object.entries(command.env).map(([key, value]) => `--setenv=${key}=${value}`)
  return [
    'systemd-run',
    '--user',
    '--no-block',
    '--collect',
    '--quiet',
    '--expand-environment=no',
    `--unit=${liveCheckUnitName(target)}`,
    `--working-directory=${command.cwd}`,
    ...setenv,
    '--property=RuntimeMaxSec=600',
    // The guarded notifier: a rollback target may predate the SIGUSR2 handler.
    `--property=ExecStopPost=-${process.execPath} ${path.join(root, 'bin/promote.ts')} notify`,
    ...command.argv,
  ]
}

/** Clears the target's stale verdict and starts the check unit; returns its name, or null. */
export function launchLiveCheck(
  target: LiveCheckTarget,
  root: string,
  launch: Launch = spawnLauncher,
): string | null {
  rmSync(path.join(target.directory, 'live-check.json'), { force: true })
  if (!launch(liveCheckUnit(target, root))) return null

  return liveCheckUnitName(target)
}

/** The only SIGUSR2 sender: a server without the handler would die of it, so probe first. */
export async function signalServer(
  port = serverPort,
  kill: Launch = spawnLauncher,
): Promise<SignalOutcome> {
  const body = await releaseBody(port)
  if (!body) return 'unreachable'
  if (!('pending' in body)) return 'incapable'

  return kill(['systemctl', '--user', 'kill', '--kill-whom=main', '--signal=SIGUSR2', serverUnit])
    ? 'signalled'
    : 'failed'
}

/** Swaps <root>/pending into <root>/current and starts the post-promotion live check. */
export function promote(root: string, launch: Launch = spawnLauncher): PromoteOutcome {
  const approval = takeApproval(root)
  const pending = path.join(root, 'pending')
  const current = path.join(root, 'current')
  if (!isLink(pending) || !approval) return 'none'
  // Claimed first, so a deploy that restages now cannot swap what was checked for what is moved.
  const claim = path.join(root, `pending.claim-${process.pid}`)
  try {
    renameSync(pending, claim)
  } catch (error) {
    log(`could not claim pending: ${messageOf(error)}`)
    return 'failed'
  }
  if (
    approval.release !== linkTarget(claim) ||
    approval.stagedAt !== lstatSync(claim).mtime.toISOString()
  )
    return unclaim(claim, pending, 'none')

  const problem = releaseProblem(claim)
  if (problem) return drop(claim, 'rejected', `staged ${linkTarget(claim)} is unusable: ${problem}`)
  const next = realpathSync(claim)
  const previous = realpathOrNull(current)
  if (next === previous) return drop(claim, 'already-current', `${path.basename(next)} is current`)

  try {
    // Atomic: the rename replaces the current link in one step.
    renameSync(claim, current)
  } catch (error) {
    log(`could not promote ${path.basename(next)}: ${messageOf(error)}`)
    return unclaim(claim, pending, 'failed')
  }
  log(`current → ${path.basename(next)} (was ${previous ? path.basename(previous) : 'nothing'})`)
  startLiveCheck(next, previous, root, launch)
  return 'promoted'
}

// Puts an unpromoted claim back as pending, unless a newer deploy staged one meanwhile.
function unclaim(claim: string, pending: string, outcome: PromoteOutcome): PromoteOutcome {
  if (isLink(pending)) rmSync(claim, { force: true })
  else renameSync(claim, pending)
  return outcome
}

function takeApproval(root: string) {
  const file = path.join(root, 'restart-approved.json')
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('release' in value) ||
      !('stagedAt' in value)
    )
      return null
    return value
  } catch {
    return null
  } finally {
    rmSync(file, { force: true })
  }
}

function startLiveCheck(directory: string, previous: string | null, root: string, launch: Launch) {
  const config = readConfig(directory)
  if (config?.readiness) return log('identity readiness runs after server activation')
  if (config?.liveCheck === false) return log('live check skipped (--skip-live-check)')
  if (!config?.source) return log(`live check skipped: ${directory} records no source checkout`)

  const target = { name: path.basename(directory), directory, previous, source: config.source }
  const unit = launchLiveCheck(target, root, launch)
  log(unit ? `live check started in ${unit}` : 'live check did not start')
}

function drop(claim: string, outcome: PromoteOutcome, reason: string): PromoteOutcome {
  log(`${reason}; removing pending`)
  rmSync(claim, { force: true })
  return outcome
}

/** The server's GET /release body, or null when it does not answer. */
export async function releaseBody(port = serverPort): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/release`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function spawnLauncher(argv: readonly string[]) {
  const [command, ...args] = argv
  if (!command) return false
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 10_000 })
  if (result.status === 0) return true

  log(`${command} exited ${result.status ?? result.signal ?? result.error?.message}`)
  return false
}

function readConfig(
  directory: string,
): { liveCheck?: boolean; source?: string; readiness?: unknown; previousRelease?: unknown } | null {
  try {
    return JSON.parse(readFileSync(path.join(directory, 'build-config.json'), 'utf8'))
  } catch {
    return null
  }
}

type ReadinessOptions = { recovery?: boolean; isActive?: () => boolean }
const recoverySchema = v.object({
  release: v.string(),
  status: v.picklist(['checking', 'passed', 'failed']),
})
const readinessVerdictSchema = v.object({
  release: v.string(),
  status: v.picklist(['passed', 'failed']),
})

export async function checkCurrentReadiness(
  root: string,
  launch: Launch = spawnLauncher,
  fetcher: typeof fetch = fetch,
  isActive?: () => boolean,
) {
  const directory = currentRelease(root)
  if (!directory) return false
  const config = readConfig(directory)
  if (!config?.readiness) return true
  const recovery = readRecord(path.join(root, 'readiness-recovery.json'), recoverySchema)
  if (recovery?.release === directory) {
    if (recovery.status !== 'checking') return recovery.status === 'passed'
    return checkReadiness(root, directory, null, launch, fetcher, { recovery: true, isActive })
  }
  const verdict = readRecord(path.join(directory, 'live-check.json'), readinessVerdictSchema)
  if (verdict?.release === path.basename(directory) && verdict.status === 'passed') return true
  const previous =
    typeof config.previousRelease === 'string'
      ? path.join(root, 'releases', path.basename(config.previousRelease))
      : null
  return checkReadiness(root, directory, previous, launch, fetcher, { isActive })
}

/** The app checks the same nonce proof as setup, then rolls back only the release it checked. */
export async function checkReadiness(
  root: string,
  directory: string,
  previous: string | null,
  launch: Launch = spawnLauncher,
  fetcher: typeof fetch = fetch,
  options: ReadinessOptions = {},
) {
  const config = readConfig(directory)
  const parsed = v.safeParse(machineServiceIntentSchema, config?.readiness)
  const timeoutMs = (config?.readiness as { timeoutMs?: unknown } | undefined)?.timeoutMs
  if (
    !parsed.success ||
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    return false
  const intent = parsed.output
  const deadline = Date.now() + timeoutMs
  let ready = false
  do {
    if (!activeRelease(root, directory, options)) return false
    const outcome = await probeAddress(
      { ...intent, timeoutMs: Math.max(1, deadline - Date.now()) },
      fetcher,
    )
    if (outcome.kind === 'fregat' && outcome.proven) {
      const identity = outcome.identity
      ready =
        identity.stateHome === intent.stateHome &&
        identity.address === intent.address &&
        identity.webBase === intent.webBase &&
        (!intent.expected || identity.machineId === intent.expected.machineId) &&
        (!intent.expected?.environmentId ||
          identity.environmentId === intent.expected.environmentId)
    }
    if (ready || Date.now() >= deadline) break
    await Bun.sleep(Math.min(100, Math.max(0, deadline - Date.now())))
  } while (Date.now() < deadline)
  if (!activeRelease(root, directory, options)) return false
  const report = {
    release: path.basename(directory),
    status: ready ? 'passed' : 'failed',
    checkedAt: new Date().toISOString(),
    fresh: ready ? [] : ['Server identity readiness failed'],
  }
  writeRecord(path.join(directory, 'live-check.json'), report)
  if (options.recovery) {
    writeRecord(path.join(root, 'readiness-recovery.json'), {
      release: directory,
      status: ready ? 'passed' : 'failed',
    })
    if (!ready) console.error('[promote] identity readiness failed; keeping the previous release')
    return ready
  }
  if (ready) return true
  if (previous) {
    writeRecord(path.join(root, 'readiness-recovery.json'), {
      release: previous,
      status: 'checking',
    })
    pointCurrentAt(root, previous)
    launch(machineRestartCommand())
  } else rmSync(path.join(root, 'current'), { force: true })
  return false
}

function activeRelease(root: string, directory: string, options: ReadinessOptions) {
  return currentRelease(root) === directory && (options.isActive?.() ?? true)
}

function writeRecord(file: string, value: unknown) {
  const staging = `${file}.next-${process.pid}`
  writeFileSync(staging, JSON.stringify(value), { mode: 0o600 })
  renameSync(staging, file)
}

function readRecord<T extends v.GenericSchema>(file: string, schema: T): v.InferOutput<T> | null {
  try {
    const result = v.safeParse(schema, JSON.parse(readFileSync(file, 'utf8')))
    return result.success ? result.output : null
  } catch {
    return null
  }
}

function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function machineRestartCommand() {
  if (process.platform === 'darwin')
    return ['launchctl', 'kickstart', '-k', `gui/${process.getuid!()}/dev.fregat.server`]
  return ['systemctl', '--user', '--no-block', 'restart', 'fregat-server.service']
}

function isLink(file: string) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function linkTarget(link: string) {
  try {
    return path.basename(readlinkSync(link))
  } catch {
    return link
  }
}

function realpathOrNull(file: string) {
  try {
    return realpathSync(file)
  } catch {
    return null
  }
}

function existingPath(file: string) {
  return existsSync(file) ? file : null
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string) {
  console.log(`[promote] ${message}`)
}

async function main(argv: readonly string[]) {
  const [command, root, pid] = argv
  if (command === 'readiness' && root) {
    await checkCurrentReadiness(root, spawnLauncher, fetch, () => processAlive(Number(pid)))
    return
  }
  if (command === 'notify') return log(`notify: ${await signalServer()}`)
  if (!command) return log('usage: promote.ts <production root> | notify')

  log(`promote: ${promote(command)}`)
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    log(`unexpected: ${messageOf(error)}`)
  }
  process.exit(0)
}
