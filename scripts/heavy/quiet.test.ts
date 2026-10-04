import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { bootSeconds, sliceState } from './admission'
import { DEADLINE_START_SECONDS, SCOPE_SHIM, stopTimeoutSeconds } from './job'
import { tryLock, unlock } from './lock'
import { live } from './queue'

import {
  alive,
  endedAt,
  heavy,
  recordOf,
  records,
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

const RUN = path.join(import.meta.dirname, 'run.ts')
const light = { ceilingMiB: 1024, estimateMiB: 64 }
const classes = { bench: light, browser: light, build: light, light, suite: light }

// Plenty of memory and no pressure or load: only the quiet rules can keep two jobs apart.
function quietBox(holdSeconds: number) {
  const box = sandbox()
  writeMachine(box, { availableMiB: 65536 })
  writeSettings(box, {
    'developer.heavyJobClasses': classes,
    'developer.heavyJobQuietHoldSeconds': holdSeconds,
    'developer.heavyJobStopGraceSeconds': 1,
  })
  return box
}

const sleeper = (seconds: number) => ['bash', '-c', `echo started; sleep ${seconds}`]

describe.skipIf(!userScopes)('quiet holds', () => {
  test('a surviving payload keeps its interval during cleanup without granting new light admission', async () => {
    const box = quietBox(600)
    const cleanup = path.join(box.root, 'cleanup')
    const releaseCleanup = path.join(box.root, 'release-cleanup')
    const releasePayload = path.join(box.root, 'release-payload')
    const bin = path.join(box.root, 'bin')
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, 'systemctl'),
      `#!/bin/bash\nif [[ "$2" == stop && "$3" == *_deadline.service ]]; then\n touch '${cleanup}'\n ${until(releaseCleanup)}\nfi\nexport PATH="$HEAVY_FIXTURE_MANAGER_PATH"\nexec systemctl "$@"\n`,
      { mode: 0o755 },
    )
    const quiet = start(
      box,
      'surviving-payload',
      ['bash', '-c', `echo active; ${until(releasePayload)}`],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          HEAVY_FIXTURE_MANAGER_PATH: process.env.PATH,
        },
      },
    )
    let next: ReturnType<typeof start> | undefined
    try {
      await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('active')
      expect(
        (await start(box, 'known-active', ['true'], { jobClass: 'light', machine: true }).done)
          .code,
      ).toBe(0)
      expect(recordOf(box, 'known-active')).toBeDefined()
      const owner = live(box.state, 'jobs').find((job) => job.label === 'surviving-payload')!
      const runtimeFile = path.join(box.state, 'runs', `${owner.id}.json`)
      const journalFile = path.join(box.state, 'measurements', `${owner.id}.json`)
      const interval = JSON.parse(readFileSync(runtimeFile, 'utf8'))
      const children = readFileSync(`/proc/${owner.pid}/task/${owner.pid}/children`, 'utf8')
      const primary = Number(children.trim().split(' ')[0])
      expect(readFileSync(`/proc/${primary}/cmdline`, 'utf8')).toContain(SCOPE_SHIM)
      process.kill(primary, 'SIGKILL')
      await expect.poll(() => existsSync(cleanup), { timeout: 5_000 }).toBe(true)
      expect(existsSync(`/proc/${primary}`)).toBe(false)
      expect(sliceState(box.sliceRoot, `${box.sliceRoot}-${owner.id}.slice`)).toBe('running')
      expect(readFileSync(`/proc/${owner.pid}/status`, 'utf8')).toMatch(/^State:\s+[RSDI]\b/m)
      expect(owner.quietDeadline!).toBeGreaterThan(bootSeconds())
      expect(live(box.state, 'jobs').some((job) => job.id === owner.id)).toBe(true)
      expect(JSON.parse(readFileSync(runtimeFile, 'utf8'))).toMatchObject({
        endedAt: null,
        startedAt: interval.startedAt,
      })
      expect(existsSync(journalFile)).toBe(true)
      expect(recordOf(box, 'surviving-payload')).toBeUndefined()
      next = start(box, 'after-populated-cleanup', ['echo', 'cleanup-settled'], {
        jobClass: 'light',
        machine: true,
      })
      await expect
        .poll(next.stderr, { timeout: 5_000 })
        .toContain("quiet hold by 'surviving-payload'")
      expect(next.stdout()).toBe('')
      expect(recordOf(box, 'after-populated-cleanup')).toBeUndefined()
      writeFileSync(releaseCleanup, '')
      expect((await quiet.done).code).not.toBe(0)
      expect((await next.done).code).toBe(0)
      expect(next.stdout()).toContain('cleanup-settled')
      expect(sliceState(box.sliceRoot, `${box.sliceRoot}-${owner.id}.slice`)).not.toBe('running')
      expect(existsSync(runtimeFile)).toBe(false)
      expect(existsSync(journalFile)).toBe(false)
      expect(recordOf(box, 'surviving-payload')!.jobsDuringRun.map((job) => job.label)).toEqual([
        'known-active',
      ])
    } finally {
      writeFileSync(releaseCleanup, '')
      writeFileSync(releasePayload, '')
      await Promise.all([quiet.done, next?.done])
    }
  }, 20_000)

  test('a quiet deadline crossed during runtime mutex contention keeps light queued until settlement', async () => {
    const box = quietBox(600)
    const releaseQuiet = path.join(box.root, 'release-quiet')
    const quiet = start(
      box,
      'mutex-deadline',
      ['bash', '-c', `echo active; ${until(releaseQuiet)}`],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
      },
    )
    let next: ReturnType<typeof start> | undefined
    let lock: number | null = null
    let entryFile: string | undefined
    let entryText = ''
    try {
      await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('active')
      expect(
        (await start(box, 'known-active', ['true'], { jobClass: 'light', machine: true }).done)
          .code,
      ).toBe(0)
      const owner = live(box.state, 'jobs').find((job) => job.label === 'mutex-deadline')!
      entryFile = path.join(box.state, 'jobs', `${owner.id}.json`)
      entryText = readFileSync(entryFile, 'utf8')
      lock = tryLock(path.join(box.state, 'runtime.lock'))
      expect(lock).not.toBeNull()
      const deadline = bootSeconds() + 2
      writeFileSync(entryFile, JSON.stringify({ ...owner, quietDeadline: deadline }))
      next = start(box, 'after-mutex-deadline', ['echo', 'settled-light'], {
        jobClass: 'light',
        machine: true,
      })
      await expect
        .poll(
          () => {
            if (next!.stderr().includes("quiet hold by 'mutex-deadline'")) return true
            return readFileSync(`/proc/${next!.child.pid}/wchan`, 'utf8').includes(
              'locks_lock_inode_wait',
            )
          },
          { timeout: 1_500 },
        )
        .toBe(true)
      expect(bootSeconds()).toBeLessThan(deadline)
      await expect.poll(() => bootSeconds(), { timeout: 3_000 }).toBeGreaterThan(deadline)
      unlock(lock!)
      lock = null
      // Observe a complete admission polling interval after releasing the expired holder.
      await expect
        .poll(
          () => {
            if (next!.stdout()) return 'started'
            return bootSeconds() > deadline + 1.5 ? 'held' : 'checking'
          },
          { timeout: 3_000 },
        )
        .toBe('held')
      expect(next.stdout()).toBe('')
      expect(recordOf(box, 'after-mutex-deadline')).toBeUndefined()
      expect(live(box.state, 'jobs').some((job) => job.id === owner.id)).toBe(true)
      writeFileSync(releaseQuiet, '')
      expect((await quiet.done).code).toBe(0)
      expect((await next.done).code).toBe(0)
      expect(next.stdout()).toContain('settled-light')
      expect(recordOf(box, 'mutex-deadline')!.jobsDuringRun.map((job) => job.label)).toEqual([
        'known-active',
      ])
    } finally {
      if (lock !== null) unlock(lock)
      if (entryFile && entryText && existsSync(entryFile)) writeFileSync(entryFile, entryText)
      writeFileSync(releaseQuiet, '')
      await Promise.all([quiet.done, next?.done])
    }
  }, 20_000)

  test.each(['cancelled', 'expired admission'])(
    'runtime mutex contention leaves a %s request bounded while the mutex remains held',
    async (mode) => {
      const box = quietBox(600)
      const releaseQuiet = path.join(box.root, 'release-quiet')
      const quiet = start(
        box,
        'mutex-bounded',
        ['bash', '-c', `echo active; ${until(releaseQuiet)}`],
        {
          quiet: true,
          jobClass: 'bench',
          machine: true,
        },
      )
      let next: ReturnType<typeof start> | undefined
      let lock: number | null = null
      try {
        await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('active')
        expect(
          (await start(box, 'known-active', ['true'], { jobClass: 'light', machine: true }).done)
            .code,
        ).toBe(0)
        writeSettings(box, {
          'developer.heavyJobClasses': classes,
          'developer.heavyJobQuietHoldSeconds': 2,
          'developer.heavyJobStopGraceSeconds': 1,
        })
        lock = tryLock(path.join(box.state, 'runtime.lock'))
        expect(lock).not.toBeNull()
        next = start(box, 'bounded-waiter', ['echo', 'unexpected-launch'], {
          quiet: mode === 'expired admission',
          jobClass: mode === 'expired admission' ? 'bench' : 'light',
          machine: true,
        })
        await expect
          .poll(
            () => {
              if (next!.stderr().includes("quiet hold by 'mutex-bounded'")) return true
              return readFileSync(`/proc/${next!.child.pid}/wchan`, 'utf8').includes(
                'locks_lock_inode_wait',
              )
            },
            { timeout: 1_500 },
          )
          .toBe(true)
        if (mode === 'cancelled') next.child.kill('SIGTERM')
        await expect
          .poll(() => next!.child.exitCode, { timeout: 3_000 })
          .toBe(mode === 'cancelled' ? 143 : 75)
        expect((await next.done).code).toBe(mode === 'cancelled' ? 143 : 75)
        expect(next.stdout()).toBe('')
        expect(recordOf(box, 'bounded-waiter')).toBeUndefined()
        expect(live(box.state, 'queue')).toEqual([])
        expect(tryLock(path.join(box.state, 'runtime.lock'))).toBeNull()
        expect(quiet.child.exitCode).toBeNull()
      } finally {
        if (lock !== null) unlock(lock)
        writeFileSync(releaseQuiet, '')
        await Promise.all([quiet.done, next?.done])
      }
    },
    15_000,
  )

  test('light eligibility starts after quiet preparation and ends before manager cleanup settles', async () => {
    const box = quietBox(600)
    const gates = Object.fromEntries(
      ['prepared', 'prepare-release', 'finished', 'cleanup', 'cleanup-release'].map((name) => [
        name,
        path.join(box.root, name),
      ]),
    )
    const bin = path.join(box.root, 'bin')
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, 'systemctl'),
      `#!/bin/bash\nif [[ "$*" == *"set-property"* ]]; then\n touch '${gates.prepared}'\n ${until(gates['prepare-release']!)}\nfi\nif [[ "$2" == stop && "$3" == *.slice ]]; then\n touch '${gates.cleanup}'\n ${until(gates['cleanup-release']!)}\nfi\nexport PATH="$HEAVY_FIXTURE_MANAGER_PATH"\nexec systemctl "$@"\n`,
      { mode: 0o755 },
    )
    const quiet = start(
      box,
      'preparing',
      ['bash', '-c', `echo active; ${until(gates.finished!)}`],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          HEAVY_FIXTURE_MANAGER_PATH: process.env.PATH,
        },
      },
    )
    const children = [quiet]
    try {
      await expect.poll(() => existsSync(gates.prepared!), { timeout: 8_000 }).toBe(true)
      const owner = live(box.state, 'jobs')[0]!
      expect(existsSync(path.join(box.state, 'runs', `${owner.id}.json`))).toBe(false)
      const light = start(box, 'eligible-light', ['echo', 'light-active'], {
        jobClass: 'light',
        machine: true,
      })
      children.push(light)
      await expect.poll(light.stderr, { timeout: 5_000 }).toContain("quiet hold by 'preparing'")
      expect(light.stdout()).toBe('')
      writeFileSync(gates['prepare-release']!, '')
      await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('active')
      await expect.poll(light.stdout, { timeout: 5_000 }).toContain('light-active')
      expect((await light.done).code).toBe(0)
      writeFileSync(gates.finished!, '')
      await expect.poll(() => existsSync(gates.cleanup!), { timeout: 5_000 }).toBe(true)
      expect(sliceState(box.sliceRoot, `${box.sliceRoot}-${owner.id}.slice`)).not.toBe('running')
      expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
      const next = start(box, 'after-cleanup', ['echo', 'cleanup-settled'], {
        jobClass: 'light',
        machine: true,
      })
      children.push(next)
      await expect.poll(next.stderr, { timeout: 5_000 }).toContain("quiet hold by 'preparing'")
      expect(next.stdout()).toBe('')
      writeFileSync(gates['cleanup-release']!, '')
      expect((await quiet.done).code).toBe(0)
      expect((await next.done).code).toBe(0)
      expect(next.stdout()).toContain('cleanup-settled')
      expect(recordOf(box, 'preparing')!.jobsDuringRun.map((job) => job.label)).toEqual([
        'eligible-light',
      ])
    } finally {
      for (const gate of ['prepare-release', 'finished', 'cleanup-release'])
        writeFileSync(gates[gate]!, '')
      await Promise.all(children.map((child) => child.done))
    }
  }, 25_000)

  test.each(['suspended', 'expired', 'stale'])(
    'a %s quiet owner with a populated slice cannot grant light eligibility',
    async (mode) => {
      const box = quietBox(600)
      const releaseQuiet = path.join(box.root, 'release-quiet')
      const quiet = start(box, 'guarded', ['bash', '-c', `echo active; ${until(releaseQuiet)}`], {
        quiet: true,
        jobClass: 'bench',
        machine: true,
      })
      let next: ReturnType<typeof start> | undefined
      let entryFile: string | undefined
      let runtimeFile: string | undefined
      let entryText = ''
      let runtimeText = ''
      try {
        await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('active')
        expect(
          (await start(box, 'known-active', ['true'], { jobClass: 'light', machine: true }).done)
            .code,
        ).toBe(0)
        const owner = live(box.state, 'jobs').find((job) => job.label === 'guarded')!
        entryFile = path.join(box.state, 'jobs', `${owner.id}.json`)
        runtimeFile = path.join(box.state, 'runs', `${owner.id}.json`)
        entryText = readFileSync(entryFile, 'utf8')
        runtimeText = readFileSync(runtimeFile, 'utf8')
        if (mode === 'expired')
          writeFileSync(entryFile, JSON.stringify({ ...owner, quietDeadline: bootSeconds() - 1 }))
        if (mode === 'stale')
          writeFileSync(runtimeFile, JSON.stringify({ ...JSON.parse(runtimeText), pid: -1 }))
        if (mode === 'suspended') {
          quiet.child.kill('SIGSTOP')
          await expect
            .poll(() => readFileSync(`/proc/${owner.pid}/status`, 'utf8'))
            .toMatch(/^State:\s+T/m)
        }
        expect(sliceState(box.sliceRoot, `${box.sliceRoot}-${owner.id}.slice`)).toBe('running')
        next = start(box, 'guarded-light', ['echo', 'released-light'], {
          jobClass: 'light',
          machine: true,
        })
        await expect.poll(next.stderr, { timeout: 5_000 }).toContain("quiet hold by 'guarded'")
        expect(next.stdout()).toBe('')
        expect(recordOf(box, 'guarded-light')).toBeUndefined()
        writeFileSync(entryFile, entryText)
        writeFileSync(runtimeFile, runtimeText)
        quiet.child.kill('SIGCONT')
        await expect.poll(next.stdout, { timeout: 5_000 }).toContain('released-light')
        expect((await next.done).code).toBe(0)
        expect(quiet.child.exitCode).toBeNull()
      } finally {
        if (entryFile && entryText) writeFileSync(entryFile, entryText)
        if (runtimeFile && runtimeText) writeFileSync(runtimeFile, runtimeText)
        quiet.child.kill('SIGCONT')
        writeFileSync(releaseQuiet, '')
        await Promise.all([quiet.done, next?.done])
      }
    },
    20_000,
  )

  test.each(['completed', 'cancelled'])(
    'a %s measurement settles independently of a delayed light manager launch',
    async (mode) => {
      const box = quietBox(600)
      const control = start(box, 'control', ['echo', 'control'], {
        jobClass: 'light',
        machine: true,
      })
      expect((await control.done).code).toBe(0)
      expect(control.stdout()).toContain('control')
      expect(recordOf(box, 'control')).toBeDefined()
      const releaseQuiet = path.join(box.root, 'release-quiet')
      const releaseSpanning = path.join(box.root, 'release-spanning')
      const releaseProperty = path.join(box.root, 'release-property')
      const propertyEntered = path.join(box.root, 'property-entered')
      const quiet = start(
        box,
        'measurement',
        ['bash', '-c', `echo measuring; ${until(releaseQuiet)}`],
        { quiet: true, jobClass: 'bench', machine: true },
      )
      const children = [quiet]
      try {
        await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('measuring')
        const short = start(box, 'short-light', ['echo', 'short'], {
          jobClass: 'light',
          machine: true,
        })
        children.push(short)
        expect((await short.done).code).toBe(0)
        const spanning = start(
          box,
          'spanning-light',
          ['bash', '-c', `echo spanning; ${until(releaseSpanning)}`],
          { jobClass: 'light', machine: true },
        )
        children.push(spanning)
        await expect.poll(spanning.stdout, { timeout: 8_000 }).toContain('spanning')
        const bin = path.join(box.root, 'bin')
        mkdirSync(bin)
        const systemctl = path.join(bin, 'systemctl')
        writeFileSync(
          systemctl,
          `#!/bin/bash\nif [[ "$*" == *"set-property"* ]]; then\n touch '${propertyEntered}'\n ${until(releaseProperty)}\nfi\nexport PATH="$HEAVY_FIXTURE_MANAGER_PATH"\nexec systemctl "$@"\n`,
        )
        const managerPath = process.env.PATH ?? ''
        chmodSync(systemctl, 0o755)
        const delayed = start(box, 'manager-delayed-light', ['echo', 'delayed'], {
          jobClass: 'light',
          machine: true,
          env: {
            ...process.env,
            PATH: `${bin}:${managerPath}`,
            HEAVY_FIXTURE_MANAGER_PATH: managerPath,
          },
        })
        children.push(delayed)
        await expect.poll(() => existsSync(propertyEntered), { timeout: 8_000 }).toBe(true)
        expect(delayed.stdout()).toBe('')
        expect(
          live(box.state, 'jobs')
            .map((job) => job.label)
            .sort(),
        ).toEqual(['manager-delayed-light', 'measurement', 'spanning-light'])
        let settled = false
        void quiet.done.then(() => (settled = true))
        if (mode === 'cancelled') quiet.child.kill('SIGTERM')
        if (mode === 'completed') writeFileSync(releaseQuiet, '')
        await expect.poll(() => settled, { timeout: 5_000 }).toBe(true)
        expect((await quiet.done).code).toBe(mode === 'completed' ? 0 : 143)
        const measurement = recordOf(box, 'measurement')!
        expect(measurement.jobsDuringRun.map((job) => job.label).sort()).toEqual([
          'short-light',
          'spanning-light',
        ])
        expect(new Set(measurement.jobsDuringRun.map((job) => job.id)).size).toBe(2)
        expect(measurement.jobsDuringRun.find((job) => job.label === 'short-light')).toMatchObject({
          endedAt: expect.any(String),
          allowedCpus: [],
        })
        expect(
          measurement.jobsDuringRun.find((job) => job.label === 'spanning-light'),
        ).toMatchObject({
          endedAt: null,
          allowedCpus: [],
        })
        expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
        expect(existsSync(path.join(box.state, 'runs', `${measurement.requestId}.json`))).toBe(
          false,
        )
        expect(
          live(box.state, 'jobs')
            .map((job) => job.label)
            .sort(),
        ).toEqual(['manager-delayed-light', 'spanning-light'])
        expect(existsSync(releaseProperty)).toBe(false)
        expect(recordOf(box, 'manager-delayed-light')).toBeUndefined()
        writeFileSync(releaseProperty, '')
        expect((await delayed.done).code).toBe(0)
      } finally {
        writeFileSync(releaseProperty, '')
        writeFileSync(releaseQuiet, '')
        writeFileSync(releaseSpanning, '')
        quiet.child.kill('SIGTERM')
        await Promise.all(children.map((child) => child.done))
      }
    },
    30_000,
  )

  test('a quiet job waits for running jobs to drain, and jobs queued behind it wait for it', async () => {
    const box = quietBox(600)
    const releaseRunning = path.join(box.root, 'release-running')
    const releaseQuiet = path.join(box.root, 'release-quiet')
    const running = start(
      box,
      'running',
      ['bash', '-c', `echo started; ${until(releaseRunning)}`],
      {
        jobClass: 'light',
        machine: true,
      },
    )
    await expect.poll(running.stdout, { timeout: 10_000 }).toContain('started')
    const quiet = start(box, 'quiet', ['bash', '-c', `echo started; ${until(releaseQuiet)}`], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    await expect.poll(quiet.stderr, { timeout: 10_000 }).toContain('waiting for 1 running job')
    const behind = start(box, 'behind', ['true'], { jobClass: 'suite', machine: true })
    await expect
      .poll(() => live(box.state, 'queue').map((entry) => entry.label), {
        timeout: 10_000,
      })
      .toEqual(['quiet', 'behind'])
    expect(quiet.stdout()).toBe('')
    writeFileSync(releaseRunning, '')
    expect((await running.done).code).toBe(0)
    await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toMatch(
      /^quiet id=[0-9a-f]+ pid=\d+ since=\d{4}-\d\d-\d\dT\S+ cwd=\S+\n$/,
    )
    expect(recordOf(box, 'behind')).toBeUndefined()
    writeFileSync(releaseQuiet, '')
    expect((await quiet.done).code).toBe(0)
    expect((await behind.done).code).toBe(0)
    expect(startedAt(recordOf(box, 'quiet'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'running')),
    )
    expect(startedAt(recordOf(box, 'behind'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'quiet')),
    )
    expect(recordOf(box, 'quiet')).toMatchObject({ quiet: true, quietHoldExpired: false })
  }, 40_000)

  test('a server waiting for a browser check lets the quiet job ahead of that check finish', async () => {
    const box = quietBox(600)
    const releaseServer = path.join(box.root, 'release-server')
    const releaseWork = path.join(box.root, 'release-work')
    const releaseQuiet = path.join(box.root, 'release-quiet')
    const server = start(
      box,
      'vite-server',
      ['bash', '-c', `echo started; ${until(releaseServer)}`],
      {
        jobClass: 'light',
        machine: true,
        server: true,
      },
    )
    const work = start(box, 'finite-work', ['bash', '-c', `echo started; ${until(releaseWork)}`], {
      jobClass: 'light',
      machine: true,
    })
    let quiet: ReturnType<typeof start> | undefined
    let browser: ReturnType<typeof start> | undefined
    try {
      await expect.poll(server.stdout, { timeout: 10_000 }).toContain('started')
      await expect.poll(work.stdout, { timeout: 10_000 }).toContain('started')
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'vite-server')!
      quiet = start(box, 'measurement', ['bash', '-c', `echo started; ${until(releaseQuiet)}`], {
        jobClass: 'bench',
        machine: true,
        quiet: true,
      })
      await expect
        .poll(() => live(box.state, 'queue').map((entry) => entry.label), {
          timeout: 10_000,
        })
        .toEqual(['measurement'])
      browser = start(box, 'browser-check', ['touch', releaseServer], {
        jobClass: 'browser',
        machine: true,
      })
      await expect
        .poll(() => live(box.state, 'queue').map((entry) => entry.label), {
          timeout: 10_000,
        })
        .toEqual(['measurement', 'browser-check'])
      writeFileSync(releaseWork, '')
      expect((await work.done).code).toBe(0)
      await expect.poll(quiet.stdout, { timeout: 5_000 }).toContain('started')
      expect(recordOf(box, 'browser-check')).toBeUndefined()
      expect(
        live(box.state, 'jobs')
          .map((entry) => entry.label)
          .sort(),
      ).toEqual(['measurement', 'vite-server'])
      writeFileSync(releaseQuiet, '')
      expect((await quiet.done).code).toBe(0)
      expect(recordOf(box, 'measurement')).toMatchObject({
        quiet: true,
        serversAtAdmission: [
          {
            id: owner.id,
            label: owner.label,
            pid: owner.pid,
            cwd: owner.cwd,
            sliceRoot: owner.sliceRoot,
          },
        ],
      })
      expect((await browser.done).code).toBe(0)
      expect((await server.done).code).toBe(0)
    } finally {
      for (const file of [releaseServer, releaseWork, releaseQuiet]) writeFileSync(file, '')
      await Promise.all([server.done, work.done, quiet?.done, browser?.done])
    }
  }, 40_000)

  test('a declared server keeps its ceiling and accounting while leaving external slot locks free', async () => {
    const box = quietBox(600)
    const releaseServer = path.join(box.root, 'release-server')
    const server = start(box, 'server', ['bash', '-c', `echo started; ${until(releaseServer)}`], {
      jobClass: 'light',
      machine: true,
      server: true,
    })
    try {
      await expect.poll(server.stdout, { timeout: 10_000 }).toContain('started')
      const owner = live(box.state, 'jobs')[0]!
      expect(owner).toMatchObject({ server: true, estimateBytes: 64 * 2 ** 20 })
      const ceiling = spawnSync('systemctl', [
        '--user',
        'show',
        `${box.sliceRoot}-${owner.id}.slice`,
        '-p',
        'MemoryMax',
        '--value',
      ])
      expect(ceiling.stdout.toString().trim()).toBe(String(1024 * 2 ** 20))
      for (const slot of ['slot1.lock', 'slot2.lock', 'slot3.lock']) {
        const fd = tryLock(path.join(box.state, slot))
        if (fd !== null) unlock(fd)
        expect(fd).not.toBeNull()
      }
      const status = spawnSync('bun', [
        path.join(import.meta.dirname, 'status.ts'),
        '--state-dir',
        box.state,
        '--slice-root',
        box.sliceRoot,
      ])
      expect(status.stdout.toString()).toContain('server (light, 64 MiB, server)')
    } finally {
      writeFileSync(releaseServer, '')
      await server.done
    }
    expect(recordOf(box, 'server')).toMatchObject({
      server: true,
      quiet: false,
      serversAtAdmission: [],
      exitCode: 0,
    })
  }, 30_000)

  test.each([
    { name: 'memory', machine: { availableMiB: 512 }, reason: 'memory:' },
    {
      name: 'memory pressure',
      machine: { availableMiB: 65536, memoryPressure: 99 },
      reason: 'memory pressure',
    },
    { name: 'CPU load', machine: { availableMiB: 65536, loadPerCore: 9 }, reason: 'CPU load' },
  ])(
    'quiet admission expires under $name so a server-dependent browser check can progress',
    async ({ machine, reason }) => {
      const box = quietBox(3)
      writeSettings(box, {
        'developer.heavyJobClasses': { ...classes, bench: { ceilingMiB: 2048, estimateMiB: 1024 } },
        'developer.heavyJobQuietHoldSeconds': 3,
        'developer.heavyJobMemoryReserveMiB': 0,
        'developer.heavyJobStopGraceSeconds': 1,
      })
      const releaseServer = path.join(box.root, 'release-server')
      const server = start(box, 'server', ['bash', '-c', `echo started; ${until(releaseServer)}`], {
        jobClass: 'light',
        machine: true,
        server: true,
      })
      let browser: ReturnType<typeof start> | undefined
      try {
        await expect.poll(server.stdout, { timeout: 10_000 }).toContain('started')
        writeMachine(box, machine)
        const quiet = start(box, 'quiet', ['echo', 'measurement'], {
          jobClass: 'bench',
          machine: true,
          quiet: true,
        })
        await expect.poll(quiet.stderr, { timeout: 10_000 }).toContain(reason)
        browser = start(box, 'browser', ['touch', releaseServer], {
          jobClass: 'browser',
          machine: true,
        })
        const result = await quiet.done
        expect(result.code).toBe(75)
        expect(result.stderr).toContain("quiet admission for 'quiet' expired")
        expect(result.stderr).toContain('wait reached its 3 s limit')
        expect(result.stderr).toContain('Run it again to queue for another admission window')
        expect(quiet.stdout()).toBe('')
        expect(recordOf(box, 'quiet')).toBeUndefined()
        expect(live(box.state, 'queue').some((entry) => entry.label === 'quiet')).toBe(false)
        expect(existsSync(path.join(box.state, 'quiet.holder'))).toBe(false)
        // Pressure can hold ordinary admission too; memory leaves room for the browser already.
        if (reason !== 'memory:') writeMachine(box, { availableMiB: 65536 })
        expect((await browser.done).code).toBe(0)
        expect((await server.done).code).toBe(0)
      } finally {
        writeMachine(box, { availableMiB: 65536 })
        writeFileSync(releaseServer, '')
        await Promise.all([server.done, browser?.done])
      }
    },
    30_000,
  )

  test.each(['earlier queue', 'drain request', 'slot locks', 'admission lock'])(
    'quiet admission has a deadline behind %s',
    async (obstruction) => {
      const box = quietBox(3)
      const slot = path.join(
        box.state,
        obstruction === 'admission lock' ? 'admission.lock' : 'slot1.lock',
      )
      const fd = obstruction === 'drain request' ? null : tryLock(slot)!
      const drain = path.join(box.state, 'drain.request')
      if (obstruction === 'drain request') writeFileSync(drain, `pid=${process.pid} holder=test`)
      const ahead =
        obstruction === 'earlier queue'
          ? start(box, 'ahead', ['true'], { jobClass: 'light', machine: true })
          : undefined
      try {
        if (ahead)
          await expect.poll(ahead.stderr, { timeout: 10_000 }).toContain('held exclusively')
        const quiet = start(box, 'deadline', ['echo', 'measurement'], {
          jobClass: 'light',
          machine: true,
          quiet: true,
        })
        await expect
          .poll(() => live(box.state, 'queue').some((entry) => entry.label === 'deadline'), {
            timeout: 10_000,
          })
          .toBe(true)
        const status = spawnSync('bun', [
          path.join(import.meta.dirname, 'status.ts'),
          '--state-dir',
          box.state,
          '--slice-root',
          box.sliceRoot,
        ])
        expect(status.stdout.toString()).toMatch(/deadline .*quiet admission: [0-3]s left/)
        expect((await quiet.done).code).toBe(75)
        expect(quiet.stdout()).toBe('')
        expect(
          readdirSync(path.join(box.state, 'queue')).filter((name) => name.endsWith('.json')),
        ).toHaveLength(ahead ? 1 : 0)
        expect(live(box.state, 'queue').map((entry) => entry.label)).toEqual(ahead ? ['ahead'] : [])
        expect(existsSync(path.join(box.state, 'quiet.holder'))).toBe(false)
      } finally {
        if (fd !== null) unlock(fd)
        rmSync(drain, { force: true })
        await ahead?.done
      }
      expect((await heavy(box, 'after', ['true'], { jobClass: 'light', machine: true })).code).toBe(
        0,
      )
    },
    30_000,
  )

  test('cancelling a quiet admission releases its waiting entry immediately', async () => {
    const box = quietBox(600)
    const fd = tryLock(path.join(box.state, 'slot1.lock'))!
    const quiet = start(box, 'cancelled', ['true'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    try {
      await expect.poll(quiet.stderr, { timeout: 10_000 }).toContain('held exclusively')
      const queued = live(box.state, 'queue')[0]!
      quiet.child.kill('SIGTERM')
      expect((await quiet.done).code).toBe(143)
      const entries = path.join(box.state, 'queue')
      expect(existsSync(path.join(entries, `000000000001-${queued.id}.json`))).toBe(false)
      expect(existsSync(path.join(box.state, 'quiet.holder'))).toBe(false)
    } finally {
      quiet.child.kill('SIGTERM')
      unlock(fd)
    }
  }, 30_000)

  test('an admission exception releases its waiting entry', async () => {
    const box = quietBox(600)
    rmSync(path.join(box.proc, 'meminfo'))
    const result = await heavy(box, 'broken-readings', ['true'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    expect(result.code).toBe(2)
    expect(
      readdirSync(path.join(box.state, 'queue')).filter((name) => name.endsWith('.json')),
    ).toEqual([])
    expect(live(box.state, 'queue')).toEqual([])
    expect(existsSync(path.join(box.state, 'quiet.holder'))).toBe(false)
  })

  test('the running quiet hold starts independently after admission finishes', async () => {
    const box = quietBox(4)
    const releaseWork = path.join(box.root, 'release-work')
    const work = start(box, 'work', ['bash', '-c', `echo started; ${until(releaseWork)}`], {
      jobClass: 'light',
      machine: true,
    })
    let quiet: ReturnType<typeof start> | undefined
    try {
      await expect.poll(work.stdout, { timeout: 10_000 }).toContain('started')
      quiet = start(box, 'independent-hold', sleeper(60), {
        jobClass: 'light',
        machine: true,
        quiet: true,
      })
      await expect.poll(quiet.stderr, { timeout: 10_000 }).toContain('waiting for 1 running job')
      await Bun.sleep(1100)
      writeFileSync(releaseWork, '')
      expect((await work.done).code).toBe(0)
      await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
      expect((await quiet.done).code).toBe(75)
      expect(recordOf(box, 'independent-hold')).toMatchObject({ quietHoldExpired: true })
      expect(recordOf(box, 'independent-hold')!.queuedMs).toBeGreaterThanOrEqual(1000)
      expect(recordOf(box, 'independent-hold')!.wallMs).toBeGreaterThanOrEqual(3000)
    } finally {
      writeFileSync(releaseWork, '')
      await Promise.all([work.done, quiet?.done])
    }
  }, 30_000)

  test('a hold that runs out stops the quiet job, tells it to queue again, and frees the machine', async () => {
    const box = quietBox(2)
    const quiet = start(box, 'long', sleeper(60), { jobClass: 'light', machine: true, quiet: true })
    const result = await quiet.done
    expect(result.code).toBe(75)
    expect(result.stderr).toContain("started 'long'")
    expect(result.stderr).toContain("quiet hold for 'long' reached its 2 s limit")
    expect(result.stderr).toContain('Run it again to queue for another hold')
    expect(recordOf(box, 'long')).toMatchObject({ quiet: true, quietHoldExpired: true })
    expect(unitActive(recordOf(box, 'long')!.slice!)).toBe(false)
    for (const slot of ['slot1.lock', 'slot2.lock', 'slot3.lock']) {
      const fd = tryLock(path.join(box.state, slot))
      expect(fd).not.toBeNull()
      if (fd !== null) unlock(fd)
    }
    expect(
      (await heavy(box, 'after-expiry', ['true'], { jobClass: 'light', machine: true })).code,
    ).toBe(0)
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  }, 30_000)

  test('quiet measurements and suites in two loops both make progress', async () => {
    // Admission includes the finite loop's systemd handoff; only running holds expire here.
    const box = quietBox(10)
    const loop = async (label: string, command: readonly string[], quiet: boolean) => {
      for (let run = 0; run < 2; run += 1) {
        const result = await heavy(box, `${label}-${run}`, command, {
          jobClass: 'light',
          machine: true,
          quiet,
        })
        expect(
          result.code,
          JSON.stringify({
            label,
            run,
            stderr: result.stderr,
            now: bootSeconds(),
            owners: live(box.state, 'jobs').map((entry) => ({
              ...entry,
              cgroup: sliceState(entry.sliceRoot, `${entry.sliceRoot}-${entry.id}.slice`),
            })),
          }),
        ).toBe(quiet ? 75 : 0)
      }
    }
    await Promise.all([loop('quiet', ['sleep', '60'], true), loop('suite', ['true'], false)])
    expect(
      records(box)
        .map((record) => record.label)
        .sort(),
    ).toEqual(['quiet-0', 'quiet-1', 'suite-0', 'suite-1'])
  }, 60_000)

  test('a drain request is honoured for one hold from when it is first seen, whatever its clock says', async () => {
    const box = quietBox(600)
    const request = path.join(box.state, 'drain.request')
    writeFileSync(request, `pid=${process.pid} since=2099-01-01T00:00:00Z holder=future`)
    const held = start(box, 'held', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(held.stderr, { timeout: 10_000 }).toContain('draining for pid=')
    expect(recordOf(box, 'held')).toBeUndefined()
    const seen = path.join(box.state, 'drain.seen')
    const identity = readFileSync(seen, 'utf8').split(' ').slice(0, 3).join(' ')
    writeFileSync(seen, `${identity} ${bootSeconds() - 601}`)
    expect((await held.done).code).toBe(0)
    expect(existsSync(request)).toBe(true)
  }, 30_000)

  test('an expired quiet hold blocks admission until its suspended wrapper releases ownership', async () => {
    const box = quietBox(3)
    const quiet = start(box, 'frozen', sleeper(60), {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
    const owner = live(box.state, 'jobs').find((entry) => entry.label === 'frozen')!
    const scope = `${box.sliceRoot}-${owner.id}.scope`
    const slice = `${box.sliceRoot}-${owner.id}.slice`
    const runtime = spawnSync('systemctl', [
      '--user',
      'show',
      scope,
      '-p',
      'RuntimeMaxUSec',
      '--value',
    ])
    expect(runtime.stdout.toString().trim()).toBe('3s')
    quiet.child.kill('SIGSTOP')
    let next: ReturnType<typeof start> | undefined
    try {
      await expect
        .poll(() => readFileSync(`/proc/${quiet.child.pid}/status`, 'utf8'), {
          timeout: 10_000,
        })
        .toMatch(/^State:\s+T/m)
      await expect.poll(bootSeconds, { timeout: 5_000 }).toBeGreaterThan(owner.quietDeadline!)
      const expired = spawnSync('systemctl', ['--user', 'stop', scope])
      expect(expired.status).toBe(0)
      await expect.poll(() => unitActive(scope), { timeout: 10_000 }).toBe(false)
      writeFileSync(
        path.join(box.state, 'jobs', `${owner.id}.json`),
        JSON.stringify({
          ...owner,
          quietUntil: bootSeconds() - 1,
        }),
      )
      next = start(box, 'after-frozen', ['true'], { jobClass: 'light', machine: true })
      await expect.poll(next.stderr, { timeout: 10_000 }).toContain('quiet hold by')
      expect(recordOf(box, 'after-frozen')).toBeUndefined()
      expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
      expect(sliceState(box.sliceRoot, slice)).not.toBe('running')
      quiet.child.kill('SIGCONT')
      expect((await next.done).code).toBe(0)
    } finally {
      quiet.child.kill('SIGCONT')
      next?.child.kill('SIGTERM')
      await next?.done
    }
    expect((await quiet.done).code).toBe(75)
    expect(recordOf(box, 'frozen')).toMatchObject({ quiet: true, quietHoldExpired: true })
    expect(unitActive(slice)).toBe(false)
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  }, 40_000)

  test.each([false, true])(
    'an expired quiet payload keeps admission blocked while its wrapper is suspended, legacy=%s',
    async (legacy) => {
      const box = quietBox(3)
      const quiet = start(box, 'frozen', sleeper(60), {
        jobClass: 'light',
        machine: true,
        quiet: true,
      })
      await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'frozen')!
      const scope = `${box.sliceRoot}-${owner.id}.scope`
      const slice = `${box.sliceRoot}-${owner.id}.slice`
      const runtime = spawnSync('systemctl', [
        '--user',
        'show',
        scope,
        '-p',
        'RuntimeMaxUSec',
        '--value',
      ])
      expect(runtime.stdout.toString().trim()).toMatch(/^[123]s$/)
      const releaseNext = path.join(box.root, 'release-next')
      const canaryBox = quietBox(60)
      const releaseCanary = path.join(canaryBox.root, 'release')
      const canary = start(
        canaryBox,
        'canary',
        ['bash', '-c', `echo started; ${until(releaseCanary)}`],
        {
          jobClass: 'light',
          machine: true,
          server: true,
        },
      )
      await expect.poll(canary.stdout, { timeout: 5_000 }).toContain('started')
      let next: ReturnType<typeof start> | undefined
      let ordinary: ReturnType<typeof start> | undefined
      quiet.child.kill('SIGSTOP')
      try {
        expect(owner.quietUntil! - owner.quietDeadline!).toBeCloseTo(
          DEADLINE_START_SECONDS + stopTimeoutSeconds(1),
          2,
        )
        await expect
          .poll(() => readFileSync(`/proc/${quiet.child.pid}/status`, 'utf8'), {
            timeout: 10_000,
          })
          .toMatch(/^State:\s+T/m)
        await expect
          .poll(bootSeconds, { timeout: (DEADLINE_START_SECONDS + 10) * 1000 })
          .toBeGreaterThan(owner.quietUntil!)
        await expect.poll(() => unitActive(scope), { timeout: 5_000 }).toBe(false)
        writeSettings(box, {
          'developer.heavyJobClasses': classes,
          'developer.heavyJobQuietHoldSeconds': 60,
          'developer.heavyJobStopGraceSeconds': 1,
        })
        if (legacy) {
          writeFileSync(
            path.join(box.state, 'jobs', `${owner.id}.json`),
            JSON.stringify({ ...owner, quietDeadline: undefined }),
          )
        }
        next = start(box, 'after-frozen', ['bash', '-c', `echo started; ${until(releaseNext)}`], {
          jobClass: 'light',
          machine: true,
          quiet: true,
        })
        await expect.poll(next.stderr, { timeout: 5_000 }).toContain("quiet hold by 'frozen'")
        expect(next.stdout()).toBe('')
        expect(recordOf(box, 'after-frozen')).toBeUndefined()
        expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
        expect(sliceState(box.sliceRoot, slice)).not.toBe('running')
        expect(alive(canary.child.pid!)).toBe(true)
        quiet.child.kill('SIGCONT')
        expect((await quiet.done).code).toBe(75)
        await expect.poll(next.stdout, { timeout: 5_000 }).toContain('started')
        ordinary = start(box, 'after-next', ['true'], { jobClass: 'suite', machine: true })
        await expect.poll(ordinary.stderr, { timeout: 5_000 }).toContain('quiet hold')
        expect(alive(canary.child.pid!)).toBe(true)
        expect(canary.child.exitCode).toBeNull()
        expect(sliceState(box.sliceRoot, slice)).not.toBe('running')
        writeFileSync(releaseNext, '')
        expect((await next.done).code).toBe(0)
        expect((await ordinary.done).code).toBe(0)
        expect(startedAt(recordOf(box, 'after-next'))).toBeGreaterThanOrEqual(
          endedAt(recordOf(box, 'after-frozen')),
        )
      } finally {
        writeFileSync(releaseNext, '')
        next?.child.kill('SIGTERM')
        ordinary?.child.kill('SIGTERM')
        quiet.child.kill('SIGCONT')
        writeFileSync(releaseCanary, '')
        await Promise.all([quiet.done, next?.done, ordinary?.done, canary.done])
      }
      expect((await quiet.done).code).toBe(75)
      expect(recordOf(box, 'frozen')).toMatchObject({ quiet: true, quietHoldExpired: true })
      expect(unitActive(slice)).toBe(false)
      expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
    },
    40_000,
  )

  test.each([false, true])(
    'an expired launcher retains admission ownership until release for its quiet=%s successor',
    async (quietSuccessor) => {
      const box = quietBox(2)
      const launcherFile = path.join(box.root, 'launcher.pid')
      const delayedPayload = path.join(box.root, 'delayed-payload')
      const releaseNext = path.join(box.root, 'release-next')
      const launcher = path.join(box.root, 'launcher.sh')
      const launcherDone = path.join(box.root, 'launcher.done')
      const preload = path.join(box.root, 'delay.ts')
      writeFileSync(
        launcher,
        `printf '%s' "$$" > ${launcherFile}\nkill -STOP "$$"\n"$@"\nrc=$?\nprintf '%s' "$rc" > ${launcherDone}\nexit "$rc"\n`,
      )
      writeFileSync(
        preload,
        `const spawn = Bun.spawn.bind(Bun)
        Bun.spawn = (options) => spawn(options.cmd?.[0] === 'systemd-run'
          ? { ...options, cmd: ['bash', '-p', ${JSON.stringify(launcher)}, ...options.cmd] }
          : options)
        `,
      )
      const delayed = start(box, 'delayed', ['touch', delayedPayload], {
        jobClass: 'light',
        machine: true,
        quiet: true,
        preload,
      })
      let launcherPid: number | undefined
      let next: ReturnType<typeof start> | undefined
      let ordinary: ReturnType<typeof start> | undefined
      try {
        await expect.poll(() => existsSync(launcherFile), { timeout: 10_000 }).toBe(true)
        launcherPid = Number(readFileSync(launcherFile, 'utf8'))
        await expect
          .poll(() => readFileSync(`/proc/${launcherPid}/status`, 'utf8'), { timeout: 5_000 })
          .toMatch(/^State:\s+T/m)
        delayed.child.kill('SIGSTOP')
        const owner = live(box.state, 'jobs').find((entry) => entry.label === 'delayed')!
        expect(owner).toBeDefined()
        expect(owner.quietUntil! - owner.quietDeadline!).toBeCloseTo(
          DEADLINE_START_SECONDS + stopTimeoutSeconds(1),
          2,
        )
        expect(sliceState(box.sliceRoot, `${box.sliceRoot}-${owner.id}.slice`)).not.toBe('running')
        await expect
          .poll(bootSeconds, { timeout: (DEADLINE_START_SECONDS + 10) * 1000 })
          .toBeGreaterThan(owner.quietUntil!)
        writeSettings(box, {
          'developer.heavyJobClasses': classes,
          'developer.heavyJobQuietHoldSeconds': 60,
          'developer.heavyJobStopGraceSeconds': 1,
        })
        next = start(box, 'successor', ['bash', '-c', `echo started; ${until(releaseNext)}`], {
          jobClass: 'light',
          machine: true,
          quiet: quietSuccessor,
        })
        await expect.poll(next.stderr, { timeout: 5_000 }).toContain("quiet hold by 'delayed'")
        expect(next.stdout()).toBe('')
        expect(recordOf(box, 'successor')).toBeUndefined()
        expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
        process.kill(launcherPid, 'SIGCONT')
        await expect.poll(() => existsSync(launcherDone), { timeout: 5_000 }).toBe(true)
        expect(existsSync(delayedPayload)).toBe(false)
        expect(readFileSync(launcherDone, 'utf8')).toBe('75')
        expect(next.stdout()).toBe('')
        expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
        delayed.child.kill('SIGCONT')
        expect((await delayed.done).code).toBe(75)
        expect(recordOf(box, 'delayed')).toMatchObject({ quietHoldExpired: true })
        await expect.poll(next.stdout, { timeout: 5_000 }).toContain('started')
        if (quietSuccessor) {
          ordinary = start(box, 'ordinary', ['true'], { jobClass: 'suite', machine: true })
          await expect.poll(ordinary.stderr, { timeout: 5_000 }).toContain('quiet hold')
        }
        expect(next.child.exitCode).toBeNull()
        writeFileSync(releaseNext, '')
        expect((await next.done).code).toBe(0)
        if (ordinary) expect((await ordinary.done).code).toBe(0)
      } finally {
        writeFileSync(releaseNext, '')
        next?.child.kill('SIGTERM')
        ordinary?.child.kill('SIGTERM')
        delayed.child.kill('SIGCONT')
        delayed.child.kill('SIGTERM')
        if (launcherPid && alive(launcherPid)) process.kill(launcherPid, 'SIGCONT')
        await Promise.all([delayed.done, next?.done, ordinary?.done])
      }
    },
    40_000,
  )

  test('a killed quiet wrapper is recovered while another tool waits for a slot lock', async () => {
    const box = quietBox(600)
    const quiet = start(box, 'dead-holder', ['bash', '-c', 'echo $$; exec sleep 60'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    await expect.poll(quiet.stdout, { timeout: 10_000 }).toMatch(/^\d+\n/)
    const sleeper = Number(quiet.stdout().trim())
    const marks = path.join(box.root, 'tool')
    const tool = startExternal(box, [
      'flock',
      '-x',
      path.join(box.state, 'slot1.lock'),
      'bash',
      '-c',
      `date +%s%3N > ${marks}`,
    ])
    const toolDone = new Promise((resolve) => tool.on('close', resolve))
    await expect.poll(() => readFileSync('/proc/locks', 'utf8')).toContain('->')
    const killed = new Promise((resolve) => quiet.child.on('exit', resolve))
    quiet.child.kill('SIGKILL')
    await killed
    const next = await heavy(box, 'recovers', ['true'], { jobClass: 'light', machine: true })
    await toolDone
    expect(next.code).toBe(0)
    expect(next.stderr).toMatch(/stopping \S+\.slice: its wrapper is gone/)
    expect(alive(sleeper)).toBe(false)
    expect(existsSync(marks)).toBe(true)
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  }, 40_000)

  test('another tool holding all three slot locks is an unbounded hold that status reports with its age', async () => {
    const box = quietBox(2)
    const slot = (n: number) => path.join(box.state, `slot${n}.lock`)
    for (const n of [1, 2, 3]) writeFileSync(slot(n), '', { flag: 'a' })
    const ready = path.join(box.root, 'tool-ready')
    const releaseTool = path.join(box.root, 'release-tool')
    const tool = startExternal(box, [
      'flock',
      slot(1),
      'flock',
      slot(2),
      'flock',
      slot(3),
      'bash',
      '-c',
      `touch ${ready}; ${until(releaseTool)}`,
    ])
    const toolDone = new Promise((resolve) => tool.on('close', resolve))
    await expect.poll(() => existsSync(ready), { timeout: 10_000 }).toBe(true)
    const waiting = start(box, 'waits', ['true'], { jobClass: 'light', machine: true })
    await expect.poll(waiting.stderr, { timeout: 10_000 }).toContain('quiet hold by another tool')
    writeFileSync(path.join(box.state, 'legacy-hold.since'), String(Date.now() - 5_000))
    const status = spawnSync('bun', [
      path.join(import.meta.dirname, 'status.ts'),
      '--state-dir',
      box.state,
      '--slice-root',
      box.sliceRoot,
    ])
    expect(status.stdout.toString()).toMatch(
      /quiet hold: another tool \(pid [\d, ]+\) holds all three slot locks, unbounded, for [1-9]\d*s/,
    )
    writeFileSync(releaseTool, '')
    await toolDone
    expect((await waiting.done).code).toBe(0)
    expect(existsSync(path.join(box.state, 'legacy-hold.since'))).toBe(false)
  }, 30_000)
})

describe('slices that run nothing', () => {
  test('an empty slice left behind counts as nothing running and is left alone', async (context) => {
    if (!userScopes) context.skip('Requires a working user systemd manager and user scopes')
    const box = quietBox(600)
    const empty = `${box.sliceRoot}-leftover.slice`
    // Explicitly activate a process-free slice and check the cgroup that admission reads.
    const setup = spawnSync('systemctl', ['--user', 'start', empty], { encoding: 'utf8' })
    expect(setup.status, setup.error?.message ?? setup.stderr).toBe(0)
    expect(sliceState(box.sliceRoot, empty)).toBe('empty')
    const quiet = await heavy(box, 'quiet-now', ['true'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    expect(quiet.code, quiet.stderr).toBe(0)
    expect(quiet.stderr).toContain('the machine is quiet')
    expect(sliceState(box.sliceRoot, empty)).toBe('empty')
    const next = await heavy(box, 'alone', ['true'], { jobClass: 'light', machine: true })
    expect(next.code).toBe(0)
    expect(next.stderr).toContain('no heavy job is running')
    expect(`${quiet.stderr}${next.stderr}`).not.toContain('its wrapper is gone')
    expect(sliceState(box.sliceRoot, empty)).toBe('empty')
  }, 30_000)
})

test.each([
  { flags: ['--quiet', '--host', 'pi'], message: '--quiet applies to this machine' },
  { flags: ['--server', '--quiet'], message: '--server declares a local dev server' },
  { flags: ['--server', '--host', 'pi'], message: '--server declares a local dev server' },
])('invalid lifecycle flags are rejected (%j)', ({ flags, message }) => {
  const box = quietBox(600)
  const result = spawnSync(
    process.execPath,
    [
      RUN,
      '--state-dir',
      box.state,
      '--settings-home',
      box.home,
      '--proc',
      box.proc,
      '--slice-root',
      box.sliceRoot,
      ...flags,
      'invalid-lifecycle',
      '--',
      'true',
    ],
    // A validation regression must stay inside the fixture and cannot launch host tools.
    { encoding: 'utf8', env: { ...process.env, PATH: box.root }, timeout: 10_000 },
  )
  expect(result.status, result.stderr).toBe(2)
  expect(result.stderr).toContain(message)
  expect(readdirSync(box.state)).not.toContain('queue')
  expect(records(box)).toEqual([])
})
