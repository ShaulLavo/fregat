import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { webBase } from './config'
import { porcelainPaths, verifyCandidateFiles, type Release } from './release'

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

test('a candidate without the terminal host bundle fails verification', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-deploy-candidate-'))
  try {
    const web = path.join(directory, 'web')
    const server = path.join(directory, 'server')
    mkdirSync(path.join(web, 'assets'), { recursive: true })
    mkdirSync(path.join(server, 'runtime'), { recursive: true })
    writeFileSync(path.join(web, 'index.html'), `<script src="${webBase}assets/main.js"></script>`)
    writeFileSync(path.join(web, 'assets/editor.wasm'), '')
    for (const file of [
      'index.js',
      'remote-support.js',
      'watch-worker.ts',
      'runtime/package.json',
      'runtime/bun.lock',
    ])
      writeFileSync(path.join(server, file), '')
    const release: Release = { name: 'candidate', directory, web, server, previous: null }

    await expect(verifyCandidateFiles(release)).rejects.toThrow(
      'server/pty-host.js is missing; deploy with --server to rebuild the server',
    )
    writeFileSync(path.join(server, 'pty-host.js'), '')
    await expect(verifyCandidateFiles(release)).resolves.toBeUndefined()
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
