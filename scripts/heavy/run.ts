#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptFailureText } from '../structured-errors'
import { HOSTS, isHost, startJob, type Host, type JobOutcome } from './job'
import { tryLock, unlock } from './lock'
import { appendRecord, redactCommand } from './record'

const USAGE =
  'Usage: bun scripts/heavy/run.ts [--host local] [--log-dir <dir>] [--lock-dir <dir>] <label> -- <command…>'
// Shared with tools that take the slot locks directly: holding all three keeps the machine quiet.
const LEGACY_LOCK_DIR = '/work/tmp/wave-heavy'
const SLOTS = [1, 2, 3] as const
const POLL_MS = 5_000
const WAIT_NOTICE_MS = 60_000

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
  const { fd, slot } = await acquireSlot(options.lockDir)
  const queuedMs = Math.round(performance.now() - queuedAt)
  const holder = path.join(options.lockDir, `slot${slot}.holder`)
  const cwd = process.cwd()
  const since = new Date().toTimeString().slice(0, 8)
  writeFileSync(holder, `${options.label} pid=${process.pid} since=${since} cwd=${cwd}\n`)
  console.error(
    `[wave-heavy] slot ${slot} acquired for '${options.label}' after ${Math.round(queuedMs / 1000)}s`,
  )

  const id = randomBytes(6).toString('hex')
  const job = startJob({ command: options.command, cwd, host: options.host, id })
  // Ctrl-C already reaches the job through the terminal's process group; wait for it to exit.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => job.stop('SIGTERM'))
  process.on('SIGHUP', () => job.stop('SIGHUP'))
  try {
    const outcome = await job.done
    record(options, { cwd, id, outcome, queuedMs, slot })
    return outcome.exitCode
  } finally {
    writeFileSync(holder, '')
    unlock(fd)
  }
}

async function acquireSlot(lockDir: string) {
  mkdirSync(lockDir, { recursive: true })
  const started = Date.now()
  let nextNotice = 0
  for (;;) {
    for (const slot of SLOTS) {
      const fd = tryLock(path.join(lockDir, `slot${slot}.lock`))
      if (fd !== null) return { fd, slot }
    }
    if (Date.now() - started >= nextNotice) {
      console.error(`[wave-heavy] all 3 slots busy, waiting: ${holders(lockDir)}`)
      nextNotice += WAIT_NOTICE_MS
    }
    await Bun.sleep(POLL_MS)
  }
}

function holders(lockDir: string) {
  return SLOTS.map((slot) => readText(path.join(lockDir, `slot${slot}.holder`)).trim()).join(';')
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

function record(options: Options, { cwd, id, outcome, queuedMs, slot }: Finished) {
  const logDir =
    options.logDir ?? readHomeSetting(productionStateHome, 'developer.heavyJobLogDirectory')
  const commitHash = Bun.spawnSync(['git', '-C', import.meta.dirname, 'rev-parse', 'HEAD'])
    .stdout.toString()
    .trim()
  try {
    appendRecord(logDir, {
      action: 'heavy.job',
      area: 'heavy-jobs',
      command: redactCommand(options.command),
      commitHash,
      cwd,
      cpuUsageUsec: outcome.cpuUsageUsec,
      exitCode: outcome.exitCode,
      host: options.host,
      label: options.label,
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
    })
  } catch (error) {
    console.error(`[wave-heavy] the job ran but its record was not written to ${logDir}:`)
    console.error(scriptFailureText(error))
  }
}
