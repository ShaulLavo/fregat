import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { decide, type Limits, type Readings } from './admission'
import {
  endedAt,
  heavy,
  MiB,
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  startedAt,
  unitActive,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

afterEach(removeSandboxes)

const GiB = 1024 * MiB
const NESTED = path.join(import.meta.dirname, 'nested-scope.sh')
const calm: Readings = { cpuLoad: 0.2, memAvailableBytes: 16 * GiB, memoryPressure: 0 }
const limits: Limits = { cpuLoadLimit: 1, memoryPressureLimit: 10, reserveBytes: 2 * GiB }

describe('decide', () => {
  test('starts a job when none runs, whatever the machine looks like', () => {
    const swamped: Readings = { cpuLoad: 9, memAvailableBytes: 0, memoryPressure: 90 }
    expect(decide(8 * GiB, [], swamped, limits).admit).toBe(true)
  })

  test('charges a running job only the part of its estimate it has not used yet', () => {
    const half = [{ currentBytes: 3 * GiB, estimateBytes: 6 * GiB }]
    expect(decide(11 * GiB, half, calm, limits).admit).toBe(true)
    expect(decide(11.5 * GiB, half, calm, limits).admit).toBe(false)
    const over = [{ currentBytes: 9 * GiB, estimateBytes: 6 * GiB }]
    expect(decide(14 * GiB, over, calm, limits).admit).toBe(true)
  })

  test('charges a job whose slice is not up yet its whole estimate', () => {
    const fresh = [{ currentBytes: null, estimateBytes: 6 * GiB }]
    expect(decide(8 * GiB, fresh, calm, limits)).toMatchObject({ admit: true })
    expect(decide(8.1 * GiB, fresh, calm, limits)).toMatchObject({ admit: false })
  })

  test('holds a job while memory pressure or CPU load is at its limit', () => {
    const running = [{ currentBytes: 0, estimateBytes: GiB }]
    expect(decide(GiB, running, { ...calm, memoryPressure: 10 }, limits).reason).toContain(
      'memory pressure',
    )
    expect(decide(GiB, running, { ...calm, cpuLoad: 1 }, limits).reason).toContain('CPU load')
    expect(
      decide(GiB, running, { ...calm, cpuLoad: 0.99, memoryPressure: 9.9 }, limits).admit,
    ).toBe(true)
  })
})

const classes = {
  bench: { ceilingMiB: 2048, estimateMiB: 1024 },
  browser: { ceilingMiB: 2048, estimateMiB: 1024 },
  build: { ceilingMiB: 2048, estimateMiB: 1024 },
  light: { ceilingMiB: 256, estimateMiB: 128 },
  suite: { ceilingMiB: 8192, estimateMiB: 4096 },
}

function admissionBox(machine: Parameters<typeof writeMachine>[1]) {
  const box = sandbox()
  writeMachine(box, machine)
  writeSettings(box, {
    'developer.heavyJobClasses': { ...classes, light: { ceilingMiB: 1024, estimateMiB: 512 } },
    'developer.heavyJobMemoryReserveMiB': 0,
  })
  return box
}

const sleeper = (seconds: number) => ['bash', '-c', `echo started; sleep ${seconds}`]

describe.skipIf(!userScopes)('admission between real jobs', () => {
  test('starts a second job beside a running one when memory covers both', async () => {
    const box = admissionBox({ availableMiB: 4096 })
    const first = start(box, 'first', sleeper(3), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
    await first.done
    expect(startedAt(recordOf(box, 'second'))).toBeLessThan(endedAt(recordOf(box, 'first')))
  }, 30_000)

  test('holds a job while memory is short and starts it when the running job ends', async () => {
    const box = admissionBox({ availableMiB: 768 })
    const first = start(box, 'first', sleeper(2), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const second = await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
    await first.done
    expect(second.stderr).toMatch(/'second' is waiting: memory: \d+ MiB free/)
    expect(startedAt(recordOf(box, 'second'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'first')),
    )
  }, 30_000)

  test.each([
    ['memory pressure', { memoryPressure: 50 }],
    ['CPU load', { loadPerCore: 2 }],
  ])(
    'holds a job while %s is at its limit',
    async (reason, pressure) => {
      const box = admissionBox({ availableMiB: 65536, ...pressure })
      const first = start(box, 'first', sleeper(2), { jobClass: 'light', machine: true })
      await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
      const second = await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
      await first.done
      expect(second.stderr).toContain(reason)
      expect(startedAt(recordOf(box, 'second'))).toBeGreaterThanOrEqual(
        endedAt(recordOf(box, 'first')),
      )
    },
    30_000,
  )

  test('serves the queue first-in first-out: a small job never overtakes a large one', async () => {
    const box = admissionBox({ availableMiB: 4096 })
    const first = start(box, 'first', sleeper(2), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const large = start(box, 'large', sleeper(2), { jobClass: 'suite', machine: true })
    await expect.poll(large.stderr, { timeout: 10_000 }).toContain("'large' is waiting")
    const small = start(box, 'small', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(small.stderr, { timeout: 10_000 }).toContain('1 job(s) ahead in the queue')
    await Promise.all([first.done, large.done, small.done])
    expect(startedAt(recordOf(box, 'large'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'first')),
    )
    expect(startedAt(recordOf(box, 'small'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'large')),
    )
  }, 40_000)

  test('a waiter that died leaves the queue to the next job', async () => {
    const box = admissionBox({ availableMiB: 768 })
    const first = start(box, 'first', sleeper(2), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const dead = start(box, 'dead', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(dead.stderr, { timeout: 10_000 }).toContain("'dead' is waiting")
    dead.child.kill('SIGKILL')
    const next = await heavy(box, 'next', ['true'], { jobClass: 'light', machine: true })
    await first.done
    expect(next.code).toBe(0)
    expect(recordOf(box, 'next')?.queuedMs).toBeLessThan(10_000)
  }, 30_000)

  test('starts nothing new while another tool waits for a slot lock exclusively', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const first = start(box, 'first', sleeper(2), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const marks = path.join(box.root, 'exclusive')
    const exclusive = spawn(
      'flock',
      [
        '-x',
        path.join(box.state, 'slot1.lock'),
        'bash',
        '-c',
        `date +%s%3N > ${marks}.got; sleep 1; date +%s%3N > ${marks}.left`,
      ],
      { stdio: 'ignore' },
    )
    const exclusiveDone = new Promise((resolve) => exclusive.on('close', resolve))
    await expect.poll(() => readFileSync('/proc/locks', 'utf8')).toContain('->')
    const second = await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
    await first.done
    await exclusiveDone
    expect(second.stderr).toContain('waiting for the slot locks exclusively')
    const got = Number(readFileSync(`${marks}.got`, 'utf8'))
    expect(got).toBeGreaterThanOrEqual(endedAt(recordOf(box, 'first')) - 50)
    expect(startedAt(recordOf(box, 'second'))).toBeGreaterThanOrEqual(
      Number(readFileSync(`${marks}.left`, 'utf8')),
    )
  }, 30_000)
})

describe.skipIf(!userScopes)('the job slice', () => {
  test('a scope the job opens with nested-scope.sh counts in the job peak', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const allocate = `${NESTED} bun -e 'Buffer.alloc(200 * 2 ** 20, 1)'`
    const result = await heavy(box, 'nested', ['bash', '-c', allocate], { jobClass: 'build' })
    expect(result.code).toBe(0)
    const record = recordOf(box, 'nested')
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(200 * MiB)
    expect(record?.slice).toMatch(/^heavy-[0-9a-f]+\.slice$/)
    expect(record).toMatchObject({
      ceilingBytes: 2048 * MiB,
      class: 'build',
      estimateBytes: 1024 * MiB,
    })
  }, 30_000)

  test('a nested scope that outgrows the class ceiling is killed inside the job slice', async () => {
    const box = sandbox()
    writeSettings(box, { 'developer.heavyJobClasses': classes })
    const overflow = `${NESTED} bun -e 'Buffer.alloc(600 * 2 ** 20, 1)'; echo "nested exit $?"`
    const job = start(box, 'overflow', ['bash', '-c', overflow], { jobClass: 'light' })
    const result = await job.done
    expect(result.code).toBe(0)
    expect(job.stdout()).toContain('nested exit 137')
    const record = recordOf(box, 'overflow')
    expect(record?.oomKills).toBeGreaterThanOrEqual(1)
    expect(record?.level).toBe('warn')
  }, 30_000)

  test('a case scope running the shim alone inside the job counts itself and spares the job', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const accounting = path.join(box.root, 'case.accounting')
    const shim = path.join(import.meta.dirname, 'scope.sh')
    const script = [
      'sleep 5 & sibling=$!',
      `systemd-run --user --scope --quiet --slice="$HEAVY_JOB_SLICE" bash ${shim} ${accounting} bun -e 'Buffer.alloc(150 * 2 ** 20, 1)'`,
      'kill -0 $sibling && echo "sibling alive"',
      `cat ${accounting}`,
    ].join('; ')
    const job = start(box, 'case', ['bash', '-c', script], { jobClass: 'build' })
    await job.done
    expect(job.stdout()).toContain('sibling alive')
    const casePeak = Number(/^peak (\d+)$/m.exec(job.stdout())?.[1])
    expect(casePeak).toBeGreaterThanOrEqual(150 * MiB)
    expect(recordOf(box, 'case')?.memoryPeakBytes).toBeGreaterThanOrEqual(casePeak)
  }, 30_000)

  test('the slice is stopped and its ceiling drop-in removed after the job', async () => {
    const box = sandbox()
    await heavy(box, 'tidy', ['true'], { jobClass: 'light' })
    const slice = recordOf(box, 'tidy')!.slice!
    expect(unitActive(slice)).toBe(false)
    const dropIn = `/run/user/${process.getuid?.()}/systemd/user.control/${slice}.d`
    expect(existsSync(dropIn)).toBe(false)
  }, 30_000)

  test('exports HEAVY_JOB_SLICE to the job', async () => {
    const box = sandbox()
    const job = start(box, 'env', ['bash', '-c', 'echo "slice=$HEAVY_JOB_SLICE"'], {
      jobClass: 'light',
    })
    await job.done
    expect(job.stdout()).toBe(`slice=${recordOf(box, 'env')?.slice}\n`)
  }, 30_000)
})
