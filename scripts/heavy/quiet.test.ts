import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

test('--quiet applies to this machine only', () => {
  const result = spawnSync(process.execPath, [RUN, '--quiet', '--host', 'pi', 'q', '--', 'true'], {
    encoding: 'utf8',
  })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('--quiet applies to this machine')
})
