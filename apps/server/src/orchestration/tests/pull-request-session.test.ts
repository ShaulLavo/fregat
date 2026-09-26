import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { modelSelectionSchema } from '@workspace/contracts'
import { afterEach, expect, test, vi } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { FIXTURE_MODEL } from '../../../test/factories/orchestration'
import { runGit } from '../../testing/git'
import { worktreeLifecycleFixture } from '../../../test/factories/worktree-lifecycle'
import type { ForgeBoundaries } from '../../git/pull-request'
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
function github(crossRepository = false, state: () => string = () => 'OPEN'): RunProcess {
  return async ({ argv }) => {
    const detail = {
      number: 7,
      title: 'Add greeting',
      url: 'https://github.com/acme/app/pull/7',
      state: state(),
      isDraft: false,
      closedAt: null,
      headRefName: 'feature/pr',
      baseRefName: 'main',
      isCrossRepository: crossRepository,
    }
    if (argv[1] === 'api')
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ data: { repository: { p0: detail } } }),
      }
    if (argv[0] === 'git') return { exitCode: 0, stderr: '', stdout: `origin\t${REMOTE} (fetch)\n` }
    if (argv[1] === 'auth') return { exitCode: 0, stderr: '', stdout: '' }
    if (argv[1] === 'pr' && argv[2] === 'view')
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify(detail),
      }
    return { exitCode: 1, stderr: 'unexpected', stdout: '' }
  }
}

/** The fixture's origin is a GitHub address that git rewrites to a local bare repository holding the pull request. */
async function withPullRequest(
  options: {
    crossRepository?: boolean
    lookup?: BranchPullRequestLookup
    remote?: string
    boundaries?: ForgeBoundaries
    state?: () => string
  } = {},
) {
  const remote = options.remote ?? REMOTE
  const fixture = await worktreeLifecycleFixture({
    forgeBoundaries: options.boundaries ?? { run: github(options.crossRepository, options.state) },
    ...(options.lookup ? { pullRequestLookup: options.lookup } : {}),
  })
  fixtures.push(fixture)
  const base = await mkdtemp(path.join(tmpdir(), 'platform-pr-remote-'))
  scratch.push(base)
  const bare = path.join(base, 'app.git')
  await runGit(base, ['init', '--bare', '-b', 'main', bare], { cwdMode: 'option' })
  await runGit(fixture.root, ['remote', 'add', 'origin', remote], { cwdMode: 'option' })
  await runGit(fixture.root, ['config', `url.${bare}.insteadOf`, remote], { cwdMode: 'option' })
  await runGit(fixture.root, ['push', '-q', 'origin', 'main'], { cwdMode: 'option' })
  await runGit(fixture.root, ['checkout', '-q', '-b', 'feature/pr'], { cwdMode: 'option' })
  await writeFile(path.join(fixture.root, 'greeting.txt'), 'hello from the pull request\n')
  await runGit(fixture.root, ['add', 'greeting.txt'], { cwdMode: 'option' })
  await runGit(fixture.root, ['commit', '-q', '-m', 'greeting'], { cwdMode: 'option' })
  await runGit(fixture.root, ['push', '-q', 'origin', 'feature/pr'], { cwdMode: 'option' })
  await runGit(bare, ['update-ref', 'refs/pull/7/head', 'refs/heads/feature/pr'], {
    cwdMode: 'option',
  })
  await runGit(fixture.root, ['checkout', '-q', 'main'], { cwdMode: 'option' })
  await runGit(fixture.root, ['branch', '-q', '-D', 'feature/pr'], { cwdMode: 'option' })
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
  expect(
    (
      await runGit(checkout, ['rev-parse', '--abbrev-ref', '@{u}'], { cwdMode: 'option' })
    ).stdout.trim(),
  ).toBe('origin/feature/pr')

  await writeFile(path.join(checkout, 'greeting.txt'), 'reviewed\n')
  await runGit(checkout, ['commit', '-qam', 'review'], { cwdMode: 'option' })
  const response = await fixture.app.handle(
    new Request('http://localhost/git/push', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ path: worktree?.path }),
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  expect(
    (await runGit(bare, ['show', 'feature/pr:greeting.txt'], { cwdMode: 'option' })).stdout.trim(),
  ).toBe('reviewed')

  await fixture.engine.syncPullRequests()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)?.pullRequest,
  ).toMatchObject({ status: 'found', number: 7 })
})

test('a fork pull request starts at its head without tracking a branch this remote lacks', async () => {
  let state = 'OPEN'
  const { fixture } = await withPullRequest({
    crossRepository: true,
    state: () => state,
    lookup: async ({ branches }) => ({
      kind: 'ready',
      pullRequests: new Map(branches.map((branch) => [branch, null])),
    }),
  })
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
  await expect(
    runGit(checkout, ['rev-parse', '--abbrev-ref', '@{u}'], { cwdMode: 'option' }),
  ).rejects.toThrow()
  state = 'MERGED'
  await fixture.restart()
  await fixture.engine.syncPullRequests()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)?.pullRequest,
  ).toMatchObject({ status: 'found', number: 7, state: 'merged' })
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

test('a pull request URL from another repository starts nothing', async () => {
  const { fixture } = await withPullRequest()
  await expect(
    fixture.engine.startPullRequestSession({
      worktreeId: fixture.registration.worktreeId,
      reference: 'https://github.com/other/lib/pull/7',
      modelSelection: MODEL,
    }),
  ).rejects.toThrow('That pull request belongs to other/lib')
  expect((await fixture.engine.readModelSnapshot()).sessions.size).toBe(0)
})

test('push and open reports a pushed branch and a refused pull request as two outcomes', async () => {
  const { fixture } = await withPullRequest()
  await runGit(fixture.root, ['checkout', '-q', '-b', 'feature/new'], { cwdMode: 'option' })
  await writeFile(path.join(fixture.root, 'new.txt'), 'new\n')
  await runGit(fixture.root, ['add', 'new.txt'], { cwdMode: 'option' })
  await runGit(fixture.root, ['commit', '-qm', 'new'], { cwdMode: 'option' })
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

test.for([false, true])(
  'Bitbucket fetches and verifies fork heads, changed commit: %s',
  async (changed) => {
    const remote = 'https://bitbucket.org/acme/app.git'
    let commit = ''
    const { fixture, bare } = await withPullRequest({
      remote,
      boundaries: {
        run: async ({ argv }) => ({
          exitCode: 0,
          stderr: '',
          stdout: argv.includes('remote')
            ? `origin\t${remote} (fetch)\n`
            : 'username=test\npassword=token\n',
        }),
        fetch: (async (_input: string | URL | Request, _init?: RequestInit) =>
          Response.json({
            id: 7,
            title: 'Fork',
            state: 'OPEN',
            links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } },
            source: {
              branch: { name: 'feature/pr' },
              commit: { hash: commit },
              repository: { full_name: 'contributor/app' },
            },
            destination: { branch: { name: 'main' }, repository: { full_name: 'acme/app' } },
          })) as typeof fetch,
      },
    })
    const fork = path.join(path.dirname(bare), 'fork')
    await runGit(path.dirname(bare), ['clone', bare, fork], { cwdMode: 'option' })
    await runGit(fork, ['config', 'user.name', 'Fork'], { cwdMode: 'option' })
    await runGit(fork, ['config', 'user.email', 'fork@example.invalid'], { cwdMode: 'option' })
    await runGit(fork, ['checkout', 'feature/pr'], { cwdMode: 'option' })
    await writeFile(path.join(fork, 'greeting.txt'), 'fork head\n')
    await runGit(fork, ['commit', '-am', 'fork head'], { cwdMode: 'option' })
    commit = changed
      ? '0'.repeat(40)
      : (await runGit(fork, ['rev-parse', 'HEAD'], { cwdMode: 'option' })).stdout.trim()
    await runGit(
      fixture.root,
      ['config', `url.${fork}.insteadOf`, 'https://bitbucket.org/contributor/app.git'],
      { cwdMode: 'option' },
    )
    const starting = fixture.engine.startPullRequestSession({
      worktreeId: fixture.registration.worktreeId,
      reference: '#7',
      modelSelection: MODEL,
    })
    if (changed) {
      await expect(starting).rejects.toMatchObject({ code: 'git.PULL_REQUEST_HEAD_CHANGED' })
      expect((await fixture.engine.readModelSnapshot()).sessions.size).toBe(0)
      return
    }
    const started = await starting
    const checkout =
      (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)?.canonicalPath ??
      ''
    expect(
      (await runGit(checkout, ['rev-parse', 'HEAD'], { cwdMode: 'option' })).stdout.trim(),
    ).toBe(commit)
    expect(await readFile(path.join(checkout, 'greeting.txt'), 'utf8')).toBe('fork head\n')
  },
)

test.each([false, true])('fork PR skips automatic setup, foreground: %s', async (foreground) => {
  const { fixture } = await withPullRequest({ crossRepository: true })
  await fixture.command({
    type: 'project.meta.update',
    projectId: fixture.registration.projectId,
    scripts: [
      {
        name: 'Install',
        command: 'echo executed > setup-ran',
        runOnWorktreeCreate: true,
        waitForSetup: foreground,
      },
    ],
  })
  const started = await fixture.engine.startPullRequestSession({
    worktreeId: fixture.registration.worktreeId,
    reference: '#7',
    modelSelection: MODEL,
  })
  await fixture.engine.providerRuntimeIdle()
  const created = (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)
  await expect(readFile(path.join(created?.canonicalPath ?? '', 'setup-ran'))).rejects.toThrow()
  expect(created?.setup?.state).toBe('skipped')
  await fixture.restart()
  await expect(readFile(path.join(created?.canonicalPath ?? '', 'setup-ran'))).rejects.toThrow()
  await fixture.command({ type: 'worktree.setup.run', worktreeId: started.worktreeId })
  await expect
    .poll(() => readFile(path.join(created?.canonicalPath ?? '', 'setup-ran'), 'utf8'))
    .toBe('executed\n')
})

test('PR association survives a foreground setup longer than ten minutes of polling', async () => {
  const { fixture } = await withPullRequest()
  const release = path.join(fixture.root, 'release-setup')
  await fixture.command({
    type: 'project.meta.update',
    projectId: fixture.registration.projectId,
    scripts: [
      {
        name: 'Install',
        command: 'while [ ! -f "$PLATFORM_PROJECT_ROOT/release-setup" ]; do sleep 0.01; done',
        runOnWorktreeCreate: true,
        waitForSetup: true,
      },
    ],
  })
  const sleep = Bun.sleep
  let polls = 0
  const accelerated = vi.spyOn(Bun, 'sleep').mockImplementation(async () => {
    polls += 1
    if (polls === 6001) await writeFile(release, '')
    await sleep(1)
  })
  try {
    const started = await fixture.engine.startPullRequestSession({
      worktreeId: fixture.registration.worktreeId,
      reference: '#7',
      modelSelection: MODEL,
    })
    const created = (await fixture.engine.readModelSnapshot()).worktrees.get(started.worktreeId)
    expect(created?.pullRequest).toMatchObject({ status: 'found', number: 7 })
    expect(polls).toBeGreaterThan(6000)
  } finally {
    accelerated.mockRestore()
    await writeFile(release, '')
  }
}, 20_000)
