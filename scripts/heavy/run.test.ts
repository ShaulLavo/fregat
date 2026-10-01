import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import type { HeavyJobRecord } from './record'

const RUN = path.join(import.meta.dirname, 'run.ts')
const MiB = 2 ** 20
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'heavy-run-'))
  roots.push(root)
  mkdirSync(path.join(root, 'locks'))
  return { locks: path.join(root, 'locks'), logs: path.join(root, 'logs'), root }
}

type Box = ReturnType<typeof sandbox>

function start(box: Box, label: string, command: readonly string[]) {
  const child = spawn(
    'bun',
    [RUN, '--lock-dir', box.locks, '--log-dir', box.logs, label, '--', ...command],
    { cwd: box.root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  let stdout = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  child.stdout.on('data', (chunk) => (stdout += chunk))
  const done = new Promise<{ code: number | null; stderr: string }>((resolve) =>
    child.on('close', (code) => resolve({ code, stderr })),
  )
  return { child, done, stdout: () => stdout }
}

function heavy(box: Box, label: string, command: readonly string[]) {
  return start(box, label, command).done
}

function records(box: Box): HeavyJobRecord[] {
  return readdirSync(box.logs)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(path.join(box.logs, file), 'utf8').trim().split('\n'))
    .map((line) => JSON.parse(line) as HeavyJobRecord)
}

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
    expect(holders(box).every((line) => line === '')).toBe(true)
  })

  test('waits while another process holds all three slot locks, then runs', async () => {
    const box = sandbox()
    for (const slot of [1, 2, 3])
      writeFileSync(path.join(box.locks, `slot${slot}.lock`), '', { flag: 'a' })
    const hold = spawn(
      'flock',
      [
        path.join(box.locks, 'slot1.lock'),
        'flock',
        path.join(box.locks, 'slot2.lock'),
        'flock',
        path.join(box.locks, 'slot3.lock'),
        'sleep',
        '2',
      ],
      { stdio: 'ignore' },
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = await heavy(box, 'queued', ['true'])
    hold.kill()
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('all 3 slots busy')
    const [record] = records(box)
    expect(record?.queuedMs).toBeGreaterThanOrEqual(1_500)
    expect(record?.slot).toBeGreaterThanOrEqual(1)
  }, 20_000)

  test('writes the holder line in the format status.sh reads, and clears it after', async () => {
    const box = sandbox()
    const job = start(box, 'holder', ['sleep', '1'])
    await expect.poll(() => holders(box).some((line) => line.startsWith('holder '))).toBe(true)
    const line = holders(box).find((entry) => entry.startsWith('holder '))
    expect(line).toMatch(new RegExp(`^holder pid=\\d+ since=\\d\\d:\\d\\d:\\d\\d cwd=${box.root}$`))
    await job.done
    expect(holders(box).every((entry) => entry === '')).toBe(true)
  })
})

function holders(box: Box) {
  return [1, 2, 3].map((slot) => {
    try {
      return readFileSync(path.join(box.locks, `slot${slot}.holder`), 'utf8').trim()
    } catch {
      return ''
    }
  })
}
