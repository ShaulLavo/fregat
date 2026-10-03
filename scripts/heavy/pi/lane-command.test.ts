import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
// `ready`: heartbeats until the job writes $LANE_RUN/ready, then closed.
type Stdin = 'heartbeat' | 'closed' | 'silent' | 'ready'

// Bun can report a broken pipe before its exit notification; ps also identifies an unreaped child.
function childHasExited(child: Pick<Bun.Subprocess, 'exitCode' | 'signalCode' | 'pid'>) {
  if (child.exitCode !== null || child.signalCode) return true
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return false
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(child.pid)], { timeout: 1_000 })
  if (state.error || state.signal || state.stderr.length > 0) return false
  if (state.status === 1 && state.stdout.length === 0) return true
  return state.status === 0 && state.stdout.toString().trim().startsWith('Z')
}

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
  const run = laneRunDirectory(job)
  let open = true
  let beat: ReturnType<typeof setInterval> | undefined
  let closing: Promise<void> | undefined
  const pending: Promise<void>[] = []
  const failures: unknown[] = []
  const complete = async (operation: () => number | Promise<number>) => {
    try {
      await operation()
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EPIPE' &&
        childHasExited(child)
      )
        return
      failures.push(error)
      void close()
    }
  }
  function close() {
    if (closing) return closing
    open = false
    clearInterval(beat)
    // End cannot race a buffered flush, and every sink rejection is owned before the test returns.
    closing = Promise.all(pending).then(() => complete(() => child.stdin.end()))
    return closing
  }
  if (stdin === 'heartbeat' || stdin === 'ready') {
    beat = setInterval(() => {
      if (stdin === 'ready' && existsSync(path.join(run, 'ready'))) return void close()
      if (!open) return
      pending.push(
        complete(() => {
          child.stdin.write('\n')
          return child.stdin.flush()
        }),
      )
    }, 50)
  }
  if (stdin === 'closed') void close()
  const status = await child.exited
  const ms = performance.now() - started
  await close()
  if (failures.length > 0) throw failures[0]
  const file = path.join(run, 'lane.json')
  const lane = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Lane) : null
  const unit = laneUnit(job.name)
  return { status, lane, run, ms, unit, stderr: await new Response(child.stderr).text() }
}

const laneTools = process.platform !== 'win32' && Boolean(Bun.which('bash') && Bun.which('ps'))

test.skipIf(!laneTools).for([true, false])(
  'classifies a real broken pipe before Bun observes exit, kernel-exited=%s (requires POSIX bash and ps)',
  async (dead) => {
    vi.useFakeTimers()
    const spawn = Bun.spawn.bind(Bun)
    let child: ReturnType<typeof Bun.spawn<'pipe', 'ignore', 'pipe'>> | undefined
    const root = mkdtempSync(path.join(tmpdir(), 'lane-pipe-'))
    roots.push(root)
    const ready = path.join(root, 'ready')
    const events: string[] = []
    vi.spyOn(Bun, 'spawn').mockImplementationOnce(() => {
      child = spawn(
        ['bash', '-c', dead ? 'exit 0' : 'exec 0<&-; touch "$1"; exec sleep 30', 'fixture', ready],
        {
          stdin: 'pipe',
          stdout: 'ignore',
          stderr: 'pipe',
          onExit: () => {
            events.push('exit')
          },
        },
      )
      const input = child.stdin
      const write = input.write.bind(input)
      const flush = input.flush.bind(input)
      const end = input.end.bind(input)
      vi.spyOn(input, 'write').mockImplementation((data) => {
        events.push('write:start')
        return write(data)
      })
      vi.spyOn(input, 'flush').mockImplementation(() => {
        events.push('flush:start')
        return flush()
      })
      vi.spyOn(input, 'end').mockImplementation(() => {
        events.push('end:start')
        return end()
      })
      return child
    })
    const running = runLane('exit-observation', 'true')
    const settled = running.then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      expect(child).toBeDefined()
      const observed = spawnSync(
        'bash',
        [
          '-c',
          dead
            ? 'for ((i=0; i<100; i++)); do state=$(ps -o stat= -p "$1"); [[ -z "$state" || "$state" == *Z* ]] && exit 0; sleep 0.01; done; exit 1'
            : 'for ((i=0; i<100; i++)); do [[ -f "$2" ]] && exit 0; sleep 0.01; done; exit 1',
          'probe',
          String(child!.pid),
          ready,
        ],
        { timeout: 2_000 },
      )
      expect(observed.status).toBe(0)
      expect(child!.exitCode).toBeNull()
      const state = spawnSync('ps', ['-o', 'stat=', '-p', String(child!.pid)])
        .stdout.toString()
        .trim()
      events.push(`kernel:${state || 'gone'}`)
      vi.advanceTimersByTime(50)
      expect(events).toContain('write:start')
      if (!dead) child!.kill('SIGKILL')
      const failure = await settled
      expect(failure, JSON.stringify({ dead, events, exitCode: child!.exitCode })).toEqual(
        dead ? undefined : expect.objectContaining({ code: 'EPIPE' }),
      )
      expect(await child!.exited).toBe(dead ? 0 : 137)
      expect(events).toContain('end:start')
    } finally {
      child?.kill('SIGKILL')
      await settled
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  },
)

test('awaits heartbeat flush before ending stdin and awaits end before returning', async () => {
  vi.useFakeTimers()
  const exited = Promise.withResolvers<number>()
  const flushed = Promise.withResolvers<number>()
  const ended = Promise.withResolvers<number>()
  const child = {
    exitCode: null as number | null,
    exited: exited.promise,
    stdin: {
      write: vi.fn(() => 1),
      flush: vi.fn(() => flushed.promise),
      end: vi.fn(() => ended.promise),
    },
    stderr: new ReadableStream({ start: (controller) => controller.close() }),
  }
  vi.spyOn(Bun, 'spawn').mockReturnValue(child as unknown as ReturnType<typeof Bun.spawn>)
  let settled = false
  const running = runLane('completion', 'true').then(() => {
    settled = true
  })
  try {
    await vi.advanceTimersByTimeAsync(50)
    expect(child.stdin.flush).toHaveBeenCalledTimes(1)
    child.exitCode = 0
    exited.resolve(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(child.stdin.end).not.toHaveBeenCalled()
    expect(settled).toBe(false)
    flushed.resolve(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(child.stdin.end).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(child.stdin.write).toHaveBeenCalledTimes(1)
    ended.resolve(0)
    await running
    expect(settled).toBe(true)
  } finally {
    flushed.resolve(1)
    ended.resolve(0)
    exited.resolve(0)
    try {
      await running
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  }
})

test.for([
  { sink: 'flush', code: 'EPIPE', closed: true, synchronous: false },
  { sink: 'end', code: 'EPIPE', closed: true, synchronous: false },
  { sink: 'flush', code: 'EPIPE', closed: false, synchronous: false },
  { sink: 'flush', code: 'EIO', closed: true, synchronous: false },
  { sink: 'end', code: 'EIO', closed: true, synchronous: false },
  { sink: 'write', code: 'EPIPE', closed: false, synchronous: true },
  { sink: 'flush', code: 'EIO', closed: false, synchronous: true },
  { sink: 'end', code: 'EIO', closed: true, synchronous: true },
])(
  'owns $sink $code errors with child closed=$closed, synchronous=$synchronous',
  async ({ sink, code, closed, synchronous }) => {
    vi.useFakeTimers()
    const exited = Promise.withResolvers<number>()
    const operation = Promise.withResolvers<number>()
    const error = { code }
    const child = {
      exitCode: null as number | null,
      exited: exited.promise,
      stdin: {
        write: vi.fn(() => {
          if (sink === 'write') throw error
          return 1
        }),
        flush: vi.fn(() => {
          if (sink !== 'flush') return 1
          if (synchronous) throw error
          return operation.promise
        }),
        end: vi.fn(() => {
          if (sink !== 'end') return 0
          if (synchronous) throw error
          return operation.promise
        }),
      },
      stderr: new ReadableStream({ start: (controller) => controller.close() }),
    }
    vi.spyOn(Bun, 'spawn').mockReturnValue(child as unknown as ReturnType<typeof Bun.spawn>)
    let failure: unknown
    const running = runLane('errors', 'true').catch((error) => {
      failure = error
    })
    try {
      await vi.advanceTimersByTimeAsync(50)
      if (closed) {
        child.exitCode = 0
        exited.resolve(0)
        await vi.advanceTimersByTimeAsync(0)
      }
      if (!synchronous) operation.reject(error)
      await vi.advanceTimersByTimeAsync(0)
      child.exitCode = 0
      exited.resolve(0)
      await running
      expect(failure).toBe(code === 'EPIPE' && closed ? undefined : error)
      expect(child.stdin.end).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(child.stdin.write).toHaveBeenCalledTimes(1)
    } finally {
      operation.resolve(0)
      exited.resolve(0)
      try {
        await running
      } finally {
        vi.restoreAllMocks()
        vi.useRealTimers()
      }
    }
  },
)

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

// The local lane integration requires systemd user scopes, bash and ps.
describe.skipIf(!userScopes || !laneTools)('a lane job', () => {
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

  test('hands the command to bash as written, with no expansion by systemd-run', async () => {
    const { lane, run, unit } = await runLane(
      'verbatim',
      'printf %s "${HEAVY_JOB_SLICE%.slice} $((6 * 7))" > "$LANE_RUN/verbatim"',
    )
    expect(lane?.exitCode).toBe(0)
    expect(readFileSync(path.join(run, 'verbatim'), 'utf8')).toBe(`${unit} 42`)
  })

  test('runs the job scope under OOMPolicy=continue, so job.sh outlives an OOM', async () => {
    const { lane, run } = await runLane(
      'oom-policy',
      'systemctl --user show -p OOMPolicy --value "${HEAVY_JOB_SLICE%.slice}.scope" > "$LANE_RUN/oom-policy"',
    )
    expect(lane?.exitCode).toBe(0)
    expect(readFileSync(path.join(run, 'oom-policy'), 'utf8').trim()).toBe('continue')
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
    const { status, ms, unit } = await runLane('ceiling', 'sleep 30', {
      limits: { maxWallSec: 2 },
    })
    expect(ms).toBeLessThan(10_000)
    expect(status).not.toBe(0)
    expect(unloaded(unit)).toBe(true)
  }, 40_000)

  test('kills a job that ignores TERM once the grace period ends', async () => {
    // The lease closes only once the trap is set: a TERM before it would end the job unaided.
    const command = 'trap "" TERM; touch "$LANE_RUN/ready"; sleep 30'
    const { ms, unit, stderr } = await runLane('stubborn', command, {
      stdin: 'ready',
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
