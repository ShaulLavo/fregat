import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../service'
import { runGit } from '../../testing/git'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git status cache', () => {
  it('serves repeat reads from the window and re-reads once the ttl elapses', async () => {
    const root = await fixtureRepo()
    const clock = manualClock()
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      now: clock.now,
      statusCacheTtlMs: 1_000,
    })

    expect((await service.status('')).files).toHaveLength(0)

    // Written behind the service's back: only a cache can hide it.
    await writeFile(path.join(root, 'untracked.txt'), 'two\n')
    expect((await service.status('')).files).toHaveLength(0)

    clock.advance(1_000)
    expect((await service.status('')).files.map((file) => file.path)).toEqual(['untracked.txt'])
  })

  it('drops the window as soon as a mutation runs through the service', async () => {
    const root = await fixtureRepo()
    const clock = manualClock()
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      now: clock.now,
      statusCacheTtlMs: 60_000,
    })

    await writeFile(path.join(root, 'untracked.txt'), 'two\n')
    expect((await service.status('')).files.map((file) => file.status)).toEqual(['untracked'])

    const staged = await service.stage({ paths: ['untracked.txt'] })

    expect(staged.files.map((file) => file.status)).toEqual(['added'])
    expect((await service.status('')).files.map((file) => file.status)).toEqual(['added'])
  })

  it('keeps a separate window per pathspec so a scoped read cannot answer a root read', async () => {
    const root = await fixtureRepo()
    const clock = manualClock()
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      now: clock.now,
      statusCacheTtlMs: 60_000,
    })
    await mkdir(path.join(root, 'nested'), { recursive: true })
    await writeFile(path.join(root, 'nested', 'inside.txt'), 'two\n')
    await writeFile(path.join(root, 'outside.txt'), 'three\n')

    expect((await service.status('nested')).files.map((file) => file.path)).toEqual([
      'nested/inside.txt',
    ])
    expect((await service.status('')).files.map((file) => file.path)).toEqual([
      'nested/inside.txt',
      'outside.txt',
    ])
  })

  it('fresh status replaces a cached missing repository for subsequent ordinary reads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-git-cache-'))
    roots.push(root)
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      repositoryCacheTtlMs: 60_000,
    })
    expect((await service.status('')).repository).toBeNull()
    await runGit(root, ['init', '-b', 'main'])
    await writeFile(path.join(root, 'new.txt'), 'new repository\n')
    expect((await service.status('')).repository).toBeNull()
    const fresh = await service.status('', true)
    expect(fresh.repository).not.toBeNull()
    expect(fresh.files.map((file) => file.path)).toEqual(['new.txt'])
    expect(await service.status('')).toEqual(fresh)
  })

  it('fresh status replaces a cached repository after its metadata is removed', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      repositoryCacheTtlMs: 60_000,
      statusCacheTtlMs: 60_000,
    })
    expect((await service.status('')).repository).not.toBeNull()
    await rm(path.join(root, '.git'), { recursive: true, force: true })
    expect((await service.status('')).repository).not.toBeNull()
    expect(await service.status('', true)).toEqual({
      repository: null,
      files: [],
      uninitializedSubmodules: 0,
      autoPull: null,
    })
    expect(await service.status('')).toEqual({
      repository: null,
      files: [],
      uninitializedSubmodules: 0,
      autoPull: null,
    })
  })

  it('answers a non-repository path from the negative window without re-running git', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-git-cache-'))
    roots.push(root)
    const clock = manualClock()
    const service = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
      now: clock.now,
      repositoryCacheTtlMs: 60_000,
    })

    expect(await service.status('')).toEqual({
      repository: null,
      files: [],
      uninitializedSubmodules: 0,
      autoPull: null,
    })
    expect(await service.status('')).toEqual({
      repository: null,
      files: [],
      uninitializedSubmodules: 0,
      autoPull: null,
    })
  })
})

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-cache-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', 'initial'])
  return root
}

function manualClock() {
  let current = 1_000

  return {
    advance: (ms: number) => {
      current += ms
    },
    now: () => current,
  }
}
