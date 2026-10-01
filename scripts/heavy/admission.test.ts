import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { decide, liveSlices, sliceStat, type Limits, type Readings } from './admission'
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
    const first = start(box, 'first', sleeper(3), { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
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

  test("charges a running job's page cache as unused, since MemAvailable counts it free", async () => {
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
    expect(counter(slice, 'active_file') + counter(slice, 'inactive_file')).toBeGreaterThanOrEqual(
      300 * MiB,
    )
    const second = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(await firstDecision(second)).toBe('waiting')
    expect(second.stderr()).toMatch(/'second' is waiting: memory: \d+ MiB free/)
    writeFileSync(release, '')
    await Promise.all([first.done, second.done])
  }, 30_000)

  test("charges a running job's reclaimable slab as unused, since MemAvailable counts it free", async () => {
    const box = admissionBox({ availableMiB: 4096 })
    const release = path.join(box.root, 'release')
    const dir = diskScratch()
    const files = [
      'bash',
      '-c',
      `for i in $(seq 20000); do : > ${dir}/$i; done; echo started; ${until(release)}`,
    ]
    const first = start(box, 'first', files, { jobClass: 'light', machine: true })
    await expect.poll(first.stdout, { timeout: 20_000 }).toContain('started')
    const slice = onlySlice(box)
    const slab = counter(slice, 'slab_reclaimable')
    expect(slab).toBeGreaterThanOrEqual(8 * MiB)
    // Free memory half a slab short of the 512 MiB job once that slab counts as unused, and
    // half a slab over if it counted as used.
    const used =
      counter(slice, 'current') -
      counter(slice, 'active_file') -
      counter(slice, 'inactive_file') -
      slab
    writeMachine(box, { availableMiB: Math.floor((1024 * MiB - used - slab / 2) / MiB) })
    const second = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(await firstDecision(second)).toBe('waiting')
    writeFileSync(release, '')
    await Promise.all([first.done, second.done])
  }, 60_000)

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
    expect(record?.slice).toMatch(new RegExp(`^${box.sliceRoot}-[0-9a-f]+\\.slice$`))
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

  test('the job scope keeps running through an OOM kill, so its shim survives to record', async () => {
    const box = sandbox()
    const script = 'systemctl --user show -p OOMPolicy --value "${HEAVY_JOB_SLICE%.slice}.scope"'
    const job = start(box, 'policy', ['bash', '-c', script], { jobClass: 'light' })
    await job.done
    expect(job.stdout()).toBe('continue\n')
  }, 30_000)

  test('a job whose own command is OOM-killed still gets its record', async () => {
    const box = sandbox()
    writeSettings(box, { 'developer.heavyJobClasses': classes })
    const overflow = `bun -e 'Buffer.alloc(600 * 2 ** 20, 1)'; echo "exit $?"`
    const job = start(box, 'own-oom', ['bash', '-c', overflow], { jobClass: 'light' })
    await job.done
    expect(job.stdout()).toContain('exit 137')
    expect(recordOf(box, 'own-oom')?.oomKills).toBeGreaterThanOrEqual(1)
  }, 30_000)

  test('the command reaches the job as given, with no systemd expansion', async () => {
    const box = sandbox()
    const literal = ['printf', '%s|%s\n', '${HEAVY_JOB_SLICE%.slice}', '$$']
    const direct = start(box, 'literal', literal, { jobClass: 'light' })
    await direct.done
    expect(direct.stdout()).toBe('${HEAVY_JOB_SLICE%.slice}|$$\n')
    const nested = start(box, 'nested-literal', [NESTED, ...literal], { jobClass: 'light' })
    await nested.done
    expect(nested.stdout()).toBe('${HEAVY_JOB_SLICE%.slice}|$$\n')
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
