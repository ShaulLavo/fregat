import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const script = path.join(import.meta.dirname, 'run-with-env.ts')

function childSees(args: readonly string[]) {
  const directory = mkdtempSync(path.join(tmpdir(), 'run-with-env-'))
  const out = path.join(directory, 'seen')
  const probe = `require('node:fs').writeFileSync(${JSON.stringify(out)}, String(process.env.PLATFORM_PRODUCTION_ROOT))`
  try {
    const result = spawnSync(process.execPath, [script, ...args, '-e', probe], {
      env: { ...process.env, PLATFORM_PRODUCTION_ROOT: '/srv/platform' },
    })
    expect(result.status).toBe(0)
    return readFileSync(out, 'utf8')
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('a dev process started from a production terminal does not inherit its root', () => {
  expect(childSees([])).toBe('undefined')
})

test('an explicit assignment still sets the root', () => {
  expect(childSees(['PLATFORM_PRODUCTION_ROOT=/work/tmp/root'])).toBe('/work/tmp/root')
})
