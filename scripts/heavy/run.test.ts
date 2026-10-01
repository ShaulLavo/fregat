import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import {
  alive,
  type Box,
  heavy,
  MiB,
  records,
  removeSandboxes,
  sandbox,
  start,
  unitActive,
  userScopes,
} from './sandbox'

afterEach(removeSandboxes)

const RUN = path.join(import.meta.dirname, 'run.ts')

const allocate = (mib: number) =>
  ['bun', '-e', `const b = Buffer.alloc(${mib} * 2 ** 20, 1); console.log(b.length)`] as const
const spin = (ms: number) =>
  ['bun', '-e', `const end = Date.now() + ${ms}; let n = 0; while (Date.now() < end) n++`] as const

describe.skipIf(!userScopes)('a job run through the wrapper', () => {
  test('records the peak memory and CPU time of its own cgroup scope', async () => {
    const box = sandbox()
    const result = await heavy(box, 'alloc-220', allocate(220))
    expect(result.code).toBe(0)

    const [record] = records(box)
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(200 * MiB)
    expect(record?.cpuUsageUsec).toBeGreaterThan(0)
    expect(record).toMatchObject({
      area: 'heavy-jobs',
      command: [...allocate(220)],
      cwd: box.root,
      exitCode: 0,
      host: 'local',
      label: 'alloc-220',
      level: 'info',
      oomKills: 0,
      source: 'heavy',
    })
    expect(record?.unit).toMatch(/^heavy-[0-9a-f]+\.scope$/)
    expect(record?.commitHash).toMatch(/^[0-9a-f]{40}$/)
  })

  test('counts CPU time across the whole job and wall time from launch to exit', async () => {
    const box = sandbox()
    await heavy(box, 'spin', spin(600))
    const [record] = records(box)
    expect(record?.cpuUsageUsec).toBeGreaterThanOrEqual(500_000)
    expect(record?.wallMs).toBeGreaterThanOrEqual(600)
    expect(record?.memoryPeakBytes).toBeLessThan(200 * MiB)
  })

  test('exits with the command exit code and records it', async () => {
    const box = sandbox()
    const result = await heavy(box, 'fails', ['bash', '-c', 'exit 3'])
    expect(result.code).toBe(3)
    expect(records(box)[0]?.exitCode).toBe(3)
  })

  test('keeps secrets out of the recorded command', async () => {
    const box = sandbox()
    await heavy(box, 'secret', [
      'env',
      'API_TOKEN=hunter2hunter2',
      'true',
      '--password',
      'swordfish',
    ])
    const line = readdirSync(box.logs).map((file) =>
      readFileSync(path.join(box.logs, file), 'utf8'),
    )
    expect(line.join('')).not.toMatch(/hunter2|swordfish/)
    expect(records(box)[0]?.command).toEqual([
      'env',
      'API_TOKEN=<redacted>',
      'true',
      '--password',
      '<redacted>',
    ])
  })

  test('stops the job and still records it when the wrapper is terminated', async () => {
    const box = sandbox()
    const job = start(box, 'stopped', ['bash', '-c', 'echo started; exec sleep 30'])
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    job.child.kill('SIGTERM')
    const result = await job.done
    expect(result.code).toBe(143)
    const [record] = records(box)
    expect(record).toMatchObject({ exitCode: 143, label: 'stopped' })
    expect(record?.wallMs).toBeLessThan(10_000)
    expect(record?.memoryPeakBytes).toBeGreaterThan(0)
    expect(runningEntries(box)).toEqual([])
  })

  test('stops processes the command left running before it records and leaves the running set', async () => {
    const box = sandbox()
    const job = start(box, 'forks', ['bash', '-c', 'sleep 30 & echo $!'])
    const result = await job.done
    expect(result.code).toBe(0)
    const orphan = Number(job.stdout().trim())
    expect(alive(orphan)).toBe(false)
    const [record] = records(box)
    expect(record).toMatchObject({ exitCode: 0, label: 'forks', leftoverProcesses: 1 })
    expect(record?.wallMs).toBeLessThan(10_000)
    expect(unitActive(record!.unit)).toBe(false)
    expect(runningEntries(box)).toEqual([])
  })

  test('counts the memory of a leftover process in the job', async () => {
    const box = sandbox()
    const hold = `const b = Buffer.alloc(150 * 2 ** 20, 1); await Bun.sleep(30_000)`
    await heavy(box, 'forked-alloc', ['bash', '-c', `bun -e '${hold}' & sleep 1.5`])
    const [record] = records(box)
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(150 * MiB)
    expect(record?.leftoverProcesses).toBe(1)
  })

  test('a SIGINT sent to the wrapper PID stops the job and records it', async () => {
    const box = sandbox()
    const job = start(box, 'int-pid', ['bash', '-c', 'echo started; exec sleep 30'])
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    job.child.kill('SIGINT')
    const result = await job.done
    expect(result.code).toBe(130)
    expect(records(box)[0]).toMatchObject({ exitCode: 130, label: 'int-pid' })
    expect(records(box)[0]?.wallMs).toBeLessThan(10_000)
  })

  test('Ctrl-C to the whole foreground process group stops the job and records it', async () => {
    const box = sandbox()
    const job = start(box, 'int-group', ['bash', '-c', 'echo started; exec sleep 30'], {
      detached: true,
    })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    process.kill(-job.child.pid!, 'SIGINT')
    const result = await job.done
    expect(result.code).toBe(130)
    expect(records(box)[0]).toMatchObject({ exitCode: 130, label: 'int-group' })
  })

  test('a settings read failure is reported and the command exit status still wins', async () => {
    const box = sandbox()
    mkdirSync(path.join(box.home, 'settings.json'))
    const result = await heavy(box, 'no-settings', ['true'], { logDir: false })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('using the default developer.heavyJobClasses')
    expect(result.stderr).toContain('record was not written')
  })

  test('waits while another process holds all three slot locks, then runs', async () => {
    const box = sandbox()
    const slot = (n: number) => path.join(box.state, `slot${n}.lock`)
    for (const n of [1, 2, 3]) writeFileSync(slot(n), '', { flag: 'a' })
    const hold = spawn('flock', [slot(1), 'flock', slot(2), 'flock', slot(3), 'sleep', '2'], {
      stdio: 'ignore',
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = await heavy(box, 'queued', ['true'])
    hold.kill()
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('slot1.lock is held exclusively')
    expect(records(box)[0]?.queuedMs).toBeGreaterThanOrEqual(1_500)
  }, 20_000)

  test('status lists a running job with its class and estimate', async () => {
    const box = sandbox()
    const job = start(box, 'listed', ['bash', '-c', 'echo started; sleep 2'], { jobClass: 'light' })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    const status = spawnSync('bun', [
      path.join(import.meta.dirname, 'status.ts'),
      '--state-dir',
      box.state,
    ])
    expect(status.stdout.toString()).toMatch(
      /running: 1\n {2}listed \(light, \d+ MiB\) \d+s pid=\d+/,
    )
    await job.done
  })
})

function runningEntries(box: Box) {
  const dir = path.join(box.state, 'jobs')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}

test('refuses --max-wall without --host pi, and a ceiling that is not whole seconds', () => {
  const label = 'ceiling-check'
  const wrapper = (flags: readonly string[]) =>
    spawnSync(process.execPath, [RUN, ...flags, label, '--', 'true'], { encoding: 'utf8' })
  const local = wrapper(['--max-wall', '60'])
  expect(local.status).toBe(2)
  expect(local.stderr).toContain('--max-wall applies to --host pi')
  const fraction = wrapper(['--host', 'pi', '--max-wall', '1.5'])
  expect(fraction.status).toBe(2)
  expect(fraction.stderr).toContain('positive whole number of seconds')
})
