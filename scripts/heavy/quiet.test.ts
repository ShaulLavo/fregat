import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import {
  endedAt,
  heavy,
  recordOf,
  records,
  removeSandboxes,
  sandbox,
  start,
  startedAt,
  userScopes,
  writeSettings,
} from './sandbox'

afterEach(removeSandboxes)

const RUN = path.join(import.meta.dirname, 'run.ts')
const light = { ceilingMiB: 1024, estimateMiB: 64 }
const classes = { bench: light, browser: light, build: light, light, suite: light }

function quietBox(holdSeconds: number) {
  const box = sandbox()
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
    const box = quietBox(30)
    const running = start(box, 'running', sleeper(2), { jobClass: 'light' })
    await expect.poll(running.stdout, { timeout: 10_000 }).toContain('started')
    const quiet = start(box, 'quiet', sleeper(2), { jobClass: 'light', quiet: true })
    await expect.poll(quiet.stderr, { timeout: 10_000 }).toContain('waiting for 1 running job')
    const behind = start(box, 'behind', ['true'], { jobClass: 'light' })
    await expect.poll(behind.stderr, { timeout: 10_000 }).toContain('1 job(s) ahead in the queue')
    await Promise.all([running.done, quiet.done, behind.done])
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
    const quiet = start(box, 'long', sleeper(60), { jobClass: 'light', quiet: true })
    await expect.poll(quiet.stdout, { timeout: 10_000 }).toContain('started')
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toMatch(
      /^long pid=\d+ since=\d{4}-\d\d-\d\dT\S+ cwd=\S+\n$/,
    )
    const result = await quiet.done
    expect(result.code).toBe(75)
    expect(result.stderr).toContain("quiet hold for 'long' reached its 2 s limit")
    expect(result.stderr).toContain('Run it again to queue for another hold')
    expect(recordOf(box, 'long')).toMatchObject({ quiet: true, quietHoldExpired: true })
    expect(recordOf(box, 'long')!.wallMs).toBeLessThan(10_000)
    expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  }, 30_000)

  test('quiet measurements and suites in two loops both make progress', async () => {
    const box = quietBox(2)
    const until = Date.now() + 20_000
    const loop = async (label: string, command: readonly string[], quiet: boolean) => {
      let runs = 0
      while (Date.now() < until) {
        await heavy(box, `${label}-${runs}`, command, { jobClass: 'light', quiet })
        runs += 1
      }
      return runs
    }
    const [quietRuns, suiteRuns] = await Promise.all([
      loop('quiet', ['sleep', '5'], true),
      loop('suite', ['sleep', '1'], false),
    ])
    const admitted = (prefix: string) =>
      records(box).filter((record) => record.label.startsWith(prefix)).length
    expect(quietRuns).toBeGreaterThanOrEqual(2)
    expect(admitted('quiet-')).toBe(quietRuns)
    expect(suiteRuns).toBeGreaterThanOrEqual(2)
    expect(admitted('suite-')).toBe(suiteRuns)
    const suiteWaits = records(box)
      .filter((record) => record.label.startsWith('suite-'))
      .map((record) => record.queuedMs)
    // One hold (2 s) plus the drain of one suite (1 s), the stop grace (1 s) and polling.
    expect(Math.max(...suiteWaits)).toBeLessThan(7_000)
  }, 60_000)

  test('a drain request older than one hold is ignored', async () => {
    const box = quietBox(2)
    const since = new Date(Date.now() - 60_000).toISOString()
    writeFileSync(
      path.join(box.state, 'drain.request'),
      `pid=${process.pid} since=${since} holder=stale`,
    )
    const result = await heavy(box, 'free', ['true'], { jobClass: 'light' })
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('draining')
  }, 30_000)

  test('another tool holding all three slot locks is an unbounded hold that status reports with its age', async () => {
    const box = quietBox(2)
    const slot = (n: number) => path.join(box.state, `slot${n}.lock`)
    for (const n of [1, 2, 3]) writeFileSync(slot(n), '', { flag: 'a' })
    const tool = spawn('flock', [slot(1), 'flock', slot(2), 'flock', slot(3), 'sleep', '4'], {
      stdio: 'ignore',
    })
    const toolDone = new Promise((resolve) => tool.on('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const waiting = start(box, 'waits', ['true'], { jobClass: 'light' })
    await expect.poll(waiting.stderr, { timeout: 10_000 }).toContain('quiet hold by another tool')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
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
    await toolDone
    expect((await waiting.done).code).toBe(0)
    expect(existsSync(path.join(box.state, 'legacy-hold.since'))).toBe(false)
  }, 30_000)
})

test('--quiet applies to this machine only', () => {
  const result = spawnSync(process.execPath, [RUN, '--quiet', '--host', 'pi', 'q', '--', 'true'], {
    encoding: 'utf8',
  })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('--quiet applies to this machine')
})
