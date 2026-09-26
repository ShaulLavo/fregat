import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GitAutoPullState } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../../testing/git'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { withGitRepositoryLane } from '../repository-lane'
import { autoPullEnabled } from '../auto-pull'
import { GitService } from '../service'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** A bare remote, a checkout of it on `main`, and a second clone that pushes new commits. */
async function fixture(enabled = true) {
  const base = await mkdtemp(path.join(tmpdir(), 'platform-auto-pull-'))
  roots.push(base)
  const remote = path.join(base, 'remote.git')
  const upstream = path.join(base, 'upstream')
  const checkout = path.join(base, 'checkout')
  await runGit(base, ['init', '--bare', '-b', 'main', remote])
  await runGit(base, ['clone', '--quiet', remote, upstream])
  await identity(upstream)
  await commitFile(upstream, 'tracked.txt', 'one\n')
  await runGit(upstream, ['push', '--quiet', 'origin', 'main'])
  await runGit(base, ['clone', '--quiet', remote, checkout])
  await identity(checkout)
  const git = new GitService(createWorkspacePaths(base), {
    autoPullPolicy: async () => enabled,
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
  const advance = async () => {
    await commitFile(upstream, 'tracked.txt', `${Date.now()}\n`)
    await runGit(upstream, ['push', '--quiet', 'origin', 'main'])
    await runGit(checkout, ['fetch', '--quiet', 'origin'])
  }
  const head = async () => (await runGit(checkout, ['rev-parse', 'HEAD'])).stdout.trimEnd()
  const read = async () => (await git.status('checkout', true)).autoPull
  /** Reads until the detached pull settles. */
  const settle = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await read()
      if (state?.state !== 'pulling') return state
      await Bun.sleep(20)
    }
    throw new TypeError('auto pull never settled')
  }
  return { checkout, upstream, git, advance, head, read, settle }
}

async function identity(root: string) {
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])
}

async function commitFile(root: string, name: string, text: string) {
  await writeFile(path.join(root, name), text)
  await runGit(root, ['add', name])
  await runGit(root, ['commit', '--quiet', '-m', `edit ${name}`])
}

const skipped = (reason: string, defaultBranch: string | null = 'main'): GitAutoPullState =>
  ({ state: 'skipped', reason, defaultBranch }) as GitAutoPullState

describe('automatic default-branch pull', () => {
  it('fast-forwards a clean default-branch checkout that is behind', async () => {
    const repo = await fixture()
    expect(await repo.read()).toEqual({ state: 'current' })
    await repo.advance()
    const target = (await runGit(repo.checkout, ['rev-parse', 'origin/main'])).stdout.trimEnd()
    expect(await repo.read()).toEqual({ state: 'pulling' })
    expect(await repo.settle()).toEqual({ state: 'current' })
    expect(await repo.head()).toBe(target)
  })

  it('reports null and never pulls when the policy is off', async () => {
    const repo = await fixture(false)
    await repo.advance()
    const before = await repo.head()
    expect(await repo.read()).toBeNull()
    expect(await repo.head()).toBe(before)
  })

  it.for([
    [
      'a modified file',
      'changes',
      (root: string) => writeFile(path.join(root, 'tracked.txt'), 'edit\n'),
    ],
    [
      'an untracked file',
      'changes',
      (root: string) => writeFile(path.join(root, 'new.txt'), 'new\n'),
    ],
  ] as const)('skips a checkout with %s', async ([, reason, dirty]) => {
    const repo = await fixture()
    await repo.advance()
    await dirty(repo.checkout)
    const before = await repo.head()
    expect(await repo.read()).toEqual(skipped(reason))
    expect(await repo.head()).toBe(before)
  })

  it('skips local commits, and a diverged branch, without writing', async () => {
    const repo = await fixture()
    await commitFile(repo.checkout, 'local.txt', 'local\n')
    expect(await repo.read()).toEqual(skipped('ahead'))
    await repo.advance()
    const before = await repo.head()
    expect(await repo.read()).toEqual(skipped('diverged'))
    expect(await repo.head()).toBe(before)
  })

  it('skips a detached HEAD, another branch and a branch with no upstream', async () => {
    const repo = await fixture()
    await repo.advance()
    await runGit(repo.checkout, ['checkout', '--quiet', '--detach'])
    expect(await repo.read()).toEqual(skipped('detached', null))
    await runGit(repo.checkout, ['checkout', '--quiet', '-b', 'feature', '--track', 'origin/main'])
    await runGit(repo.checkout, [
      'branch',
      '--quiet',
      '--set-upstream-to',
      'origin/main',
      'feature',
    ])
    await runGit(repo.checkout, ['push', '--quiet', 'origin', 'HEAD:feature'])
    await runGit(repo.checkout, [
      'branch',
      '--quiet',
      '--set-upstream-to',
      'origin/feature',
      'feature',
    ])
    expect(await repo.read()).toEqual(skipped('other-branch'))
    await runGit(repo.checkout, ['checkout', '--quiet', '-b', 'loose'])
    expect(await repo.read()).toEqual(skipped('no-upstream', null))
  })

  it('rechecks the checkout after an earlier lane owner changes branches', async () => {
    const repo = await fixture()
    await repo.advance()
    const before = await repo.head()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const owner = withGitRepositoryLane(path.join(repo.checkout, '.git'), async () => {
      entered.resolve()
      await release.promise
      await runGit(repo.checkout, ['checkout', '-b', 'feature'])
      await runGit(repo.checkout, ['branch', '--set-upstream-to=origin/main'])
    })
    await entered.promise
    try {
      expect(await repo.read()).toEqual({ state: 'pulling' })
    } finally {
      release.resolve()
    }
    await owner
    await repo.settle()
    expect(await repo.head()).toBe(before)
  })

  it('leaves a feature branch tracking the default upstream alone', async () => {
    const repo = await fixture()
    await runGit(repo.checkout, ['checkout', '-b', 'feature'])
    await runGit(repo.checkout, ['branch', '--set-upstream-to=origin/main'])
    await repo.advance()
    const before = await repo.head()
    expect(await repo.read()).toEqual(skipped('other-branch'))
    expect(await repo.head()).toBe(before)
  })

  it('reports a failed pull without a partial merge and does not retry every poll', async () => {
    const repo = await fixture()
    await repo.advance()
    const before = await repo.head()
    const lock = path.join(repo.checkout, '.git', 'index.lock')
    await writeFile(lock, '')
    expect(await repo.read()).toEqual({ state: 'pulling' })
    const failed = await repo.settle()
    expect(failed?.state).toBe('failed')
    await rm(lock)
    expect((await repo.read())?.state).toBe('failed')
    expect(await repo.head()).toBe(before)
    expect((await runGit(repo.checkout, ['status', '--porcelain'])).stdout.trimEnd()).toBe('')
  })
})

describe('auto pull policy', () => {
  const settings = (values: Record<string, unknown>) =>
    ({
      snapshot: () => ({ values: { 'git.autoPull': false, 'git.projectAutoPull': {}, ...values } }),
    }) as unknown as Parameters<typeof autoPullEnabled>[0]

  it('lets the project override win and never resolves a project when nothing is on', async () => {
    let lookups = 0
    const project = async () => {
      lookups += 1
      return 'project-a'
    }
    expect(await autoPullEnabled(settings({}), project)).toBe(false)
    expect(lookups).toBe(0)
    expect(
      await autoPullEnabled(settings({ 'git.projectAutoPull': { 'project-a': true } }), project),
    ).toBe(true)
    expect(
      await autoPullEnabled(
        settings({ 'git.autoPull': true, 'git.projectAutoPull': { 'project-a': false } }),
        project,
      ),
    ).toBe(false)
    expect(await autoPullEnabled(settings({ 'git.autoPull': true }), async () => null)).toBe(false)
  })
})
