import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { createPullRequest, readPullRequest } from '../pull-request'
import type { GitProcessResult } from '../utils/process'
import { GitService } from '../service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('push', () => {
  it('publishes a branch nobody has pushed by setting its upstream', async () => {
    const { origin, work } = await clonedRepo()
    await runGit(work, ['checkout', '-b', 'feature/login'])
    await commit(work, 'two\n', 'add login')

    const result = await gitService(work).push(work)

    // A plain `git push` fails here — a session-created branch has no upstream,
    // and telling the user to open a terminal is the gap this closes.
    expect(result).toMatchObject({ branch: 'feature/login', setUpstream: true })
    expect(await remoteBranches(origin)).toContain('feature/login')
  })

  it('updates an already-published branch without touching its upstream again', async () => {
    const { work } = await clonedRepo()
    await runGit(work, ['checkout', '-b', 'feature/login'])
    await commit(work, 'two\n', 'add login')
    const service = gitService(work)
    await service.push(work)
    await commit(work, 'three\n', 'polish login')

    const result = await service.push(work)

    expect(result.setUpstream).toBe(false)
  })

  it('refuses to push a detached head instead of pushing the wrong thing', async () => {
    const { work } = await clonedRepo()
    const head = (await runGit(work, ['rev-parse', 'HEAD'])).trim()
    await runGit(work, ['checkout', head])

    await expect(gitService(work).push(work)).rejects.toThrow('no checked-out branch')
  })
})

describe('pull', () => {
  it('names the conflicted file and the rebase it left behind', async () => {
    const { seed, work } = await clonedRepo()
    await divergeFromUpstream(seed, work)
    await runGit(work, ['config', 'pull.rebase', 'true'])

    const pull = gitService(work).pull(work)

    await expect(pull).rejects.toThrow('Pull stopped on a conflict in tracked.txt')
    await expect(pull).rejects.toMatchObject({ fix: expect.stringContaining('git rebase --abort') })
  })

  it('points a merge conflict at merge --abort, not rebase', async () => {
    const { seed, work } = await clonedRepo()
    await divergeFromUpstream(seed, work)
    await runGit(work, ['config', 'pull.rebase', 'false'])

    await expect(gitService(work).pull(work)).rejects.toMatchObject({
      fix: expect.stringContaining('git merge --abort'),
    })
  })

  it("carries git's own reason when the pull is refused without a conflict", async () => {
    const { seed, work } = await clonedRepo()
    await divergeFromUpstream(seed, work)
    await runGit(work, ['config', 'pull.ff', 'only'])

    await expect(gitService(work).pull(work)).rejects.toThrow('Not possible to fast-forward')
  })
})

describe('branch remote state', () => {
  it('reports a fresh branch as having no upstream and nothing ahead', async () => {
    const { work } = await clonedRepo()
    await runGit(work, ['checkout', '-b', 'feature/login'])
    await commit(work, 'two\n', 'add login')

    const state = await gitService(work).branchRemoteState(work)

    // Zero ahead with no upstream is not "in sync": there is nothing to be in
    // sync with, which is why `hasUpstream` is carried separately.
    expect(state).toMatchObject({ ahead: 0, branch: 'feature/login', hasUpstream: false })
  })

  it('counts commits the upstream does not have once the branch is published', async () => {
    const { work } = await clonedRepo()
    await runGit(work, ['checkout', '-b', 'feature/login'])
    await commit(work, 'two\n', 'add login')
    const service = gitService(work)
    await service.push(work)
    await commit(work, 'three\n', 'polish login')

    const state = await service.branchRemoteState(work)

    expect(state).toMatchObject({ ahead: 1, behind: 0, hasUpstream: true })
  })

  it('says why a pull request could not be read rather than reporting none', async () => {
    const { work } = await clonedRepo()

    const state = await gitService(work).pullRequestState(work)

    // The remote here is a local directory, so `gh` has nothing to talk to. The
    // caller must be able to tell that from "this branch has no pull request",
    // or it offers Create to someone who already has one open.
    expect(state.pullRequest).toBeNull()
    expect(state.support).not.toBe('ready')
  })
})

function gitService(root: string) {
  return new GitService(createWorkspacePaths(root), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
}

async function clonedRepo() {
  const origin = await fixtureRoot('origin')
  await runGit(origin, ['init', '--bare', '-b', 'main'])
  const seed = await fixtureRoot('seed')
  await runGit(seed, ['init', '-b', 'main'])
  await identify(seed)
  await commit(seed, 'one\n', 'initial')
  await runGit(seed, ['remote', 'add', 'origin', origin])
  await runGit(seed, ['push', '-u', 'origin', 'main'])

  const work = await fixtureRoot('work')
  await runGit(work, ['clone', origin, '.'])
  await identify(work)

  return { origin, seed, work }
}

async function divergeFromUpstream(seed: string, work: string) {
  await commit(seed, 'upstream\n', 'upstream change')
  await runGit(seed, ['push'])
  await commit(work, 'local\n', 'local change')
}

async function identify(root: string) {
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])
}

async function commit(root: string, contents: string, message: string) {
  await writeFile(path.join(root, 'tracked.txt'), contents)
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', message])
}

async function remoteBranches(origin: string) {
  return runGit(origin, ['branch', '--format', '%(refname:short)'])
}

async function fixtureRoot(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `platform-push-${label}-`))
  roots.push(root)

  return root
}

async function runGit(root: string, args: readonly string[]) {
  const child = Bun.spawn(['git', '-C', root].concat(args), { stderr: 'pipe', stdout: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout

  throw new Error(`${stderr}${stdout}`.trim())
}

describe('pull request lookup', () => {
  const pullRequest = {
    isDraft: false,
    number: 42,
    state: 'OPEN',
    title: 'Fix',
    url: 'https://github.com/acme/repo/pull/42',
  }

  it('returns a confirmed empty list as absence', async () => {
    const cwd = await fixtureRoot('absent')
    const run = cliBoundary({ exitCode: 0, stderr: '', stdout: '[]' })
    await expect(readPullRequest({ branch: 'feature/login', cwd }, run.process)).resolves.toEqual({
      pullRequest: null,
      support: 'ready',
    })
    expect(run.calls.at(-1)).toEqual([
      'gh',
      'pr',
      'list',
      '--head',
      'feature/login',
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'isDraft,number,state,title,url',
    ])
  })

  it('returns the existing pull request without creating another', async () => {
    const cwd = await fixtureRoot('exists')
    const run = cliBoundary({ exitCode: 0, stderr: '', stdout: JSON.stringify([pullRequest]) })
    await expect(
      createPullRequest({ branch: 'feature/login', cwd, title: 'Fix' }, run.process),
    ).resolves.toMatchObject({ kind: 'exists', pullRequest: { number: 42 } })
    expect(run.calls.some((args) => args[2] === 'create')).toBe(false)
  })

  it('creates only after confirmed absence, then reads the new request', async () => {
    const cwd = await fixtureRoot('create')
    const run = cliBoundary(
      { exitCode: 0, stderr: '', stdout: '[]' },
      JSON.stringify([pullRequest]),
    )
    await expect(
      createPullRequest({ branch: 'feature/login', cwd, title: 'Fix' }, run.process),
    ).resolves.toMatchObject({ kind: 'created', pullRequest: { number: 42 } })
    expect(run.calls.filter((args) => args[2] === 'create')).toHaveLength(1)
  })

  it.each([
    [
      'expired auth',
      { exitCode: 1, stderr: 'HTTP 401: Bad credentials', stdout: '' },
      'could not read',
    ],
    [
      'rate limit',
      { exitCode: 1, stderr: 'HTTP 429: rate limit exceeded', stdout: '' },
      'could not read',
    ],
    ['network', { exitCode: 1, stderr: 'network unreachable', stdout: '' }, 'could not read'],
    [
      'timeout',
      { exitCode: 143, stderr: '', stdout: '', limit: { kind: 'timeout', timeoutMs: 20_000 } },
      'timed out',
    ],
    ['malformed JSON', { exitCode: 0, stderr: '', stdout: '{' }, 'invalid pull request response'],
    [
      'malformed record',
      { exitCode: 0, stderr: '', stdout: '[{"number":42}]' },
      'invalid pull request response',
    ],
    ['wrong shape', { exitCode: 0, stderr: '', stdout: 'null' }, 'invalid pull request response'],
  ] satisfies [string, GitProcessResult, string][])(
    'rejects %s and performs no create',
    async (_label, result, message) => {
      const cwd = await fixtureRoot('failure')
      const run = cliBoundary(result)
      await expect(readPullRequest({ branch: 'feature/login', cwd }, run.process)).rejects.toThrow(
        message,
      )
      await expect(
        createPullRequest({ branch: 'feature/login', cwd, title: 'Fix' }, run.process),
      ).rejects.toThrow(message)
      expect(run.calls.some((args) => args[2] === 'create')).toBe(false)
    },
  )
})

function cliBoundary(lookup: GitProcessResult, created = '[]') {
  const calls: (readonly string[])[] = []
  let didCreate = false
  const process: Parameters<typeof readPullRequest>[1] = async ({ argv }) => {
    calls.push(argv)
    if (argv[2] === 'list') return didCreate ? { exitCode: 0, stderr: '', stdout: created } : lookup
    if (argv[2] === 'create') didCreate = true
    return { exitCode: 0, stderr: '', stdout: '' }
  }
  return { calls, process }
}
