// Installed at <production root>/bin/promote.ts and run by the unit's ExecStartPre, so it
// imports nothing from the checkout, never throws, and always exits 0.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

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
  if (
    approval.release !== linkTarget(pending) ||
    approval.stagedAt !== lstatSync(pending).mtime.toISOString()
  )
    return 'none'

  const problem = releaseProblem(pending)
  if (problem)
    return drop(pending, 'rejected', `staged ${linkTarget(pending)} is unusable: ${problem}`)
  const next = realpathSync(pending)
  const previous = realpathOrNull(current)
  if (next === previous)
    return drop(pending, 'already-current', `${path.basename(next)} is current`)

  try {
    // Atomic: the rename replaces the current link in one step.
    renameSync(pending, current)
  } catch (error) {
    log(`could not promote ${path.basename(next)}: ${messageOf(error)}`)
    return 'failed'
  }
  log(`current → ${path.basename(next)} (was ${previous ? path.basename(previous) : 'nothing'})`)
  startLiveCheck(next, previous, root, launch)
  return 'promoted'
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
  if (config?.liveCheck === false) return log('live check skipped (--skip-live-check)')
  if (!config?.source) return log(`live check skipped: ${directory} records no source checkout`)

  const target = { name: path.basename(directory), directory, previous, source: config.source }
  const unit = launchLiveCheck(target, root, launch)
  log(unit ? `live check started in ${unit}` : 'live check did not start')
}

function drop(pending: string, outcome: PromoteOutcome, reason: string): PromoteOutcome {
  log(`${reason}; removing pending`)
  rmSync(pending, { force: true })
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

function readConfig(directory: string): { liveCheck?: boolean; source?: string } | null {
  try {
    return JSON.parse(readFileSync(path.join(directory, 'build-config.json'), 'utf8'))
  } catch {
    return null
  }
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
  const [command] = argv
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
