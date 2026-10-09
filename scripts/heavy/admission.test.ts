import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { chargeOf, decide, liveSlices, sliceStat, type Limits, type Readings } from './admission'
import {
  type Box,
  endedAt,
  firstDecision,
  heavy,
  MiB,
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  startExternal,
  startedAt,
  unitActive,
  until,
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

  test('reserves every running job its charge beside what MemAvailable shows', () => {
    expect(decide(8 * GiB, [6 * GiB], calm, limits).admit).toBe(true)
    expect(decide(8.1 * GiB, [6 * GiB], calm, limits).admit).toBe(false)
    expect(decide(7 * GiB, [6 * GiB, 4 * GiB], calm, limits)).toMatchObject({
      admit: false,
      reason: expect.stringContaining('after 2 running job(s)'),
    })
  })

  test('holds a job while memory pressure or CPU load is at its limit', () => {
    expect(decide(GiB, [GiB], { ...calm, memoryPressure: 10 }, limits).reason).toContain(
      'memory pressure',
    )
    expect(decide(GiB, [GiB], { ...calm, cpuLoad: 1 }, limits).reason).toContain('CPU load')
    const under = { ...calm, cpuLoad: 0.99, memoryPressure: 9.9 }
    expect(decide(GiB, [GiB], under, limits).admit).toBe(true)
  })
})

describe('chargeOf', () => {
  test.each<{ name: string; counters: Record<string, number>; charge: number }>([
    { name: 'anonymous memory', counters: { anon: 400 * MiB }, charge: 112 * MiB },
    { name: 'active page cache', counters: { active_file: 400 * MiB }, charge: 512 * MiB },
    { name: 'inactive page cache', counters: { inactive_file: 400 * MiB }, charge: 512 * MiB },
    { name: 'reclaimable slab', counters: { slab_reclaimable: 400 * MiB }, charge: 512 * MiB },
    {
      name: 'small reclaimable slab observed in CI',
      counters: { slab_reclaimable: 1_976_312 },
      charge: 112 * MiB + 1_976_312,
    },
    {
      name: 'mixed anonymous memory, page cache and reclaimable slab',
      counters: {
        anon: 300 * MiB,
        active_file: 32 * MiB,
        inactive_file: 48 * MiB,
        slab_reclaimable: 1_976_312,
      },
      charge: 192 * MiB + 1_976_312,
    },
  ])('charges $name exactly and admits only when memory covers it', ({ counters, charge }) => {
    const readStat = vi.fn(() => ({ current: 400 * MiB, ...counters }))
    const actual = chargeOf('heavy-test', 'heavy-test-job.slice', 512 * MiB, readStat)
    expect(readStat).toHaveBeenCalledExactlyOnceWith('heavy-test', 'heavy-test-job.slice')
    expect(actual).toBe(charge)

    const estimate = 512 * MiB
    const readings: Readings = {
      ...calm,
      memAvailableBytes: estimate + charge + limits.reserveBytes,
    }
    const short: Readings = { ...readings, memAvailableBytes: readings.memAvailableBytes - 1 }
    expect(decide(estimate, [actual], short, limits)).toMatchObject({
      admit: false,
      reason: expect.stringContaining('memory:'),
    })
    expect(decide(estimate, [actual], readings, limits).admit).toBe(true)
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

const holding = (release: string) => ['bash', '-c', `echo started; ${until(release)}`]
const SYSTEMCTL = spawnSync('sh', ['-c', 'command -v systemctl'], {
  encoding: 'utf8',
}).stdout.trim()

const anon = (mib: number) =>
  `bun -e 'const b = Buffer.alloc(${mib} * 2 ** 20, 1); setInterval(() => b.at(0), 1000)'`
const holdingAnon = (mib: number, release: string) => [
  'bash',
  '-c',
  `${anon(mib)} & echo started; ${until(release)}; kill $!`,
]

/** The one job slice in the sandbox. */
function onlySlice(box: Box) {
  const slices = liveSlices(box.sliceRoot)
  expect(slices).toHaveLength(1)
  return { root: box.sliceRoot, slice: slices[0]!.slice }
}

function counter({ root, slice }: { root: string; slice: string }, name: string) {
  return sliceStat(root, slice)?.[name] ?? 0
}

// A directory on disk: on tmpfs a file is shmem, which is memory in use.
const scratches: string[] = []
function diskScratch() {
  const cache = path.join(import.meta.dirname, '..', '..', 'node_modules', '.cache')
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(path.join(cache, 'heavy-admission-'))
  scratches.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe.skipIf(!userScopes)('admission between real jobs', () => {
  test('starts a second job beside a running one when memory covers both', async () => {
    const box = admissionBox({ availableMiB: 4096 })
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
    writeFileSync(release, '')
    await first.done
    expect(startedAt(recordOf(box, 'second'))).toBeLessThan(endedAt(recordOf(box, 'first')))
  }, 30_000)

  test('charges a running job only the part of its estimate it has not used yet', async () => {
    // 768 MiB free: the first job's 512 MiB estimate would leave too little, but 400 MiB of it
    // is already in use and so already missing from MemAvailable.
    const box = admissionBox({ availableMiB: 768 })
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holdingAnon(400, release), {
      jobClass: 'light',
      machine: true,
    })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const slice = onlySlice(box)
    await expect
      .poll(() => counter(slice, 'anon'), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(400 * MiB)
    const second = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(await firstDecision(second)).toBe('started')
    writeFileSync(release, '')
    await Promise.all([first.done, second.done])
  }, 30_000)

  test("charges a running job's page cache as unused, since MemAvailable counts it free", async (context) => {
    const box = admissionBox({ availableMiB: 768 })
    const release = path.join(box.root, 'release')
    const dir = diskScratch()
    const caching = [
      'bash',
      '-c',
      `dd if=/dev/zero of=${dir}/file bs=1M count=320 status=none && echo started && ${until(release)}`,
    ]
    const first = start(box, 'first', caching, { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const slice = onlySlice(box)
    const cached = counter(slice, 'active_file') + counter(slice, 'inactive_file')
    if (cached < 300 * MiB) {
      writeFileSync(release, '')
      await first.done
      context.skip(`Kernel retained ${cached} bytes of page cache; this check needs 300 MiB`)
    }
    expect(cached).toBeGreaterThanOrEqual(300 * MiB)
    const second = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(await firstDecision(second)).toBe('waiting')
    expect(second.stderr()).toMatch(/'second' is waiting: memory: \d+ MiB free/)
    writeFileSync(release, '')
    await Promise.all([first.done, second.done])
  }, 30_000)

  test('charges a running job what it may claim after reaping an orphan, not before', async () => {
    const box = admissionBox({ availableMiB: 4096 })
    writeSettings(box, {
      'developer.heavyJobClasses': {
        ...classes,
        bench: { ceilingMiB: 64, estimateMiB: 32 },
        light: { ceilingMiB: 1024, estimateMiB: 512 },
      },
      'developer.heavyJobMemoryReserveMiB': 0,
    })
    const free = path.join(box.root, 'free')
    const release = path.join(box.root, 'release')
    const owner = start(
      box,
      'owner',
      [
        'bash',
        '-c',
        `${anon(400)} & echo started; ${until(free)}; kill $!; wait; echo freed; ${until(release)}`,
      ],
      { jobClass: 'light', machine: true },
    )
    await expect.poll(owner.stdout, { timeout: 10_000 }).toContain('started')
    const ownerSlice = onlySlice(box)
    await expect
      .poll(() => counter(ownerSlice, 'anon'), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(400 * MiB)
    const orphaned = start(box, 'orphaned', ['bash', '-c', 'echo started; exec sleep 600'], {
      jobClass: 'bench',
      machine: true,
    })
    await expect.poll(orphaned.stdout, { timeout: 10_000 }).toContain('started')
    // The orphan keeps the wrapper's stdout open, so its exit is what to wait for.
    const killed = new Promise((resolve) => orphaned.child.on('exit', resolve))
    orphaned.child.kill('SIGKILL')
    await killed

    // While the orphan is reaped, the owner frees its 400 MiB and MemAvailable shows it.
    writeMachine(box, { availableMiB: 368 })
    const reaped = path.join(box.root, 'reaped')
    const bin = path.join(box.root, 'bin')
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, 'systemctl'),
      `#!/bin/bash\nif [ "$2" = kill ] && [ ! -e ${free} ]; then : > ${free}; ${until(reaped)}; fi\nexec ${SYSTEMCTL} "$@"\n`,
      { mode: 0o755 },
    )
    const next = start(box, 'next', ['true'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      jobClass: 'light',
      machine: true,
    })
    await expect.poll(owner.stdout, { timeout: 20_000 }).toContain('freed')
    await expect
      .poll(() => counter(ownerSlice, 'anon'), { timeout: 10_000 })
      .toBeLessThan(100 * MiB)
    writeMachine(box, { availableMiB: 768 })
    writeFileSync(reaped, '')
    expect(await firstDecision(next)).toBe('waiting')
    expect(next.stderr()).toMatch(/stopping \S+\.slice: its wrapper is gone/)
    writeFileSync(release, '')
    await Promise.all([owner.done, next.done])
  }, 60_000)

  test('holds a job while memory is short and starts it when the running job ends', async () => {
    const box = admissionBox({ availableMiB: 768 })
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const queued = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    await expect
      .poll(queued.stderr, { timeout: 10_000 })
      .toMatch(/'second' is waiting: memory: \d+ MiB free/)
    writeFileSync(release, '')
    const second = await queued.done
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
      const release = path.join(box.root, 'release')
      const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
      await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
      const queued = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
      await expect.poll(queued.stderr, { timeout: 10_000 }).toContain(reason)
      writeFileSync(release, '')
      const second = await queued.done
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
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const largeRelease = path.join(box.root, 'large-release')
    const large = start(box, 'large', holding(largeRelease), { jobClass: 'suite', machine: true })
    await expect.poll(large.stderr, { timeout: 10_000 }).toContain("'large' is waiting")
    const small = start(box, 'small', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(small.stderr, { timeout: 10_000 }).toContain('1 job(s) ahead in the queue')
    writeFileSync(release, '')
    await expect.poll(large.stdout, { timeout: 10_000 }).toContain('started')
    writeFileSync(largeRelease, '')
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
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const dead = start(box, 'dead', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(dead.stderr, { timeout: 10_000 }).toContain("'dead' is waiting")
    dead.child.kill('SIGKILL')
    await dead.done
    const queued = start(box, 'next', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(queued.stderr, { timeout: 10_000 }).toContain("'next' is waiting: memory:")
    writeFileSync(release, '')
    const next = await queued.done
    await first.done
    expect(next.code).toBe(0)
  }, 30_000)

  test('starts nothing new while another tool waits for a slot lock exclusively', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const release = path.join(box.root, 'release')
    const first = start(box, 'first', holding(release), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const marks = path.join(box.root, 'exclusive')
    const exclusiveRelease = path.join(box.root, 'exclusive-release')
    const exclusive = startExternal(box, [
      'flock',
      '-x',
      path.join(box.state, 'slot1.lock'),
      'bash',
      '-c',
      `touch ${marks}.got; ${until(exclusiveRelease)}`,
    ])
    const exclusiveDone = new Promise((resolve) => exclusive.on('close', resolve))
    await expect.poll(() => readFileSync('/proc/locks', 'utf8')).toContain('->')
    const second = start(box, 'second', ['bash', '-c', 'echo started'], {
      jobClass: 'light',
      machine: true,
    })
    await expect
      .poll(second.stderr, { timeout: 10_000 })
      .toContain('waiting for the slot locks exclusively')
    writeFileSync(release, '')
    await first.done
    await expect.poll(() => existsSync(`${marks}.got`), { timeout: 10_000 }).toBe(true)
    expect(second.stdout()).toBe('')
    writeFileSync(exclusiveRelease, '')
    await exclusiveDone
    expect((await second.done).code).toBe(0)
    expect(second.stdout()).toContain('started')
  }, 30_000)
})

describe.skipIf(!userScopes)('the job slice', () => {
  test('a scope the job opens with nested-scope.sh counts in the job peak', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const allocate = `${NESTED} bun -e 'Buffer.alloc(200 * 2 ** 20, 1)'`
    const result = await heavy(box, 'nested', ['bash', '-c', allocate], {
      jobClass: 'build',
      machine: true,
    })
    expect(result.code).toBe(0)
    const record = recordOf(box, 'nested')
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(200 * MiB)
    expect(record?.slice).toMatch(new RegExp(`^${box.sliceRoot}-[0-9a-f]+\\.slice$`))
    expect(record).toMatchObject({
      ceilingBytes: 2048 * MiB,
      class: 'build',
      estimateBytes: 1024 * MiB,
    })
  }, 30_000)

  test('a nested scope that outgrows the class ceiling is killed inside the job slice', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    writeSettings(box, { 'developer.heavyJobClasses': classes })
    const overflow = `${NESTED} bun -e 'Buffer.alloc(600 * 2 ** 20, 1)'; echo "nested exit $?"`
    const job = start(box, 'overflow', ['bash', '-c', overflow], {
      jobClass: 'light',
      machine: true,
    })
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
      `${until(path.join(box.root, 'sibling-release'))} & sibling=$!`,
      `systemd-run --user --scope --quiet --slice="$HEAVY_JOB_SLICE" bash ${shim} ${accounting} bun -e 'Buffer.alloc(150 * 2 ** 20, 1)'`,
      'kill -0 $sibling && echo "sibling alive"',
      `cat ${accounting}`,
    ].join('; ')
    const job = start(box, 'case', ['bash', '-c', script], { jobClass: 'build', machine: true })
    await job.done
    expect(job.stdout()).toContain('sibling alive')
    const casePeak = Number(/^peak (\d+)$/m.exec(job.stdout())?.[1])
    expect(casePeak).toBeGreaterThanOrEqual(150 * MiB)
    expect(recordOf(box, 'case')?.memoryPeakBytes).toBeGreaterThanOrEqual(casePeak)
  }, 30_000)

  test('the job scope keeps running through an OOM kill, so its shim survives to record', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const script = 'systemctl --user show -p OOMPolicy --value "${HEAVY_JOB_SLICE%.slice}.scope"'
    const job = start(box, 'policy', ['bash', '-c', script], { jobClass: 'light', machine: true })
    await job.done
    expect(job.stdout()).toBe('continue\n')
  }, 30_000)

  test('a job whose own command is OOM-killed still gets its record', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    writeSettings(box, { 'developer.heavyJobClasses': classes })
    const overflow = `bun -e 'Buffer.alloc(600 * 2 ** 20, 1)'; echo "exit $?"`
    const job = start(box, 'own-oom', ['bash', '-c', overflow], {
      jobClass: 'light',
      machine: true,
    })
    await job.done
    expect(job.stdout()).toContain('exit 137')
    expect(recordOf(box, 'own-oom')?.oomKills).toBeGreaterThanOrEqual(1)
  }, 30_000)

  test('the command reaches the job as given, with no systemd expansion', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const literal = ['printf', '%s|%s\n', '${HEAVY_JOB_SLICE%.slice}', '$$']
    const direct = start(box, 'literal', literal, { jobClass: 'light', machine: true })
    await direct.done
    expect(direct.stdout()).toBe('${HEAVY_JOB_SLICE%.slice}|$$\n')
    const nested = start(box, 'nested-literal', [NESTED].concat(literal), {
      jobClass: 'light',
      machine: true,
    })
    await nested.done
    expect(nested.stdout()).toBe('${HEAVY_JOB_SLICE%.slice}|$$\n')
  }, 30_000)

  test('the slice is stopped and its ceiling drop-in removed after the job', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    await heavy(box, 'tidy', ['true'], { jobClass: 'light', machine: true })
    const slice = recordOf(box, 'tidy')!.slice!
    expect(unitActive(slice)).toBe(false)
    const dropIn = `/run/user/${process.getuid?.()}/systemd/user.control/${slice}.d`
    expect(existsSync(dropIn)).toBe(false)
  }, 30_000)

  test('exports HEAVY_JOB_SLICE to the job', async () => {
    const box = admissionBox({ availableMiB: 65536 })
    const job = start(box, 'env', ['bash', '-c', 'echo "slice=$HEAVY_JOB_SLICE"'], {
      jobClass: 'light',
      machine: true,
    })
    await job.done
    expect(job.stdout()).toBe(`slice=${recordOf(box, 'env')?.slice}\n`)
  }, 30_000)
})
