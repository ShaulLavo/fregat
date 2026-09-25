import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { modelSelectionSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { executeGit, FIXTURE_MODEL } from '../../../test/factories/orchestration'
import { worktreeLifecycleFixture } from '../../../test/factories/worktree-lifecycle'
import type { RunProcess } from '../../git/forges/types'
import type { BranchPullRequestLookup } from '../pull-request-sync-reactor'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
const scratch: string[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await closeTestApps()
})

const REMOTE = 'https://github.com/acme/app.git'
const MODEL = v.parse(modelSelectionSchema, FIXTURE_MODEL)

/** Signed-in `gh` that knows one pull request: #7 from `feature/pr`, same repository or a fork. */
function github(crossRepository = false): RunProcess {
  return async ({ argv }) => {
    if (argv[0] === 'git') return { exitCode: 0, stderr: '', stdout: `origin\t${REMOTE} (fetch)\n` }
    if (argv[1] === 'auth') return { exitCode: 0, stderr: '', stdout: '' }
    if (argv[1] === 'pr' && argv[2] === 'view')
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          number: 7,
          title: 'Add greeting',
          url: 'https://github.com/acme/app/pull/7',
          state: 'OPEN',
          isDraft: false,
          closedAt: null,
          headRefName: 'feature/pr',
          baseRefName: 'main',
          isCrossRepository: crossRepository,
        }),
      }
    return { exitCode: 1, stderr: 'unexpected', stdout: '' }
  }
}

/** The fixture's origin is a GitHub address that git rewrites to a local bare repository holding the pull request. */
async function withPullRequest(
  options: { crossRepository?: boolean; lookup?: BranchPullRequestLookup } = {},
) {
  const fixture = await worktreeLifecycleFixture({
    forgeBoundaries: { run: github(options.crossRepository) },
    ...(options.lookup ? { pullRequestLookup: options.lookup } : {}),
  })
  fixtures.push(fixture)
  const base = await mkdtemp(path.join(tmpdir(), 'platform-pr-remote-'))
  scratch.push(base)
  const bare = path.join(base, 'app.git')
  await executeGit(base, 'init', '--bare', '-b', 'main', bare)
  await executeGit(fixture.root, 'remote', 'add', 'origin', REMOTE)
  await executeGit(fixture.root, 'config', `url.${bare}.insteadOf`, REMOTE)
  await executeGit(fixture.root, 'push', '-q', 'origin', 'main')
  await executeGit(fixture.root, 'checkout', '-q', '-b', 'feature/pr')
  await writeFile(path.join(fixture.root, 'greeting.txt'), 'hello from the pull request\n')
  await executeGit(fixture.root, 'add', 'greeting.txt')
  await executeGit(fixture.root, 'commit', '-q', '-m', 'greeting')
  await executeGit(fixture.root, 'push', '-q', 'origin', 'feature/pr')
  await executeGit(bare, 'update-ref', 'refs/pull/7/head', 'refs/heads/feature/pr')
  await executeGit(fixture.root, 'checkout', '-q', 'main')
  await executeGit(fixture.root, 'branch', '-q', '-D', 'feature/pr')
  return { fixture, bare }
}

test('a pull request URL opens a session in its own worktree at the head, tracking its branch', async () => {
  const asked: string[] = []
  const { fixture, bare } = await withPullRequest({
    lookup: async ({ branches }) => {
      asked.push(...branches)
      return { kind: 'ready', pullRequests: new Map(branches.map((branch) => [branch, null])) }
    },
  })
  const started = await fixture.engine.startPullRequestSession({
    worktreeId: fixture.registration.worktreeId,
    reference: 'https://github.com/acme/app/pull/7/files',
    modelSelection: MODEL,
  })
  const model = await fixture.engine.readModelSnapshot()
  const worktree = model.worktrees.get(started.worktreeId)
  expect(model.sessions.get(started.sessionId)?.title).toBe('#7 Add greeting')
  expect(worktree?.lifecycle.state).toBe('ready')
  const checkout = worktree?.canonicalPath ?? ''
  expect(await readFile(path.join(checkout, 'greeting.txt'), 'utf8')).toBe(
    'hello from the pull request\n',
  )
  expect(await executeGit(checkout, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feature/pr')

  await writeFile(path.join(checkout, 'greeting.txt'), 'reviewed\n')
  await executeGit(checkout, 'commit', '-qam', 'review')
  const response = await fixture.app.handle(
    new Request('http://localhost/git/push', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ path: worktree?.path }),
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  expect(await executeGit(bare, 'show', 'feature/pr:greeting.txt')).toBe('reviewed')

  await fixture.engine.syncPullRequests()
  expect(asked).toContain('feature/pr')
})

test('a fork pull request starts at its head without tracking a branch this remote lacks', async () => {
  const { fixture } = await withPullRequest({ crossRepository: true })
  const started = await fixture.engine.startPullRequestSession({
    worktreeId: fixture.registration.worktreeId,
    reference: '#7',
    modelSelection: MODEL,
  })
  const checkout =
    (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)?.canonicalPath ??
    ''
  expect(await readFile(path.join(checkout, 'greeting.txt'), 'utf8')).toBe(
    'hello from the pull request\n',
  )
  await expect(executeGit(checkout, 'rev-parse', '--abbrev-ref', '@{u}')).rejects.toThrow()
})

test('a reference that names no pull request starts nothing', async () => {
  const { fixture } = await withPullRequest()
  await expect(
    fixture.engine.startPullRequestSession({
      worktreeId: fixture.registration.worktreeId,
      reference: 'feature/pr',
      modelSelection: MODEL,
    }),
  ).rejects.toThrow('That does not name a pull request.')
  expect((await fixture.engine.readModelSnapshot()).sessions.size).toBe(0)
})

test('push and open reports a pushed branch and a refused pull request as two outcomes', async () => {
  const { fixture } = await withPullRequest()
  await executeGit(fixture.root, 'checkout', '-q', '-b', 'feature/new')
  await writeFile(path.join(fixture.root, 'new.txt'), 'new\n')
  await executeGit(fixture.root, 'add', 'new.txt')
  await executeGit(fixture.root, 'commit', '-qm', 'new')
  const response = await fixture.app.handle(
    new Request('http://localhost/git/push-and-pull-request', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', title: 'New' }),
    }),
  )
  const result = (await response.json()) as {
    push: { ok: boolean }
    pullRequest: { kind: string } | null
  }
  // The fake gh answers `pr view` only, so listing and creating fail after a real push.
  expect(result.push.ok).toBe(true)
  expect(result.pullRequest?.kind).toBe('failed')
})
