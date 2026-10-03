import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const bunAvailable = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0

it.skipIf(!bunAvailable)(
  'keeps inert attachment factory evaluations at the fresh handle budget (requires Bun)',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'extension-allocation-'))
    try {
      const result = spawnSync(
        'bun',
        [join(packageRoot, 'scripts/extension-allocation-counters.ts'), join(scratch, 'proof')],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          timeout: 20_000,
        },
      )
      expect(result.error, result.stderr).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(0)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
  30_000,
)
