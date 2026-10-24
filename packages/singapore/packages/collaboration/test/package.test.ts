import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const entry = new URL('../dist/index.js', import.meta.url)

test.skipIf(!existsSync(entry))(
  'built session entry loads without browser or stylesheet loaders',
  () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const { Session, createCollaborationPlugin } = await import(${JSON.stringify(entry.href)}); console.log(typeof Session, typeof createCollaborationPlugin)`,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('function function')
  },
)
