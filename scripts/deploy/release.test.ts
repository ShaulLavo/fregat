import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { porcelainPaths } from './release'

test('the first dirty path keeps its first letter', () => {
  expect(porcelainPaths(' M apps/server/src/index.ts\0?? plans/new.md\0')).toEqual([
    'apps/server/src/index.ts',
    'plans/new.md',
  ])
})

test('reads real git status, renames included', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-deploy-porcelain-'))
  try {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      return result.stdout.toString()
    }
    git('init', '-q')
    writeFileSync(path.join(root, 'apps.txt'), 'one\n')
    writeFileSync(path.join(root, 'old name.txt'), 'two\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
    writeFileSync(path.join(root, 'apps.txt'), 'changed\n')
    git('mv', 'old name.txt', 'new name.txt')
    writeFileSync(path.join(root, 'untracked.txt'), '')

    expect(porcelainPaths(git('status', '--porcelain', '-z')).toSorted()).toEqual([
      'apps.txt',
      'new name.txt',
      'untracked.txt',
    ])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
