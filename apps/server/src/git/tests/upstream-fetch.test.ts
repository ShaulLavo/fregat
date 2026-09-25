import { mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runGit } from '../../testing/git'
import { FsError } from '../../fs/errors'
import { gitCommonDirectory } from '../repository-lane'
import { parseUpstreamRemote, UpstreamFetchScheduler } from '../upstream-fetch'

const STATUS_WITH_UPSTREAM = statusOutput('origin/main')
const STATUS_WITHOUT_UPSTREAM = ['# branch.oid abc123', '# branch.head main', ''].join('\0')

describe('parseUpstreamRemote', () => {
  it('returns the remote name from the upstream branch record', () => {
    expect(parseUpstreamRemote(STATUS_WITH_UPSTREAM)).toBe('origin')
    expect(parseUpstreamRemote(statusOutput('fork/feature/nested'))).toBe('fork')
  })

  it('returns null without an upstream record', () => {
    expect(parseUpstreamRemote(STATUS_WITHOUT_UPSTREAM)).toBeNull()
    expect(parseUpstreamRemote('')).toBeNull()
  })
})

describe('UpstreamFetchScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches immediately and throttles repeats within the interval', async () => {
    const fetches: string[] = []
    const scheduler = testScheduler(async (root, remote) => {
      fetches.push(`${root}:${remote}`)
    })

    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(fetches).toEqual(['/repo:origin'])

    vi.advanceTimersByTime(14_999)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(fetches).toHaveLength(1)

    vi.advanceTimersByTime(1)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(fetches).toHaveLength(2)
  })

  it('skips repositories without an upstream', async () => {
    const fetches: string[] = []
    const scheduler = testScheduler(async (root) => {
      fetches.push(root)
    })

    await scheduler.schedule('/repo', STATUS_WITHOUT_UPSTREAM)
    expect(fetches).toEqual([])
  })

  it('shares one fetch budget across worktrees with the same common dir', async () => {
    const fetches: string[] = []
    const scheduler = testScheduler(
      async (root) => {
        fetches.push(root)
      },
      { commonDirByRoot: { '/repo': '/repo/.git', '/worktree': '/repo/.git' } },
    )

    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    await scheduler.schedule('/worktree', STATUS_WITH_UPSTREAM)
    expect(fetches).toEqual(['/repo'])
  })

  // GitService schedules with `rev-parse --show-toplevel` roots, which are already real, so a
  // symlinked root only reaches the scheduler directly.
  it('shares one fetch budget between a symlinked root and its target', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'platform-upstream-fetch-'))
    try {
      const root = path.join(base, 'repo')
      const link = path.join(base, 'link')
      await mkdir(root)
      await runGit(root, ['init', '-b', 'main'])
      await symlink(root, link)
      const fetches: string[] = []
      const scheduler = new UpstreamFetchScheduler({
        resolveCommonDir: (rootAbsolutePath) =>
          gitCommonDirectory({
            rootAbsolutePath,
            run: async (args) => ({
              stdout: (await runGit(rootAbsolutePath, args)).stdout.trimEnd(),
            }),
          }),
        runFetch: async (fetchRoot) => {
          fetches.push(fetchRoot)
        },
      })

      await scheduler.schedule(root, STATUS_WITH_UPSTREAM)
      await scheduler.schedule(link, STATUS_WITH_UPSTREAM)
      expect(fetches).toEqual([root])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('keeps separate budgets for distinct common dirs and remotes', async () => {
    const fetches: string[] = []
    const scheduler = testScheduler(async (root, remote) => {
      fetches.push(`${root}:${remote}`)
    })

    await scheduler.schedule('/repo-a', STATUS_WITH_UPSTREAM)
    await scheduler.schedule('/repo-b', STATUS_WITH_UPSTREAM)
    await scheduler.schedule('/repo-a', statusOutput('fork/main'))
    expect(fetches).toEqual(['/repo-a:origin', '/repo-b:origin', '/repo-a:fork'])
  })

  it('retries after the failure cooldown instead of the full interval', async () => {
    let failing = true
    let attempts = 0
    const scheduler = testScheduler(async () => {
      attempts += 1
      if (failing) throw new FsError('GIT_COMMAND_FAILED', 'network down')
    })

    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(attempts).toBe(1)

    vi.advanceTimersByTime(4_999)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(attempts).toBe(1)

    failing = false
    vi.advanceTimersByTime(1)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(attempts).toBe(2)

    vi.advanceTimersByTime(5_000)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(attempts).toBe(2)

    vi.advanceTimersByTime(10_000)
    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(attempts).toBe(3)
  })

  it('shares concurrent resolution and retries a failed lookup on the next request', async () => {
    vi.useRealTimers()
    const resolveCommonDir = vi
      .fn(async () => '/common')
      .mockRejectedValueOnce(new Error('fixture failure'))
    const runFetch = vi.fn(async () => {})
    const scheduler = new UpstreamFetchScheduler({
      repositoryIdentity: async () => ['fixture'],
      resolveCommonDir,
      runFetch,
    })
    await Promise.all([
      scheduler.schedule('/repo', STATUS_WITH_UPSTREAM),
      scheduler.schedule('/repo', STATUS_WITH_UPSTREAM),
    ])
    expect(resolveCommonDir).toHaveBeenCalledTimes(1)
    expect(runFetch).not.toHaveBeenCalled()
    await Promise.all([
      scheduler.schedule('/repo', STATUS_WITH_UPSTREAM),
      scheduler.schedule('/repo', STATUS_WITH_UPSTREAM),
    ])
    expect(resolveCommonDir).toHaveBeenCalledTimes(2)
    expect(runFetch).toHaveBeenCalledTimes(1)
  })

  it('resolves a replacement repository at the same path without reusing the old lookup', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'platform-upstream-replaced-'))
    const root = path.join(base, 'repo')
    const resolveCommonDir = vi.fn(async () => path.join(root, '.git'))
    const scheduler = new UpstreamFetchScheduler({ resolveCommonDir, runFetch: async () => {} })
    try {
      await mkdir(path.join(root, '.git'), { recursive: true })
      await scheduler.schedule(root, STATUS_WITH_UPSTREAM)
      await scheduler.schedule(root, STATUS_WITH_UPSTREAM)
      expect(resolveCommonDir).toHaveBeenCalledTimes(1)
      await rename(root, path.join(base, 'previous'))
      await mkdir(path.join(root, '.git'), { recursive: true })
      await scheduler.schedule(root, STATUS_WITH_UPSTREAM)
      expect(resolveCommonDir).toHaveBeenCalledTimes(2)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('skips fetching when the common dir cannot be resolved', async () => {
    const fetches: string[] = []
    const scheduler = new UpstreamFetchScheduler({
      repositoryIdentity: async () => ['fixture'],
      resolveCommonDir: async () => {
        throw new FsError('GIT_COMMAND_FAILED', 'not a repository')
      },
      runFetch: async (root) => {
        fetches.push(root)
      },
    })

    await scheduler.schedule('/repo', STATUS_WITH_UPSTREAM)
    expect(fetches).toEqual([])
  })
})

function statusOutput(upstream: string) {
  return ['# branch.oid abc123', '# branch.head main', `# branch.upstream ${upstream}`, ''].join(
    '\0',
  )
}

function testScheduler(
  runFetch: (rootAbsolutePath: string, remote: string) => Promise<void>,
  options: { commonDirByRoot?: Record<string, string> } = {},
) {
  return new UpstreamFetchScheduler({
    repositoryIdentity: async (root) => [root],
    resolveCommonDir: async (rootAbsolutePath) =>
      options.commonDirByRoot?.[rootAbsolutePath] ?? `${rootAbsolutePath}/.git`,
    runFetch,
  })
}
