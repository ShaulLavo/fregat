import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    const behind = start(box, 'behind', ['true'], { jobClass: 'light', machine: true })
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

  test('waiting light jobs get a turn between consecutive quiet holds', async () => {
    const box = quietBox(600)
    const releaseQuiet = path.join(box.root, 'release-first')
    const releaseLight = path.join(box.root, 'release-light')
    const first = start(
      box,
      'first-quiet',
      ['bash', '-c', `echo started; ${until(releaseQuiet)}`],
      {
        jobClass: 'light',
        machine: true,
        quiet: true,
      },
    )
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    const second = start(box, 'second-quiet', ['true'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    await expect
      .poll(() => live(box.state, 'queue').map((entry) => entry.label))
      .toEqual(['second-quiet'])
    const lightJob = start(box, 'between', ['bash', '-c', `echo started; ${until(releaseLight)}`], {
      jobClass: 'light',
      machine: true,
    })
    await expect
      .poll(() => live(box.state, 'queue').map((entry) => entry.label))
      .toEqual(['second-quiet', 'between'])
    expect(lightJob.stdout()).toBe('')
    writeFileSync(releaseQuiet, '')
    expect((await first.done).code).toBe(0)
    await expect.poll(lightJob.stdout, { timeout: 10_000 }).toContain('started')
    expect(recordOf(box, 'second-quiet')).toBeUndefined()
    const late = start(box, 'late-arrival', ['true'], { jobClass: 'light', machine: true })
    await expect
      .poll(() => live(box.state, 'queue').map((entry) => entry.label))
      .toEqual(['second-quiet', 'late-arrival'])
    expect(recordOf(box, 'late-arrival')).toBeUndefined()
    writeFileSync(releaseLight, '')
    expect((await lightJob.done).code).toBe(0)
    expect((await second.done).code).toBe(0)
    expect((await late.done).code).toBe(0)
    expect(startedAt(recordOf(box, 'late-arrival'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'second-quiet')),
    )
    expect(startedAt(recordOf(box, 'between'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'first-quiet')),
    )
    expect(startedAt(recordOf(box, 'second-quiet'))).toBeGreaterThanOrEqual(
      endedAt(recordOf(box, 'between')),
    )
  }, 40_000)

  test('queue wait longer than max-wall still leaves the full running-time allowance', async () => {
    const box = quietBox(600)
    const request = path.join(box.state, 'drain.request')
    writeFileSync(request, `pid=${process.pid} holder=deadline-test`)
    const job = start(box, 'wait-then-run', ['bash', '-c', 'echo started; sleep 0.2'], {
      jobClass: 'light',
      machine: true,
      maxWallSec: 1,
    })
    await expect.poll(job.stderr, { timeout: 10_000 }).toContain('draining for')
    await expect
      .poll(
        () => {
          const entry = live(box.state, 'queue')[0]
          return entry ? Date.now() - Date.parse(entry.since) : 0
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(1_200)
    expect(job.stdout()).toBe('')
    rmSync(request)
    const result = await job.done
    expect(result.code, result.stderr).toBe(0)
    expect(job.stdout()).toContain('started')
    expect(recordOf(box, 'wait-then-run')!.queuedMs).toBeGreaterThan(1_000)
    expect(recordOf(box, 'wait-then-run')!.wallMs).toBeLessThan(1_000)
  }, 30_000)

  test('max-wall stops running work and preserves the shorter quiet-hold maximum', async () => {
    const box = quietBox(2)
    const limited = await heavy(box, 'running-limit', sleeper(60), {
      jobClass: 'light',
      machine: true,
      maxWallSec: 1,
    })
    expect(limited.code).toBe(124)
    expect(limited.stderr).toContain('queue wait is unlimited and excluded')
    expect(recordOf(box, 'running-limit')).toMatchObject({ exitCode: 124, quietHoldExpired: false })
    expect(unitActive(recordOf(box, 'running-limit')!.slice!)).toBe(false)
    const quiet = await heavy(box, 'shorter-hold', sleeper(60), {
      jobClass: 'light',
      machine: true,
      quiet: true,
      maxWallSec: 60,
    })
    expect(quiet.code).toBe(75)
    expect(recordOf(box, 'shorter-hold')).toMatchObject({ quietHoldExpired: true })
  }, 30_000)

  test('a shorter hard deadline keeps its reason through quiet teardown', async () => {
    const box = quietBox(2)
    const result = await heavy(
      box,
      'shorter-wall',
      ['bash', '-c', 'trap "" TERM; echo started; while :; do sleep 1; done'],
      {
        jobClass: 'light',
        machine: true,
        quiet: true,
        maxWallSec: 1,
      },
    )
    expect(result.code, result.stderr).toBe(124)
    expect(result.stderr).not.toContain('quiet hold for')
    expect(recordOf(box, 'shorter-wall')).toMatchObject({ exitCode: 124, quietHoldExpired: false })
  }, 30_000)

  test('a long max-wall allowance uses the scope watchdog without overflowing a JS timer', async () => {
    const box = quietBox(600)
    const result = await heavy(box, 'long-allowance', ['bash', '-c', 'sleep 0.2; echo finished'], {
      jobClass: 'light',
      machine: true,
      maxWallSec: 2_592_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).not.toContain('TimeoutOverflowWarning')
    expect(recordOf(box, 'long-allowance')).toMatchObject({ exitCode: 0 })
  }, 30_000)

  test('a failed fairness snapshot preserves the job result and releases its admission', async () => {
    const box = quietBox(600)
    const releaseJob = path.join(box.root, 'release-job')
    const quiet = start(
      box,
      'snapshot-fails',
      ['bash', '-c', `echo started; ${until(releaseJob)}`],
      {
        jobClass: 'light',
        machine: true,
        quiet: true,
      },
    )
    await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
    mkdirSync(path.join(box.state, 'quiet.turn.partial'))
    writeFileSync(releaseJob, '')
    const result = await quiet.done
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toContain('could not save fair turn')
    expect(live(box.state, 'jobs')).toEqual([])
    for (const slot of ['slot1.lock', 'slot2.lock', 'slot3.lock']) {
      const fd = tryLock(path.join(box.state, slot))
      expect(fd).not.toBeNull()
      if (fd !== null) unlock(fd)
    }
    expect(
      (await heavy(box, 'after-failed-snapshot', ['true'], { jobClass: 'light', machine: true }))
        .code,
    ).toBe(0)
  }, 30_000)

  test.each(['', '{', '{"quietId":"aaaaaaaaaaaa","waitingIds":5}', '{"quietId":null}'])(
    'invalid advisory turn metadata leaves FIFO admission available (%s)',
    async (metadata) => {
      const box = quietBox(600)
      writeFileSync(path.join(box.state, 'quiet.turn'), metadata)
      const result = await heavy(box, 'bad-metadata', ['true'], {
        jobClass: 'light',
        machine: true,
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stderr).toContain('ignored invalid fair-turn metadata')
      expect(existsSync(path.join(box.state, 'quiet.turn'))).toBe(false)
    },
    30_000,
  )

  test('unreadable advisory turn metadata preserves admission and quiet completion', async () => {
    const box = quietBox(600)
    mkdirSync(path.join(box.state, 'quiet.turn'))
    const result = await heavy(box, 'unreadable-turn', ['true'], {
      jobClass: 'light',
      machine: true,
      quiet: true,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toContain('could not read fair turn')
    expect(result.stderr).toContain('could not remove fair turn')
    expect(live(box.state, 'jobs')).toEqual([])
    for (const slot of ['slot1.lock', 'slot2.lock', 'slot3.lock']) {
      const fd = tryLock(path.join(box.state, slot))
      expect(fd).not.toBeNull()
      if (fd !== null) unlock(fd)
    }
    expect(
      (await heavy(box, 'after-unreadable-turn', ['true'], { jobClass: 'light', machine: true }))
        .code,
    ).toBe(0)
  }, 30_000)

  test.each([0, 7])(
    'completion observed after the deadline preserves the command exit code (%s)',
    async (exitCode) => {
      const box = quietBox(600)
      const finished = path.join(box.root, 'finished')
      const releaseCommand = path.join(box.root, 'release-command')
      const job = start(
        box,
        'delayed-observation',
        [
          'bash',
          '-c',
          `echo started; ${until(releaseCommand)}; touch ${JSON.stringify(finished)}; exit ${exitCode}`,
        ],
        { jobClass: 'light', machine: true, maxWallSec: 1 },
      )
      await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
      job.child.kill('SIGSTOP')
      try {
        await expect
          .poll(() => readFileSync(`/proc/${job.child.pid}/status`, 'utf8'), { timeout: 10_000 })
          .toMatch(/^State:\s+T/m)
        writeFileSync(releaseCommand, '')
        await expect.poll(() => existsSync(finished), { timeout: 10_000 }).toBe(true)
        const owner = live(box.state, 'jobs').find(
          (entry) => entry.label === 'delayed-observation',
        )!
        const scope = `${box.sliceRoot}-${owner.id}.scope`
        await expect.poll(() => unitActive(scope), { timeout: 10_000 }).toBe(false)
        await expect
          .poll(() => Date.now() - Date.parse(owner.since), { timeout: 10_000 })
          .toBeGreaterThan(2200)
      } finally {
        job.child.kill('SIGCONT')
      }
      const result = await job.done
      expect(result.code, result.stderr).toBe(exitCode)
      expect(result.stderr).not.toContain('--max-wall limit')
      expect(recordOf(box, 'delayed-observation')).toMatchObject({ exitCode })
    },
    30_000,
  )

  test('a quiet launch delayed beyond its admitted budget cannot overlap ordinary work', async () => {
    const box = quietBox(600)
    const paused = path.join(box.root, 'paused')
    const launched = path.join(box.root, 'launched')
    const releaseOrdinary = path.join(box.root, 'release-ordinary')
    const preload = path.join(box.root, 'pause-launch.ts')
    writeFileSync(
      preload,
      `
      import { writeFileSync } from 'node:fs'
      const spawn = Bun.spawnSync.bind(Bun)
      Bun.spawnSync = (...args) => {
        if (Array.isArray(args[0]) && args[0].includes('set-property')) {
          writeFileSync(${JSON.stringify(paused)}, '')
          process.kill(process.pid, 'SIGSTOP')
        }
        return spawn(...args)
      }
    `,
    )
    const quiet = start(box, 'late-launch', ['touch', launched], {
      jobClass: 'light',
      machine: true,
      quiet: true,
      maxWallSec: 1,
      preload,
    })
    await expect.poll(() => existsSync(paused), { timeout: 10_000 }).toBe(true)
    try {
      const ordinary = start(
        box,
        'ordinary-after-lease',
        ['bash', '-c', `echo started; ${until(releaseOrdinary)}`],
        {
          jobClass: 'light',
          machine: true,
        },
      )
      await expect.poll(ordinary.stdout, { timeout: 15_000 }).toContain('started')
      quiet.child.kill('SIGCONT')
      const result = await quiet.done
      expect(result.code, result.stderr).toBe(124)
      expect(existsSync(launched)).toBe(false)
      expect(recordOf(box, 'late-launch')).toMatchObject({ exitCode: 124, quietHoldExpired: false })
      expect(recordOf(box, 'ordinary-after-lease')).toBeUndefined()
      writeFileSync(releaseOrdinary, '')
      expect((await ordinary.done).code).toBe(0)
    } finally {
      quiet.child.kill('SIGCONT')
      writeFileSync(releaseOrdinary, '')
    }
  }, 30_000)

  test('explicit cancellation reaches a live shim after its accounting file opens', async () => {
    const box = quietBox(600)
    const bin = path.join(box.root, 'bin')
    const marker = path.join(box.root, 'accounting-open')
    const releaseAccounting = path.join(box.root, 'release-accounting')
    mkdirSync(bin)
    const cat = path.join(bin, 'cat')
    writeFileSync(
      cat,
      `#!/usr/bin/env bash
      case "$1" in
        */memory.peak)
          touch ${JSON.stringify(marker)}
          ${until(releaseAccounting)}
          ;;
      esac
      command -p cat "$@"
    `,
    )
    chmodSync(cat, 0o755)
    const job = start(box, 'cancel-accounting', ['true'], {
      jobClass: 'light',
      machine: true,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    try {
      await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)
      job.child.kill('SIGTERM')
      await expect.poll(() => recordOf(box, 'cancel-accounting'), { timeout: 10_000 }).toBeDefined()
      const result = await job.done
      expect(result.code).toBe(0)
      expect(existsSync(releaseAccounting)).toBe(false)
      expect(live(box.state, 'jobs')).toEqual([])
    } finally {
      writeFileSync(releaseAccounting, '')
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
    const box = quietBox(2)
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
    const box = quietBox(2)
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
    const duration = /^(\d+(?:\.\d+)?)(ms|us|s)$/.exec(runtime.stdout.toString().trim())
    expect(duration).not.toBeNull()
    const divisor = { s: 1, ms: 1_000, us: 1_000_000 }
    const scopeLimit = Number(duration![1]) / divisor[duration![2] as keyof typeof divisor]
    expect(scopeLimit).toBeGreaterThan(0)
    expect(scopeLimit).toBeLessThanOrEqual(2)
    quiet.child.kill('SIGSTOP')
    try {
      await expect
        .poll(() => readFileSync(`/proc/${quiet.child.pid}/status`, 'utf8'), {
          timeout: 10_000,
        })
        .toMatch(/^State:\s+T/m)
      await expect.poll(() => unitActive(scope), { timeout: 10_000 }).toBe(false)
      const result = spawnSync('systemctl', ['--user', 'show', scope, '-p', 'Result', '--value'])
      expect(result.stdout.toString().trim()).toBe('timeout')
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

test('--quiet applies to this machine only', () => {
  const result = spawnSync(process.execPath, [RUN, '--quiet', '--host', 'pi', 'q', '--', 'true'], {
    encoding: 'utf8',
  })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('--quiet applies to this machine')
})
