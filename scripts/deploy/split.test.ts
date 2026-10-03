import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')

test('portable release and installation have separate commands', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  expect(scripts['build-release']).toBe('bun scripts/build-release.ts')
  expect(scripts['install-release']).toBe('bun scripts/install-release.ts')
  expect(scripts).not.toHaveProperty('deploy')
  expect(scripts.release).toContain('scripts/release/prepare.mjs')
  expect(scripts['version-packages']).toBe('changeset version && bun install --lockfile-only')
  expect(scripts).not.toHaveProperty('release:packages')
})

test('release help works with an empty HOME and no machine installation', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-release-help-'))
  const home = path.join(scratch, 'home')
  mkdirSync(home)
  try {
    const result = Bun.spawnSync(
      [process.execPath, path.join(root, 'scripts/build-release.ts'), '--help'],
      {
        env: {
          ...process.env,
          HOME: home,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'cache'),
        },
      },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toContain('--output')
    expect(result.stdout.toString()).toContain('--base')
    expect(readdirSync(home)).toEqual([])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('installing a release with no target refuses before effects with structured guidance', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-install-target-'))
  const home = path.join(scratch, 'home')
  mkdirSync(home)
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        path.join(root, 'scripts/install-release.ts'),
        '--from',
        path.join(scratch, 'absent'),
        '--server',
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'cache'),
        },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('developer.deployTarget')
    expect(result.stderr.toString()).toContain('Fix:')
    expect(readdirSync(home)).toEqual([])
    expect(existsSync(path.join(scratch, 'absent'))).toBe(false)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
