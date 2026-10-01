import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import type { HeavyJobRecord } from './record'

const HERE = import.meta.dirname
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function bun(args: readonly string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn('bun', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('close', (code) => resolve({ code, stdout }))
  })
}

test.skipIf(!userScopes)(
  'ranks real jobs by peak memory, grouped by label',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'heavy-report-'))
    roots.push(root)
    mkdirSync(path.join(root, 'locks'))
    const dirs = [
      '--state-dir',
      path.join(root, 'locks'),
      '--log-dir',
      path.join(root, 'logs'),
      '--settings-home',
      root,
    ]
    const alloc = (mib: number) => ['bun', '-e', `Buffer.alloc(${mib} * 2 ** 20, 1)`]
    await bun([path.join(HERE, 'run.ts'), ...dirs, 'small', '--', ...alloc(10)], root)
    await bun([path.join(HERE, 'run.ts'), ...dirs, 'big', '--', ...alloc(150)], root)
    await bun([path.join(HERE, 'run.ts'), ...dirs, 'big', '--', ...alloc(150)], root)

    const byLabel = await bun(
      [
        path.join(HERE, 'report.ts'),
        '--log-dir',
        path.join(root, 'logs'),
        '--by',
        'label',
        '--json',
      ],
      root,
    )
    expect(byLabel.code).toBe(0)
    const rows = JSON.parse(byLabel.stdout) as { key: string; jobs: number; peakMaxBytes: number }[]
    expect(rows.map((row) => [row.key, row.jobs])).toEqual([
      ['big', 2],
      ['small', 1],
    ])
    expect(rows[0]!.peakMaxBytes).toBeGreaterThanOrEqual(150 * 2 ** 20)

    const table = await bun(
      [path.join(HERE, 'report.ts'), '--log-dir', path.join(root, 'logs'), '--by', 'command'],
      root,
    )
    expect(table.stdout.split('\n')[1]).toMatch(/heavy-report-\w+\$ bun -e 'Buffer.alloc\(150/)
  },
  30_000,
)

type Row = {
  key: string
  jobs: number
  unmeasuredJobs: number
  peakMaxBytes: number | null
  peakMedianBytes: number | null
  cpuSeconds: number | null
  oomKills: number | null
}

let sequence = 0

function job(fields: Partial<HeavyJobRecord>): HeavyJobRecord {
  sequence += 1
  return {
    action: 'heavy.job',
    admission: 'no heavy job is running',
    area: 'heavy-jobs',
    ceilingBytes: 7 * 2 ** 30,
    class: 'suite',
    command: ['bun', 'run', 'test'],
    commitHash: 'c'.repeat(40),
    cpuUsageUsec: 1_000_000,
    cwd: '/work/worktrees/platform/lane-a',
    estimateBytes: 3 * 2 ** 30,
    exitCode: 0,
    host: 'local',
    label: 'suite',
    leftoverProcesses: 0,
    level: 'info',
    memoryPeakBytes: 2 ** 30,
    oomKills: 0,
    queuedMs: 0,
    quiet: false,
    quietHoldExpired: false,
    repo: '/work/projects/platform',
    requestId: String(sequence),
    source: 'heavy',
    subdir: '',
    slice: `heavy-${sequence}.slice`,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    unit: `heavy-${sequence}.scope`,
    version: 'c'.repeat(9),
    wallMs: 1_000,
    ...fields,
  }
}

async function reportOver(records: readonly HeavyJobRecord[], by: 'command' | 'label') {
  const root = mkdtempSync(path.join(tmpdir(), 'heavy-report-fixture-'))
  roots.push(root)
  const day = new Date().toISOString().slice(0, 10)
  writeFileSync(
    path.join(root, `${day}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  const json = await bun(
    [path.join(HERE, 'report.ts'), '--log-dir', root, '--by', by, '--json'],
    root,
  )
  const table = await bun([path.join(HERE, 'report.ts'), '--log-dir', root, '--by', by], root)
  expect(json.code).toBe(0)
  return { rows: JSON.parse(json.stdout) as Row[], table: table.stdout }
}

test('keeps the same command in different repositories apart, and lanes of one repository together', async () => {
  const { rows } = await reportOver(
    [
      job({ cwd: '/work/worktrees/platform/lane-a', repo: '/work/projects/platform' }),
      job({ cwd: '/work/worktrees/platform/lane-c', repo: '/work/projects/platform' }),
      job({ cwd: '/work/worktrees/mesh/lane-b', repo: '/work/projects/mesh' }),
    ],
    'command',
  )
  expect(rows.map((row) => [row.key, row.jobs]).toSorted()).toEqual([
    ['/work/projects/mesh$ bun run test', 1],
    ['/work/projects/platform$ bun run test', 2],
  ])
})

test('keeps argv boundaries: one argument with a space is not two arguments', async () => {
  const { rows } = await reportOver(
    [job({ command: ['printf', '%s', 'a b'] }), job({ command: ['printf', '%s', 'a', 'b'] })],
    'command',
  )
  expect(rows.map((row) => row.key).toSorted()).toEqual([
    "/work/projects/platform$ printf %s 'a b'",
    '/work/projects/platform$ printf %s a b',
  ])
})

test('groups by repository subdirectory when the job ran below the root', async () => {
  const { rows } = await reportOver([job({ subdir: 'packages/contracts' })], 'command')
  expect(rows[0]?.key).toBe('/work/projects/platform/packages/contracts$ bun run test')
})

test('reports unmeasured jobs as unknown, never as zero', async () => {
  const unmeasured = { cpuUsageUsec: null, exitCode: 137, memoryPeakBytes: null, oomKills: null }
  const { rows, table } = await reportOver(
    [
      job({ label: 'killed', ...unmeasured }),
      job({ label: 'partial', memoryPeakBytes: 3 * 2 ** 30, oomKills: 1 }),
      job({ label: 'partial', ...unmeasured }),
    ],
    'label',
  )
  const killed = rows.find((row) => row.key === 'killed')
  const partial = rows.find((row) => row.key === 'partial')
  expect(killed).toMatchObject({
    cpuSeconds: null,
    jobs: 1,
    oomKills: null,
    peakMaxBytes: null,
    peakMedianBytes: null,
    unmeasuredJobs: 1,
  })
  expect(partial).toMatchObject({
    jobs: 2,
    oomKills: 1,
    peakMaxBytes: 3 * 2 ** 30,
    unmeasuredJobs: 1,
  })
  const killedLine = table.split('\n').find((line) => line.endsWith('killed'))
  const partialLine = table.split('\n').find((line) => line.endsWith('partial'))
  expect(killedLine).toMatch(/^\s*\?\s+\?\s+\?/)
  expect(partialLine).toContain('≥3.00G')
  expect(partialLine).toMatch(/\b1\+\s/)
})
