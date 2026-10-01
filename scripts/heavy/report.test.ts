import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

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
    const dirs = ['--lock-dir', path.join(root, 'locks'), '--log-dir', path.join(root, 'logs')]
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
    expect(table.stdout.split('\n')[1]).toMatch(/heavy-report-\w+\$ bun -e Buffer.alloc\(150/)
  },
  30_000,
)
