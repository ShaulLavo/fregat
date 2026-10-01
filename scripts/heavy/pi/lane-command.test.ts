import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { laneJobCommand, laneRunDirectory, laneUnit, type LaneLimits } from './lane-command'

const MiB = 2 ** 20
const checkout = path.resolve(import.meta.dirname, '../../..')
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const roots: string[] = []
const LIMITS: LaneLimits = { maxWallSec: 60, leaseSec: 5, graceSec: 2 }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

type Lane = {
  exitCode: number
  memoryPeakBytes: number | null
  oomKills: number | null
  slice: string
}
type Stdin = 'heartbeat' | 'closed' | 'silent'

// The same shell the Pi runs, run here; the lane root's platform/ is this checkout. stdin plays
// the lane's controlling connection: heartbeat lines, closed at once, or open and quiet.
async function runLane(
  name: string,
  command: string,
  options: {
    memoryMax?: string
    directory?: string
    stdin?: Stdin
    limits?: Partial<LaneLimits>
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), 'lane-command-'))
  roots.push(root)
  symlinkSync(checkout, path.join(root, 'platform'))
  const job = {
    ...LIMITS,
    ...options.limits,
    root,
    name: `${name}-${process.pid}`,
    memoryMax: options.memoryMax ?? '1G',
    command,
    directory: options.directory,
  }
  const started = performance.now()
  const child = Bun.spawn(['bash', '-c', laneJobCommand(job)], {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const stdin = options.stdin ?? 'heartbeat'
  const beat =
    stdin === 'heartbeat'
      ? setInterval(() => {
          child.stdin.write('\n')
          void child.stdin.flush()
        }, 200)
      : undefined
  if (stdin === 'closed') void child.stdin.end()
  const status = await child.exited
  const ms = performance.now() - started
  clearInterval(beat)
  if (stdin !== 'closed') void child.stdin.end()
  const run = laneRunDirectory(job)
  const file = path.join(run, 'lane.json')
  const lane = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Lane) : null
  const unit = laneUnit(job.name)
  return { status, lane, run, ms, unit, stderr: await new Response(child.stderr).text() }
}

// list-units, not show: show loads the unit it is asked about.
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

const controlDir = `/run/user/${process.getuid?.()}/systemd/user.control`

// Nothing left: no slice, no ceiling timer or its service, no runtime drop-in for the slice.
function unloaded(unit: string) {
  return (
    !loaded(`${unit}.slice`) &&
    !loaded(`${unit}_ceiling.timer`) &&
    !loaded(`${unit}_ceiling.service`) &&
    !existsSync(path.join(controlDir, `${unit}.slice.d`))
  )
}

// A bench case: its own scope, joined to the job's slice the way bench.ts joins it.
const caseScope = (mib: number) =>
  `systemd-run --user --scope --quiet --slice="$HEAVY_JOB_SLICE" bun -e 'Buffer.alloc(${mib} * 2 ** 20, 1)'`

describe.skipIf(!userScopes)('a lane job', () => {
  test('counts the memory of case scopes that join its slice, then unloads it', async () => {
    const { status, lane, unit } = await runLane('counts', caseScope(300))
    expect(status).toBe(0)
    expect(lane?.exitCode).toBe(0)
    expect(lane?.memoryPeakBytes).toBeGreaterThanOrEqual(300 * MiB)
    expect(lane?.slice).toBe(`${unit}.slice`)
    expect(unloaded(unit)).toBe(true)
  })

  test('caps case scopes that join its slice, and unloads it with the killed member', async () => {
    const { status, lane, unit } = await runLane('caps', caseScope(400), { memoryMax: '200M' })
    expect(status).not.toBe(0)
    expect(lane?.oomKills).toBeGreaterThanOrEqual(1)
    expect(lane?.memoryPeakBytes).toBeLessThanOrEqual(200 * MiB)
    expect(unloaded(unit)).toBe(true)
  })

  test('starts in the caller directory and writes evidence into the run directory', async () => {
    const { lane, run } = await runLane(
      'directory',
      'pwd > "$LANE_RUN/pwd"; printf %s "$FREGAT_EVIDENCE_ROOT" > "$LANE_RUN/evidence-root"',
      { directory: 'scripts/heavy/' },
    )
    expect(lane?.exitCode).toBe(0)
    expect(readFileSync(path.join(run, 'pwd'), 'utf8').trim()).toMatch(
      /\/platform\/scripts\/heavy$/,
    )
    expect(readFileSync(path.join(run, 'evidence-root'), 'utf8')).toBe(run)
  })

  test('stops the job when its controlling connection closes', async () => {
    const { status, ms, unit, stderr } = await runLane('closed', 'sleep 30', { stdin: 'closed' })
    expect(ms).toBeLessThan(10_000)
    expect(status).not.toBe(0)
    expect(stderr).toContain('controlling connection closed or went quiet')
    expect(unloaded(unit)).toBe(true)
  }, 40_000)

  test('stops the job when the connection goes quiet past the lease', async () => {
    const { ms, unit } = await runLane('quiet', 'sleep 30', {
      stdin: 'silent',
      limits: { leaseSec: 1 },
    })
    expect(ms).toBeLessThan(8_000)
    expect(unloaded(unit)).toBe(true)
  }, 40_000)

  test('stops the job at its wall-clock ceiling while the connection is healthy', async () => {
    const { status, ms, unit } = await runLane('ceiling', 'sleep 30', { limits: { maxWallSec: 2 } })
    expect(ms).toBeLessThan(10_000)
    expect(status).not.toBe(0)
    expect(unloaded(unit)).toBe(true)
  }, 40_000)

  test('kills a job that ignores TERM once the grace period ends', async () => {
    const { ms, unit, stderr } = await runLane('stubborn', 'trap "" TERM; sleep 30', {
      stdin: 'closed',
      limits: { graceSec: 1 },
    })
    expect(stderr).toContain('sending KILL')
    expect(ms).toBeLessThan(10_000)
    expect(unloaded(unit)).toBe(true)
  }, 40_000)
})

test('quotes data arguments and refuses a directory outside the checkout', () => {
  const job = { ...LIMITS, root: "/home/pi/a'b", name: 'n', memoryMax: '1G', command: 'true' }
  expect(laneJobCommand(job)).toContain(`'/home/pi/a'\\''b/platform'`)
  expect(() => laneJobCommand({ ...job, directory: '../..' })).toThrow(/leaves the checkout/)
  expect(() => laneJobCommand({ ...job, directory: 'scripts/../..' })).toThrow(
    /leaves the checkout/,
  )
  expect(() => laneJobCommand({ ...job, maxWallSec: 0 })).toThrow(/positive whole number/)
})
