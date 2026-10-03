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
        expect(result.code).toBe(quiet ? 75 : 0)
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

  test('a quiet hold ends even while its wrapper is suspended', async () => {
    const box = quietBox(600)
    const elapsed = path.join(box.root, 'elapsed')
    const preload = path.join(box.root, 'clock.ts')
    writeFileSync(elapsed, '0')
    writeFileSync(
      preload,
      `
      import { readFileSync } from 'node:fs'
      const now = performance.now.bind(performance)
      Object.defineProperty(performance, 'now', {
        value: () => now() + Number(readFileSync(${JSON.stringify(elapsed)}, 'utf8')),
      })
    `,
    )
    const quiet = start(box, 'frozen', sleeper(60), {
      jobClass: 'light',
      machine: true,
      quiet: true,
      preload,
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
    expect(runtime.stdout.toString().trim()).toBe('10min')
    quiet.child.kill('SIGSTOP')
    try {
      await expect
        .poll(() => readFileSync(`/proc/${quiet.child.pid}/status`, 'utf8'), {
          timeout: 10_000,
        })
        .toMatch(/^State:\s+T/m)
      // Inject the watchdog's stop and advance both clocks while the wrapper cannot run.
      writeFileSync(elapsed, '601000')
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
      const next = await heavy(box, 'after-frozen', ['true'], { jobClass: 'light', machine: true })
      expect(next.code).toBe(0)
      expect(sliceState(box.sliceRoot, slice)).not.toBe('running')
    } finally {
      quiet.child.kill('SIGCONT')
    }
    expect((await quiet.done).code).toBe(75)
    expect(recordOf(box, 'frozen')).toMatchObject({ quiet: true, quietHoldExpired: true })
    expect(unitActive(slice)).toBe(false)
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  }, 40_000)

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
