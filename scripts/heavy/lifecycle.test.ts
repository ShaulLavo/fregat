import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { liveSlices, sliceMemory } from './admission'
import { reapSlice } from './job'
import { sliceRootFor, tryLock, unlock } from './lock'
import { enqueue, live, release } from './queue'
import {
  alive,
  type Box,
  heavy,
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  unitActive,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

afterEach(() => {
  vi.restoreAllMocks()
  removeSandboxes()
})

const SLOTS = ['slot1.lock', 'slot2.lock', 'slot3.lock']
const light = { ceilingMiB: 1024, estimateMiB: 512 }
const classes = { bench: light, browser: light, build: light, light, suite: light }

function lifecycleBox(availableMiB: number, graceSeconds = 10) {
  const box = sandbox()
  writeMachine(box, { availableMiB })
  writeSettings(box, {
    'developer.heavyJobClasses': classes,
    'developer.heavyJobMemoryReserveMiB': 0,
    'developer.heavyJobStopGraceSeconds': graceSeconds,
  })
  return box
}

function exclusiveSlotFree(box: Box) {
  const fds = SLOTS.map((slot) => tryLock(path.join(box.state, slot)))
  for (const fd of fds) if (fd !== null) unlock(fd)
  return fds.every((fd) => fd !== null)
}

function dropIns(box: Box) {
  const dir = `/run/user/${process.getuid?.()}/systemd/user.control`
  return readdirSync(dir).filter((name) => name.startsWith(`${box.sliceRoot}-`))
}

const job = { cwd: '/', estimateBytes: 1, jobClass: 'light', label: 'x', pid: process.pid }

describe('the queue', () => {
  test('keeps arrival order when the clock ties or runs backward', () => {
    const box = sandbox()
    const now = vi.spyOn(Date, 'now')
    const held = ['a', 'b', 'c', 'd'].map((id, index) => {
      now.mockReturnValue([5_000, 5_000, 1_000, 1_000][index]!)
      return enqueue(box.state, { ...job, id, since: '' })
    })
    expect(live(box.state, 'queue').map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd'])
    for (const entry of held) release(entry)
  })

  test('a scan never fails on an entry its owner releases mid-read', async () => {
    const box = sandbox()
    mkdirSync(path.join(box.state, 'queue'), { recursive: true })
    const churn = spawn(
      process.execPath,
      [
        '-e',
        `const { enqueue, release } = await import(${JSON.stringify(path.join(import.meta.dirname, 'queue.ts'))})
         const end = Date.now() + 3000
         let n = 0
         while (Date.now() < end) release(enqueue(${JSON.stringify(box.state)}, { id: 'c' + n++, cwd: '/', estimateBytes: 1, jobClass: 'light', label: 'c', pid: process.pid, since: '' }))`,
      ],
      { stdio: 'ignore' },
    )
    const exited = new Promise((resolve) => churn.on('close', resolve))
    let scans = 0
    const errors: unknown[] = []
    const end = Date.now() + 2_500
    while (Date.now() < end) {
      try {
        live(box.state, 'queue')
        scans += 1
      } catch (error) {
        errors.push(error)
      }
    }
    await exited
    expect(errors).toEqual([])
    expect(scans).toBeGreaterThan(100)
  }, 20_000)
})

describe.skipIf(!userScopes)('slice roots', () => {
  test('a wrapper stops only ownerless slices under its own root, never one beside it', async () => {
    const standIn = `heavytprod${randomBytes(4).toString('hex')}`
    const production = spawn(
      'systemd-run',
      [
        '--user',
        '--scope',
        '--quiet',
        '--expand-environment=no',
        `--slice=${standIn}-live.slice`,
        'bash',
        '-c',
        'echo $$; exec sleep 60',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    try {
      let out = ''
      production.stdout.on('data', (chunk) => (out += chunk))
      await expect.poll(() => out, { timeout: 10_000 }).toMatch(/^\d+\n/)
      const sleeper = Number(out.trim())
      const box = lifecycleBox(65536)
      expect((await heavy(box, 'own-root', ['true'], { jobClass: 'light' })).code).toBe(0)

      const unrooted = sandbox()
      expect(sliceRootFor(unrooted.state)).toMatch(/^heavys[0-9a-f]{10}$/)
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, 'run.ts'),
          '--state-dir',
          unrooted.state,
          '--log-dir',
          unrooted.logs,
          'no-root',
          '--',
          'true',
        ],
        { encoding: 'utf8' },
      )
      expect(result.status).toBe(0)
      expect(recordOf(unrooted, 'no-root')?.slice).toMatch(/^heavys[0-9a-f]{10}-[0-9a-f]+\.slice$/)
      expect(alive(sleeper)).toBe(true)
      expect(liveSlices(standIn).map((slice) => slice.slice)).toEqual([`${standIn}-live.slice`])
      spawnSync('systemctl', ['--user', 'stop', `${sliceRootFor(unrooted.state)}.slice`])
    } finally {
      production.kill('SIGTERM')
      spawnSync('systemctl', ['--user', 'stop', `${standIn}.slice`])
    }
  }, 40_000)

  test("production's root is refused with any other state directory", () => {
    const box = sandbox()
    const result = spawnSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'run.ts'),
        '--state-dir',
        box.state,
        '--slice-root',
        'heavy',
        'refused',
        '--',
        'true',
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      '--slice-root heavy belongs to the state directory /work/tmp/wave-heavy',
    )
    expect(existsSync(path.join(box.state, 'queue'))).toBe(false)
  })

  test('the reaper refuses a slice outside the root it was given', () => {
    expect(() => reapSlice('heavytmine', 'heavy-0123abcd.slice')).toThrow(
      'outside the slice root heavytmine',
    )
  })
})

describe.skipIf(!userScopes)('job lifecycle', () => {
  test('a scan never fails on a slice that is removed mid-read', async () => {
    const box = sandbox()
    const churn = spawn(
      'bash',
      [
        '-c',
        `end=$((SECONDS + 4)); i=0; while [ $SECONDS -lt $end ]; do systemd-run --user --scope --quiet --slice=${box.sliceRoot}-c$i.slice true; systemctl --user stop ${box.sliceRoot}-c$i.slice; i=$((i + 1)); done`,
      ],
      { stdio: 'ignore' },
    )
    const exited = new Promise((resolve) => churn.on('close', resolve))
    let seen = 0
    const errors: unknown[] = []
    while (churn.exitCode === null) {
      try {
        for (const slice of liveSlices(box.sliceRoot)) {
          sliceMemory(box.sliceRoot, slice.slice)
          seen += 1
        }
      } catch (error) {
        errors.push(error)
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
    await exited
    expect(errors).toEqual([])
    expect(seen).toBeGreaterThan(0)
  }, 30_000)

  test('a wrapper killed mid-job keeps its locks held until the next admission stops the orphan', async () => {
    const box = lifecycleBox(768)
    const first = start(box, 'orphaned', ['bash', '-c', 'echo $$; exec sleep 60'], {
      jobClass: 'light',
      machine: true,
    })
    await expect.poll(first.stdout, { timeout: 10_000 }).toMatch(/^\d+\n/)
    const sleeper = Number(first.stdout().trim())
    const killed = new Promise((resolve) => first.child.on('exit', resolve))
    first.child.kill('SIGKILL')
    await killed
    expect(alive(sleeper)).toBe(true)
    expect(exclusiveSlotFree(box)).toBe(false)

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light', machine: true })
    expect(next.code).toBe(0)
    expect(next.stderr).toMatch(/stopping \S+\.slice: its wrapper is gone/)
    expect(next.stderr).toMatch(/'next' is waiting: memory: -?\d+ MiB free after 1 running job/)
    expect(alive(sleeper)).toBe(false)
    expect(exclusiveSlotFree(box)).toBe(true)
    expect(liveSlices(box.sliceRoot)).toEqual([])
  }, 40_000)

  test('a job that ignores SIGTERM is killed after the grace and leaves nothing held', async () => {
    const box = lifecycleBox(65536, 1)
    const stubborn = start(
      box,
      'stubborn',
      ['bash', '-c', 'trap "" TERM; echo started; exec sleep 60'],
      {
        jobClass: 'light',
      },
    )
    await expect.poll(stubborn.stdout, { timeout: 10_000 }).toContain('started')
    const stoppedAt = Date.now()
    stubborn.child.kill('SIGTERM')
    const result = await stubborn.done
    expect(Date.now() - stoppedAt).toBeLessThan(8_000)
    expect(result.code).toBe(137)
    expect(recordOf(box, 'stubborn')).toMatchObject({ exitCode: 137 })
    expect(unitActive(recordOf(box, 'stubborn')!.slice!)).toBe(false)
    expect(exclusiveSlotFree(box)).toBe(true)
  }, 30_000)

  test('a launch that fails leaves no ceiling, entry or lock behind', async () => {
    const box = lifecycleBox(65536)
    const gone = path.join(box.root, 'gone')
    mkdirSync(gone)
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} since=now holder=test`)
    const doomed = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, 'run.ts'),
        '--state-dir',
        box.state,
        '--settings-home',
        box.home,
        '--slice-root',
        box.sliceRoot,
        '--class',
        'light',
        'doomed',
        '--',
        'true',
      ],
      { cwd: gone, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    doomed.stderr.on('data', (chunk) => (stderr += chunk))
    const exited = new Promise<number | null>((resolve) => doomed.on('close', resolve))
    await expect.poll(() => stderr, { timeout: 10_000 }).toContain('draining for')
    rmSync(gone, { recursive: true })
    rmSync(path.join(box.state, 'drain.request'))
    expect(await exited).toBe(2)
    expect(dropIns(box)).toEqual([])
    expect(
      readdirSync(path.join(box.state, 'jobs')).filter((name) => name.endsWith('.json')),
    ).toEqual([])
    expect(exclusiveSlotFree(box)).toBe(true)
  }, 30_000)

  test('a drain request from a live process holds new jobs until it is withdrawn', async () => {
    const box = lifecycleBox(65536)
    const request = path.join(box.state, 'drain.request')
    writeFileSync(
      request,
      `pid=${process.pid} since=${new Date().toISOString()} holder=quiet-bench`,
    )
    const held = start(box, 'held', ['true'], { jobClass: 'light' })
    await expect.poll(held.stderr, { timeout: 10_000 }).toContain('draining for pid=')
    expect(held.stderr()).toContain('holder=quiet-bench')
    rmSync(request)
    expect((await held.done).code).toBe(0)
  }, 30_000)

  test('a drain request from a dead process is ignored', async () => {
    const box = lifecycleBox(65536)
    const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim()
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${dead} since=then holder=gone`)
    const result = await heavy(box, 'free', ['true'], { jobClass: 'light' })
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('draining')
    expect(existsSync(path.join(box.state, 'drain.request'))).toBe(true)
  }, 30_000)
})
