import { afterEach, expect, test } from 'vitest'
import type { GitPullRequest } from '@workspace/contracts'
import { closeTestApps } from '../../../test/server'
import { executeGit } from '../../../test/factories/orchestration'
import {
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import type { BranchPullRequests } from '../../git/pull-request'
import type { BranchPullRequestLookup } from '../pull-request-sync-reactor'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

const openPullRequest: GitPullRequest = {
  number: 12,
  title: 'Isolated change',
  url: 'https://github.com/acme/repo/pull/12',
  state: 'open',
  draft: false,
  closedAt: null,
}

/** A forge that answers from a table the test edits, and records every request. */
function fakeForge() {
  const answers = new Map<string, GitPullRequest | null>()
  const requests: string[][] = []
  let fail: Error | null = null
  const lookup: BranchPullRequestLookup = async ({ branches }) => {
    requests.push([...branches])
    if (fail) throw fail
    const pullRequests = new Map(branches.map((branch) => [branch, answers.get(branch) ?? null]))
    return { kind: 'ready', pullRequests } satisfies BranchPullRequests
  }
  return {
    answers,
    requests,
    lookup,
    failWith: (error: Error | null) => {
      fail = error
    },
  }
}

async function pullRequestOf(fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>) {
  return (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.pullRequest
}

test("a dedicated worktree's pull request reaches the shell and follows its branch", async () => {
  const forge = fakeForge()
  const fixture = await worktreeLifecycleFixture({ pullRequestLookup: forge.lookup })
  fixtures.push(fixture)
  const worktree = await fixture.create()
  const branch = worktree.branch ?? ''
  await fixture.engine.syncPullRequests()
  expect(await pullRequestOf(fixture)).toEqual({ status: 'none' })

  forge.answers.set(branch, openPullRequest)
  await fixture.engine.syncPullRequests()
  expect(await pullRequestOf(fixture)).toEqual({ status: 'found', ...openPullRequest })
  const shell = await fixture.engine.shellSnapshot()
  expect(shell.worktrees.find((item) => item.id === lifecycleWorktreeId)?.pullRequest).toEqual({
    status: 'found',
    ...openPullRequest,
  })
  // The registered main checkout is shared, so it is never asked about.
  expect(forge.requests.flat()).not.toContain('main')

  await executeGit(worktree.canonicalPath, 'checkout', '-q', '-b', 'renamed')
  await fixture.engine.refreshWorktreeMetadata(worktree.path)
  await fixture.engine.syncPullRequests()
  expect(forge.requests.at(-1)).toEqual(['renamed'])
  expect(await pullRequestOf(fixture)).toEqual({ status: 'none' })
})

test('a failed lookup reads unknown, keeps a known answer and backs off', async () => {
  const forge = fakeForge()
  const fixture = await worktreeLifecycleFixture({ pullRequestLookup: forge.lookup })
  fixtures.push(fixture)
  forge.failWith(new Error('rate limited'))
  const worktree = await fixture.create()
  await fixture.engine.syncPullRequests()
  expect(await pullRequestOf(fixture)).toEqual({ status: 'unknown' })
  const attempts = forge.requests.length
  await fixture.engine.syncPullRequests()
  expect(forge.requests).toHaveLength(attempts)

  const recovered = fakeForge()
  recovered.answers.set(worktree.branch ?? '', openPullRequest)
  const second = await worktreeLifecycleFixture({ pullRequestLookup: recovered.lookup })
  fixtures.push(second)
  await second.create()
  await second.engine.syncPullRequests()
  recovered.failWith(new Error('rate limited'))
  await second.engine.syncPullRequests()
  expect(await pullRequestOf(second)).toEqual({ status: 'found', ...openPullRequest })
})

test('a merged pull request is final and an unsupported forge says so', async () => {
  const forge = fakeForge()
  const fixture = await worktreeLifecycleFixture({ pullRequestLookup: forge.lookup })
  fixtures.push(fixture)
  const worktree = await fixture.create()
  forge.answers.set(worktree.branch ?? '', { ...openPullRequest, state: 'merged' })
  await fixture.engine.syncPullRequests()
  const asked = forge.requests.length
  await fixture.engine.syncPullRequests()
  expect(forge.requests).toHaveLength(asked)
  expect(await pullRequestOf(fixture)).toMatchObject({ status: 'found', state: 'merged' })

  const offline = await worktreeLifecycleFixture({
    pullRequestLookup: async () => ({ kind: 'unsupported', support: 'no-github-remote' }),
  })
  fixtures.push(offline)
  await offline.create()
  await offline.engine.syncPullRequests()
  expect(await pullRequestOf(offline)).toEqual({
    status: 'unsupported',
    support: 'no-github-remote',
  })
})
