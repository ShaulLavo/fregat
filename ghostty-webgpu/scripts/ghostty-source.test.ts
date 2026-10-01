import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { GHOSTTY_SOURCE_REVISION } from '../src/core/version.js'

let source: string | undefined

afterEach(() => {
  if (source) rmSync(source, { recursive: true, force: true })
  source = undefined
})

function git(args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function checkout(): string {
  source = mkdtempSync(join(tmpdir(), 'ghostty-source-test-'))
  git(['init', '-q'])
  writeFileSync(join(source, 'input.h'), 'pinned input\n')
  git(['add', 'input.h'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'Fixture',
  ])
  return source
}

function checkClean(path: string) {
  const script = join(import.meta.dirname, 'ghostty-source.ts')
  return spawnSync(
    'bun',
    [
      '--eval',
      `import { verifyCleanSource } from ${JSON.stringify(script)}; await verifyCleanSource(${JSON.stringify(path)})`,
    ],
    { encoding: 'utf8' },
  )
}

it('rejects an unpinned bridge source before invoking Zig', () => {
  const path = checkout()
  const revision = git(['rev-parse', 'HEAD'])
  const result = spawnSync(
    'bun',
    [join(import.meta.dirname, 'build-bridge.ts'), '--source', path, '--zig', 'zig-must-not-run'],
    { encoding: 'utf8' },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(
    `Expected Ghostty ${GHOSTTY_SOURCE_REVISION}, received ${revision}`,
  )
  expect(result.stderr).not.toContain('zig-must-not-run')
})

it('accepts a clean source tree', () => {
  const result = checkClean(checkout())
  expect(result.status, result.stderr).toBe(0)
})

it.each(['tracked', 'staged', 'untracked'])('rejects %s changes to source inputs', (kind) => {
  const path = checkout()
  writeFileSync(join(path, kind === 'untracked' ? 'extra.h' : 'input.h'), 'changed input\n')
  if (kind === 'staged') git(['add', 'input.h'])
  const result = checkClean(path)
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Ghostty source tree must be clean to build pinned artifacts')
})
