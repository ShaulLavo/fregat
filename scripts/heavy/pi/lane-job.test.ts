import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { readAccounting } from '../job'
import { laneRunDirectory, laneUnit } from './lane-command'
import {
  accountingText,
  LANE_ABANDONED,
  laneRunName,
  parseLaneTotals,
  runOnLane,
  type LaneTransport,
} from './lane-job'

const checkout = path.resolve(import.meta.dirname, '../../..')
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function scratch(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const totals = {
  host: 'pi',
  model: 'Raspberry Pi 4 Model B Rev 1.2',
  arch: 'aarch64',
  cpus: 4,
  slice: 'lane_x.slice',
  memoryMax: '3G',
  exitCode: 0,
  wallMs: 82460,
  memoryPeakBytes: 934903808,
  cpuUsageUsec: 201308282,
  oomKills: 0,
}

describe('lane totals', () => {
  test('accepts exactly what job.sh writes', () => {
    expect(parseLaneTotals(JSON.stringify(totals))).toEqual(totals)
    expect(
      parseLaneTotals(JSON.stringify({ ...totals, memoryPeakBytes: null }))?.memoryPeakBytes,
    ).toBeNull()
  })

  test.each([
    ['a line break smuggled into a metric', { memoryPeakBytes: '10\ncpu 999\noom 8\nleft 321' }],
    ['a number as text', { cpuUsageUsec: '201308282' }],
    ['a negative count', { oomKills: -1 }],
    ['a fraction', { memoryPeakBytes: 1.5 }],
    ['an unsafe integer', { memoryPeakBytes: 2 ** 60 }],
    ['an array', { cpuUsageUsec: [1] }],
    ['an exit code out of range', { exitCode: 256 }],
    ['an extra key', { left: 3 }],
    ['a line break in text', { host: 'pi\npeak 1' }],
  ])('rejects %s', (_, change) => {
    expect(parseLaneTotals(JSON.stringify({ ...totals, ...change }))).toBeNull()
  })

  test('rejects a missing key and text that is not JSON', () => {
    const { oomKills: _, ...missing } = totals
    expect(parseLaneTotals(JSON.stringify(missing))).toBeNull()
    expect(parseLaneTotals('{"host":')).toBeNull()
    expect(parseLaneTotals('[]')).toBeNull()
  })
})

function readBack(text: string) {
  const file = path.join(scratch('lane-accounting-'), 'accounting')
  writeFileSync(file, text)
  return readAccounting(file)
}

test('the wrapper reads a lane job slice totals as it reads a local scope', () => {
  expect(readBack(accountingText(totals, 0))).toEqual({
    cpuUsageUsec: 201308282,
    leftoverProcesses: null,
    memoryPeakBytes: 934903808,
    oomKills: 0,
  })
  expect(readBack(accountingText(null, 74))).toEqual({
    cpuUsageUsec: null,
    leftoverProcesses: null,
    memoryPeakBytes: null,
    oomKills: null,
  })
})

test('run names stay unique and slice-safe', () => {
  const a = laneRunName('heavy-1a2b')
  expect(a).toMatch(/^\d{8}t\d{6}-heavy-1a2b-[0-9a-f]{6}$/)
  expect(laneRunName('heavy-1a2b')).not.toBe(a)
  expect(laneRunName('Big File!')).toMatch(/-big-file--[0-9a-f]{6}$/)
})

// The lane host is this machine: bash instead of ssh, plain paths instead of host:path.
const local: LaneTransport = { shell: (script) => ['bash', '-c', script], path: (file) => file }

function laneRun(name: string, command: string, graceSec = 2) {
  const root = scratch('lane-job-')
  symlinkSync(checkout, path.join(root, 'platform'))
  return {
    root,
    host: 'local',
    name: `${name}-${process.pid}`,
    memoryMax: '1G',
    command,
    maxWallSec: 60,
    leaseSec: 5,
    graceSec,
    evidence: path.join(root, 'evidence'),
  }
}

function loaded(unit: string) {
  const list = spawnSync('systemctl', [
    '--user',
    'list-units',
    '--all',
    '--no-legend',
    '--plain',
    unit,
  ])
  return list.stdout.toString().trim() !== ''
}

const options = { transport: local, heartbeatMs: 200, confirmDelayMs: 10 }

describe.skipIf(!userScopes)('a lane run', () => {
  test('resolves with the job exit and totals once its slice is gone', async () => {
    const job = laneRun('done', 'exit 3')
    const outcome = await runOnLane(job, options)
    expect(outcome).toMatchObject({ exitCode: 3, started: true, abandoned: false })
    expect(outcome.totals?.exitCode).toBe(3)
    expect(loaded(`${laneUnit(job.name)}.slice`)).toBe(false)
  })

  test('never starts a job cancelled before it starts', async () => {
    const job = laneRun('early', 'touch "$LANE_RUN/ran"')
    const cancel = new AbortController()
    cancel.abort('SIGTERM')
    const outcome = await runOnLane(job, { ...options, signal: cancel.signal })
    expect(outcome).toMatchObject({ exitCode: 143, started: false })
    expect(existsSync(laneRunDirectory(job))).toBe(false)
  })

  // The signal lands while the process is busy in synchronous work, as during syncLane; its
  // handler only runs once the event loop turns, which must happen before the job starts.
  test('never starts a job whose cancel signal arrived during synchronous work', () => {
    const job = laneRun('queued', 'touch "$LANE_RUN/ran"')
    const program = `
      import { runOnLane } from ${JSON.stringify(path.join(import.meta.dirname, 'lane-job.ts'))}
      const cancel = new AbortController()
      process.on('SIGUSR2', () => cancel.abort('SIGTERM'))
      Bun.spawnSync(['kill', '-USR2', String(process.pid)])
      Bun.spawnSync(['sleep', '0.2'])
      const transport = { shell: (s) => ['bash', '-c', s], path: (f) => f }
      const outcome = await runOnLane(${JSON.stringify(job)}, { transport, signal: cancel.signal, heartbeatMs: 200 })
      console.log(JSON.stringify(outcome))
    `
    const child = spawnSync('bun', ['-e', program], { encoding: 'utf8' })
    expect(JSON.parse(child.stdout.trim().split('\n').at(-1)!)).toMatchObject({
      started: false,
      exitCode: 143,
    })
    expect(existsSync(laneRunDirectory(job))).toBe(false)
  }, 40_000)

  test('stops a job cancelled while it starts up', async () => {
    const job = laneRun('starting', 'sleep 30')
    const cancel = new AbortController()
    setTimeout(() => cancel.abort('SIGINT'), 20)
    const started = performance.now()
    const outcome = await runOnLane(job, { ...options, signal: cancel.signal })
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(outcome).toMatchObject({ exitCode: 130, started: true, abandoned: false })
    expect(loaded(`${laneUnit(job.name)}.slice`)).toBe(false)
  }, 40_000)

  test('kills a cancelled job that ignores TERM, within the grace period', async () => {
    const job = laneRun('stubborn', 'trap "" TERM; sleep 30', 1)
    const cancel = new AbortController()
    setTimeout(() => cancel.abort('SIGTERM'), 1_000)
    const started = performance.now()
    const outcome = await runOnLane(job, { ...options, signal: cancel.signal })
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(outcome).toMatchObject({ exitCode: 143, abandoned: false })
    expect(loaded(`${laneUnit(job.name)}.slice`)).toBe(false)
  }, 40_000)

  test('reports the job abandoned when its stop cannot be confirmed', async () => {
    const job = laneRun('unconfirmed', 'true')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The job runs; every control command after it fails, as over a lost connection.
    const broken: LaneTransport = {
      ...local,
      shell: (script) => (script.includes('HEAVY_JOB_SLICE') ? local.shell(script) : ['false']),
    }
    const outcome = await runOnLane(job, { ...options, transport: broken, confirmAttempts: 2 })
    expect(outcome).toMatchObject({ exitCode: LANE_ABANDONED, abandoned: true })
    expect(existsSync(path.join(job.evidence, 'abandoned.json'))).toBe(true)
    expect(errors.mock.calls.flat().join('\n')).toContain('ABANDONED')
  })
})
