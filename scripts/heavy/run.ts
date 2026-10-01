#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptFailureText } from '../structured-errors'
import { HOSTS, isHost, startJob, type Host, type JobOutcome } from './job'
import { acquireSlot, unlock } from './lock'
import { appendRecord, redactCommand, type HeavyJobRecord } from './record'

const USAGE =
  'Usage: bun /work/platform-production/heavy/current/run.js [--host local|pi] [--log-dir <dir>] [--lock-dir <dir>] <label> -- <command…>'
// Shared with tools that take the slot locks directly: holding all three keeps the machine quiet.
const LEGACY_LOCK_DIR = '/work/tmp/wave-heavy'

type Options = {
  readonly host: Host
  readonly label: string
  readonly command: readonly string[]
  readonly logDir: string | null
  readonly lockDir: string
}

try {
  process.exit(await run(parseOptions(Bun.argv.slice(2))))
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>()
  let index = 0
  while (argv[index]?.startsWith('--') && argv[index] !== '--') {
    const flag = argv[index]!
    const value = argv[index + 1]
    if (!['--host', '--log-dir', '--lock-dir'].includes(flag) || value === undefined) {
      throw createScriptError(`Unknown or incomplete option ${flag}. ${USAGE}`)
    }
    flags.set(flag, value)
    index += 2
  }
  const label = argv[index]
  const command = argv.slice(argv[index + 1] === '--' ? index + 2 : index + 1)
  if (!label || command.length === 0) throw createScriptError(USAGE)

  const host = flags.get('--host') ?? 'local'
  if (!isHost(host)) {
    throw createScriptError(`Unknown host ${host}. Hosts: ${HOSTS.join(', ')}.`)
  }
  return {
    command,
    host,
    label,
    lockDir: flags.get('--lock-dir') ?? LEGACY_LOCK_DIR,
    logDir: flags.get('--log-dir') ?? null,
  }
}

async function run(options: Options) {
  const queuedAt = performance.now()
  const { fd, slot, holder } = await acquireSlot(options.lockDir, options.host)
  const queuedMs = Math.round(performance.now() - queuedAt)
  const cwd = process.cwd()
  const since = new Date().toTimeString().slice(0, 8)
  writeFileSync(holder, `${options.label} pid=${process.pid} since=${since} cwd=${cwd}\n`)
  console.error(
    `[wave-heavy] slot ${slot} acquired for '${options.label}' after ${Math.round(queuedMs / 1000)}s`,
  )

  const id = randomBytes(6).toString('hex')
  const job = startJob({ command: options.command, cwd, host: options.host, id })
  // A signal to this PID alone reaches the job only through its scope. A terminal's Ctrl-C
  // also reaches it directly, so it sees SIGINT twice; one is enough to stop it.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => job.stop(signal))
  }
  const outcome = await job.done
  record(options, { cwd, id, outcome, queuedMs, slot })
  clearHolder(holder)
  unlock(fd)
  return outcome.exitCode
}

// The job's exit status is the wrapper's; failing to clear a status line must not replace it.
function clearHolder(holder: string) {
  try {
    writeFileSync(holder, '')
  } catch (error) {
    console.error(`[wave-heavy] could not clear ${holder}: ${scriptFailureText(error)}`)
  }
}

// An installed copy has no checkout around it; install.ts writes its commit beside the bundle.
function wrapperCommit() {
  const installed = readText(path.join(import.meta.dirname, 'commit')).trim()
  if (installed) return installed
  return Bun.spawnSync(['git', '-C', import.meta.dirname, 'rev-parse', 'HEAD'])
    .stdout.toString()
    .trim()
}

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

type Finished = {
  readonly cwd: string
  readonly id: string
  readonly outcome: JobOutcome
  readonly queuedMs: number
  readonly slot: number
}

// Logging is best effort: a settings, git or disk failure is reported, and the job's exit
// status still becomes the wrapper's.
function record(options: Options, finished: Finished) {
  try {
    const logDir =
      options.logDir ?? readHomeSetting(productionStateHome, 'developer.heavyJobLogDirectory')
    appendRecord(logDir, jobRecord(options, finished))
  } catch (error) {
    console.error('[wave-heavy] the job ran but its record was not written:')
    console.error(scriptFailureText(error))
  }
}

function jobRecord(
  options: Options,
  { cwd, id, outcome, queuedMs, slot }: Finished,
): HeavyJobRecord {
  const commitHash = wrapperCommit()
  return {
    action: 'heavy.job',
    area: 'heavy-jobs',
    command: redactCommand(options.command),
    commitHash,
    cpuUsageUsec: outcome.cpuUsageUsec,
    cwd,
    exitCode: outcome.exitCode,
    host: options.host,
    label: options.label,
    leftoverProcesses: outcome.leftoverProcesses,
    level: outcome.oomKills ? 'warn' : 'info',
    memoryPeakBytes: outcome.memoryPeakBytes,
    oomKills: outcome.oomKills,
    queuedMs,
    requestId: id,
    slot,
    source: 'heavy',
    timestamp: new Date().toISOString(),
    unit: outcome.unit,
    version: commitHash.slice(0, 9),
    wallMs: outcome.wallMs,
    ...repositoryOf(cwd),
  }
}

// Worktrees of one repository share its common git directory, so lanes group together.
function repositoryOf(cwd: string) {
  const result = Bun.spawnSync(
    ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-prefix'],
    { stderr: 'ignore', stdout: 'pipe' },
  )
  if (result.exitCode !== 0) return { repo: null, subdir: null }
  const [commonDir = '', prefix = ''] = result.stdout.toString().split('\n')
  return { repo: commonDir.replace(/\/\.git\/?$/, ''), subdir: prefix.replace(/\/$/, '') }
}
