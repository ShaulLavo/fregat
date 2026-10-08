import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { live } from './queue'
import { createQuietObserver, freezeQuietObserver, quietFailureReceipt } from './quiet-receipts'
import {
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  until,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

const budget = { ceilingMiB: 1024, estimateMiB: 64 }

function concurrentBox(holdSeconds = 600) {
  const box = sandbox()
  writeMachine(box, { availableMiB: 65536 })
  writeSettings(box, {
    'developer.heavyJobClasses': {
      bench: budget,
      browser: budget,
      build: budget,
      light: budget,
      suite: budget,
    },
    'developer.heavyJobQuietHoldSeconds': holdSeconds,
    'developer.heavyJobStopGraceSeconds': 1,
  })
  return box
}

afterEach(removeSandboxes)

describe.skipIf(!userScopes)('quiet concurrent work', () => {
  test('late light jobs pass held classes and every overlap reaches the measurement log once', async () => {
    const box = concurrentBox()
    const releaseQuiet = path.join(box.root, 'release-quiet')
    const releaseLight = path.join(box.root, 'release-light')
    const quiet = start(
      box,
      'measurement',
      ['bash', '-c', `echo started; ${until(releaseQuiet)}`],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
      },
    )
    const children = [quiet]
    try {
      await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
      const lateServer = start(box, 'late-server', ['echo', 'server'], {
        server: true,
        jobClass: 'light',
        machine: true,
      })
      children.push(lateServer)
      const held = [lateServer]
      await expect.poll(lateServer.stderr, { timeout: 10_000 }).toContain('quiet hold by')
      for (const jobClass of ['browser', 'suite', 'build', 'bench']) {
        const blocked = start(box, jobClass, ['echo', jobClass], { jobClass, machine: true })
        held.push(blocked)
        children.push(blocked)
        await expect
          .poll(() => live(box.state, 'queue').some((entry) => entry.label === jobClass))
          .toBe(true)
      }
      const quietLight = start(box, 'quiet-light', ['echo', 'quiet-light'], {
        quiet: true,
        jobClass: 'light',
        machine: true,
      })
      held.push(quietLight)
      children.push(quietLight)
      await expect
        .poll(() => live(box.state, 'queue').map((entry) => entry.label))
        .toEqual(['late-server', 'browser', 'suite', 'build', 'bench', 'quiet-light'])
      const finished = start(box, 'short-light', ['echo', 'short'], {
        jobClass: 'light',
        machine: true,
      })
      children.push(finished)
      await expect.poll(finished.stdout, { timeout: 8_000 }).toContain('short')
      expect((await finished.done).code).toBe(0)
      const spanning = start(
        box,
        'spanning-light',
        ['bash', '-c', `echo started; ${until(releaseLight)}`],
        {
          jobClass: 'light',
          machine: true,
        },
      )
      children.push(spanning)
      await expect.poll(spanning.stdout, { timeout: 8_000 }).toContain('started')
      for (const blocked of held) expect(blocked.stdout()).toBe('')
      writeFileSync(releaseQuiet, '')
      expect((await quiet.done).code).toBe(0)
      const overlaps = recordOf(box, 'measurement')!.jobsDuringRun
      expect(overlaps.map((job) => job.label).sort()).toEqual(['short-light', 'spanning-light'])
      expect(new Set(overlaps.map((job) => job.id)).size).toBe(2)
      expect(overlaps.find((job) => job.label === 'short-light')).toMatchObject({
        class: 'light',
        server: false,
        endedAt: expect.any(String),
        startedAt: expect.any(String),
        allowedCpus: [],
      })
      expect(overlaps.find((job) => job.label === 'spanning-light')).toMatchObject({
        class: 'light',
        endedAt: null,
        startedAt: expect.any(String),
        allowedCpus: [],
      })
      writeFileSync(releaseLight, '')
      for (const blocked of held) expect((await blocked.done).code).toBe(0)
      expect(
        readFileSync(path.join(box.logs, new Date().toISOString().slice(0, 10) + '.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .filter((line) => JSON.parse(line).label === 'measurement'),
      ).toHaveLength(1)
      expect(
        existsSync(
          path.join(box.state, 'measurements', recordOf(box, 'measurement')!.requestId + '.json'),
        ),
      ).toBe(false)
    } finally {
      writeFileSync(releaseQuiet, '')
      writeFileSync(releaseLight, '')
      await Promise.all(children.map((child) => child.done))
    }
  }, 40_000)

  test('an empty registered class set keeps new light work waiting', async () => {
    const box = concurrentBox()
    writeSettings(box, {
      ...JSON.parse(readFileSync(path.join(box.home, 'settings.json'), 'utf8')),
      'developer.heavyJobQuietPolicy': {
        allowedClasses: [],
        measurementCpus: [],
        concurrentCpus: [],
      },
    })
    const releaseQuiet = path.join(box.root, 'release-quiet')
    const quiet = start(
      box,
      'measurement',
      ['bash', '-c', `echo started; ${until(releaseQuiet)}`],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
      },
    )
    let light: ReturnType<typeof start> | undefined
    try {
      await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
      light = start(box, 'held-light', ['echo', 'light'], { jobClass: 'light', machine: true })
      await expect.poll(light.stderr, { timeout: 10_000 }).toContain('quiet hold by')
      expect(light.stdout()).toBe('')
      writeFileSync(releaseQuiet, '')
      expect((await quiet.done).code).toBe(0)
      expect((await light.done).code).toBe(0)
      expect(recordOf(box, 'measurement')!.jobsDuringRun).toEqual([])
    } finally {
      writeFileSync(releaseQuiet, '')
      await Promise.all([quiet.done, light?.done])
    }
  }, 30_000)

  test.each([
    { name: 'memory', machine: { availableMiB: 0 }, reason: 'memory:' },
    {
      name: 'pressure',
      machine: { availableMiB: 65536, memoryPressure: 99 },
      reason: 'memory pressure',
    },
    { name: 'load', machine: { availableMiB: 65536, loadPerCore: 99 }, reason: 'CPU load' },
    { name: 'external drain', machine: { availableMiB: 65536 }, reason: 'draining for' },
  ])(
    'light admission preserves the $name gate during a wrapper hold',
    async ({ name, machine, reason }) => {
      const box = concurrentBox()
      const releaseQuiet = path.join(box.root, 'release-quiet')
      const quiet = start(
        box,
        'measurement',
        ['bash', '-c', `echo started; ${until(releaseQuiet)}`],
        {
          quiet: true,
          jobClass: 'bench',
          machine: true,
        },
      )
      let light: ReturnType<typeof start> | undefined
      let later: ReturnType<typeof start> | undefined
      try {
        await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
        writeMachine(box, machine)
        if (name === 'external drain') {
          writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} holder=fixture`)
        }
        light = start(box, 'checked-light', ['echo', 'light'], { jobClass: 'light', machine: true })
        await expect.poll(light.stderr, { timeout: 10_000 }).toContain(reason)
        expect(light.stdout()).toBe('')
        later = start(box, 'later-light', ['echo', 'later'], { jobClass: 'light', machine: true })
        await expect
          .poll(later.stderr, { timeout: 10_000 })
          .toContain('1 job(s) ahead in the queue')
        expect(later.stdout()).toBe('')
        rmSync(path.join(box.state, 'drain.request'), { force: true })
        writeMachine(box, { availableMiB: 65536 })
        expect((await light.done).code).toBe(0)
        expect((await later.done).code).toBe(0)
        writeFileSync(releaseQuiet, '')
        expect((await quiet.done).code).toBe(0)
        expect(
          recordOf(box, 'measurement')!
            .jobsDuringRun.map((job) => job.label)
            .sort(),
        ).toEqual(['checked-light', 'later-light'])
      } finally {
        rmSync(path.join(box.state, 'drain.request'), { force: true })
        writeMachine(box, { availableMiB: 65536 })
        writeFileSync(releaseQuiet, '')
        await Promise.all([quiet.done, light?.done, later?.done])
      }
    },
    30_000,
  )

  test('a cancelled primary keeps its TERM result while its shim finishes accounting', async () => {
    const box = concurrentBox()
    const observer = createQuietObserver(box)
    if (observer.kind !== 'ready') expect.fail(observer.reason)
    const shim = path.join(observer.directory, 'scope.sh')
    writeFileSync(shim, readFileSync(shim, 'utf8').replace('scan TERM\n', 'sleep 1.5\nscan TERM\n'))
    const quiet = start(
      box,
      'cancelled-accounting',
      ['bash', '-c', 'echo started; exec sleep 60'],
      {
        quiet: true,
        jobClass: 'bench',
        machine: true,
        preload: observer.preload,
      },
    )
    try {
      await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
      expect(quiet.child.kill('SIGTERM')).toBe(true)
      const result = await quiet.done
      const snapshot = freezeQuietObserver(observer, 'failure')
      if (!('events' in snapshot)) expect.fail(snapshot.unavailable)
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({ kind: 'shell', phase: 'payload-return', status: 143 }),
      )
      expect(result.code).toBe(143)
      expect(recordOf(box, 'cancelled-accounting')).toMatchObject({
        exitCode: 143,
        leftoverProcesses: 0,
        quietHoldExpired: false,
      })
      expect(live(box.state, 'jobs')).toEqual([])
      const next = start(box, 'after-accounting', ['true'], {
        quiet: true,
        jobClass: 'bench',
        machine: true,
      })
      expect((await next.done).code).toBe(0)
    } finally {
      quiet.child.kill('SIGTERM')
      await quiet.done
    }
  }, 15_000)

  test.each(['expired', 'cancelled'])(
    'late light servers wait for %s holds and remain running through the next hold',
    async (mode) => {
      const box = concurrentBox(mode === 'expired' ? 2 : 600)
      const releaseServer = path.join(box.root, 'release-server')
      const observer = createQuietObserver(box)
      const quiet = start(box, 'expires', ['bash', '-c', 'echo started; exec sleep 60'], {
        quiet: true,
        jobClass: 'bench',
        machine: true,
        preload: observer.kind === 'ready' ? observer.preload : undefined,
      })
      let failed = false
      let server: ReturnType<typeof start> | undefined
      let cancellation: {
        readonly at: string
        readonly pid: number | undefined
        readonly sent: boolean
        readonly signal: 'SIGTERM'
      } | null = null
      try {
        await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
        server = start(
          box,
          'late-server',
          ['bash', '-c', `echo started; ${until(releaseServer)}`],
          {
            server: true,
            jobClass: 'light',
            machine: true,
          },
        )
        await expect.poll(server.stderr, { timeout: 10_000 }).toContain('quiet hold by')
        expect(server.stdout()).toBe('')
        if (mode === 'cancelled') {
          cancellation = {
            at: new Date().toISOString(),
            pid: quiet.child.pid,
            signal: 'SIGTERM',
            sent: quiet.child.kill('SIGTERM'),
          }
        }
        expect((await quiet.done).code).toBe(mode === 'expired' ? 75 : 143)
        const first = recordOf(box, 'expires')!
        expect(first.quietHoldExpired).toBe(mode === 'expired')
        expect(first.serversAtAdmission).toEqual([])
        expect(first.jobsDuringRun).toEqual([])
        await expect.poll(server.stdout, { timeout: 10_000 }).toContain('started')
        expect(live(box.state, 'jobs').map((job) => job.label)).toEqual(['late-server'])
        const next = start(box, 'next', ['true'], { quiet: true, jobClass: 'bench', machine: true })
        expect((await next.done).code).toBe(0)
        const second = recordOf(box, 'next')!
        expect(second.serversAtAdmission.map((job) => job.label)).toEqual(['late-server'])
        expect(second.jobsDuringRun).toHaveLength(1)
        expect(second.jobsDuringRun[0]).toMatchObject({
          label: 'late-server',
          server: true,
          endedAt: null,
        })
        writeFileSync(releaseServer, '')
        expect((await server.done).code).toBe(0)
        expect(recordOf(box, 'late-server')).toMatchObject({
          ceilingBytes: budget.ceilingMiB * 2 ** 20,
          server: true,
        })
        expect(live(box.state, 'jobs')).toEqual([])
      } catch (error) {
        failed = true
        const observation = freezeQuietObserver(observer, 'failure')
        console.error(
          '[quiet-concurrency-failure]',
          JSON.stringify({
            mode,
            cancellation,
            observation,
            receipt: quietFailureReceipt({ box, jobs: { measurement: quiet, server } }),
          }),
        )
        throw error
      } finally {
        quiet.child.kill('SIGTERM')
        writeFileSync(releaseServer, '')
        await Promise.all([quiet.done, server?.done])
        if (failed)
          console.error(
            '[quiet-observer-cleanup]',
            JSON.stringify(freezeQuietObserver(observer, 'cleanup')),
          )
      }
    },
    30_000,
  )
})
