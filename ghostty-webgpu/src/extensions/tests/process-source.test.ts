import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const runner = fileURLToPath(
  new URL('../../../../scripts/ghostty-x6-in-process.ts', import.meta.url),
)
const bunAvailable = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0
const nodeAvailable = spawnSync('node', ['--version'], { encoding: 'utf8' }).status === 0

it.skipIf(!existsSync(runner) || !bunAvailable || !nodeAvailable)(
  'checks exact actual-main in-process counters (requires Bun, Node and Fregat source tooling)',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'extension-process-'))
    try {
      const tools = spawnSync(
        'bun',
        [
          '--bun',
          'vitest',
          'run',
          'ghostty-x6-source-ledger.test.ts',
          'ghostty-x6-statistics.test.ts',
        ],
        {
          cwd: dirname(runner),
          encoding: 'utf8',
          timeout: 10_000,
        },
      )
      expect(tools.error, tools.stderr).toBeUndefined()
      expect(tools.status, tools.stdout + tools.stderr).toBe(0)
      const result = spawnSync('bun', [runner, join(scratch, 'proof')], {
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.error, result.stderr).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(0)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
  40_000,
)
