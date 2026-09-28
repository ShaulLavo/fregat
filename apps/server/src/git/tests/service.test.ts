import { checkpointFilesFromDiffs } from '../../orchestration/checkpoint-files'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { createWorkspacePaths } from '../../fs/path'
import { relativeInsideRoot } from '../path-utils'
import { GitService } from '../service'
import { testSettingsOptions } from '../../settings/testing'
import { runGit } from '../../testing/git'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git paths beginning with two dots', () => {
  it('maps a ..foo file to its repository path', () => {
    expect(relativeInsideRoot('/repo', '/repo/..foo')).toBe('..foo')
    expect(relativeInsideRoot('/repo', '/')).toBeNull()
    expect(relativeInsideRoot('/repo', '/sibling')).toBeNull()
  })

  it('includes a ..foo file in status', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, '..foo'), 'inside\n')
    const response = await testApp(root).handle(
      new Request('http://local/git/status', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      files: expect.arrayContaining([expect.objectContaining({ path: '..foo' })]),
    })
  })

  it('accepts a ..foo file as a stage pathspec', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, '..foo'), 'inside\n')
    const response = await testApp(root).handle(
      new Request('http://local/git/stage', {
        body: JSON.stringify({ paths: ['..foo'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect((await runGit(root, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe('..foo')
  })
})

describe('git rpc branches', () => {
  it('lists the initial branch as current', async () => {
    const root = await fixtureRepo()
    const shortSha = (await runGit(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/branches', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitBranchesTestPayload
    expect(payload.repository).toMatchObject({ branch: 'main', path: '' })
    expect(payload.branches).toEqual([
      { commit: shortSha, current: true, name: 'main', upstream: null },
    ])
  })

  it('creates a branch and checks it out by default', async () => {
    const root = await fixtureRepo()
    const shortSha = (await runGit(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/create-branch', {
        body: JSON.stringify({ branch: 'feature' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitBranchesTestPayload
    expect(payload.branches).toEqual([
      { commit: shortSha, current: true, name: 'feature', upstream: null },
      { commit: shortSha, current: false, name: 'main', upstream: null },
    ])
    const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(head.stdout.trim()).toBe('feature')
  })

  it('creates a branch without switching when checkout is false', async () => {
    const root = await fixtureRepo()
    const shortSha = (await runGit(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/create-branch', {
        body: JSON.stringify({ branch: 'feature', checkout: false }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitBranchesTestPayload
    expect(payload.branches).toEqual([
      { commit: shortSha, current: false, name: 'feature', upstream: null },
      { commit: shortSha, current: true, name: 'main', upstream: null },
    ])
    const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(head.stdout.trim()).toBe('main')
  })

  it('reports the upstream when a branch tracks another ref', async () => {
    const root = await fixtureRepo()
    const shortSha = (await runGit(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    await runGit(root, ['branch', 'feature'])
    await runGit(root, ['branch', '--set-upstream-to=main', 'feature'])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/branches', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitBranchesTestPayload
    expect(payload.branches).toEqual([
      { commit: shortSha, current: false, name: 'feature', upstream: 'main' },
      { commit: shortSha, current: true, name: 'main', upstream: null },
    ])
  })

  it('checks out an existing branch and reports it in status', async () => {
    const root = await fixtureRepo()
    await runGit(root, ['branch', 'feature'])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/checkout', {
        body: JSON.stringify({ branch: 'feature' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitStatusTestPayload
    expect(payload.repository).toMatchObject({ branch: 'feature' })
    expect(payload.files).toEqual([])
  })

  it('fails checkout when local changes would be overwritten', async () => {
    const root = await fixtureRepo()
    await runGit(root, ['branch', 'other'])
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'second'])
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/checkout', {
        body: JSON.stringify({ branch: 'other' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(500)
    expect(await errorCode(response)).toBe('GIT_COMMAND_FAILED')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('dirty\n')
    const head = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(head.stdout.trim()).toBe('main')
  })
})

describe('git rpc commit', () => {
  it('commits staged changes and clears the status', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const app = testApp(root)

    const staged = await app.handle(
      new Request('http://local/git/stage', {
        body: JSON.stringify({ paths: ['tracked.txt'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    const committed = await app.handle(
      new Request('http://local/git/commit', {
        body: JSON.stringify({ message: 'update tracked' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(staged.status).toBe(200)
    expect(committed.status).toBe(200)
    expect(await committed.json()).toMatchObject({
      kind: 'committed',
      output: expect.stringContaining('update tracked'),
      repository: { branch: 'main' },
    })
    const log = await runGit(root, ['log', '-1', '--format=%s'])
    expect(log.stdout.trim()).toBe('update tracked')
    const status = await runGit(root, ['status', '--porcelain'])
    expect(status.stdout).toBe('')
  })

  it('fails to commit when nothing is staged', async () => {
    const root = await fixtureRepo()
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/commit', {
        body: JSON.stringify({ message: 'noop' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(500)
    expect(await errorCode(response)).toBe('GIT_COMMAND_FAILED')
  })

  it('writes a commit message file when the message is blank', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await runGit(root, ['add', 'tracked.txt'])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/commit', {
        body: JSON.stringify({ message: '   ' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { kind: string; path: string }
    expect(payload).toMatchObject({ kind: 'message-file', path: '.git/COMMIT_EDITMSG' })
    const template = await readFile(path.join(root, payload.path), 'utf8')
    expect(template.length).toBeGreaterThan(0)
    const log = await runGit(root, ['log', '-1', '--format=%s'])
    expect(log.stdout.trim()).toBe('initial')
  })
})

describe('git rpc unstage and discard', () => {
  it('returns staged changes to the worktree on unstage', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await runGit(root, ['add', 'tracked.txt'])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/unstage', {
        body: JSON.stringify({ paths: ['tracked.txt'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitStatusTestPayload
    expect(payload.files).toContainEqual(
      expect.objectContaining({
        index: 'unmodified',
        path: 'tracked.txt',
        status: 'modified',
        worktree: 'modified',
      }),
    )
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('two\n')
  })

  it('reverts a modified tracked file on discard', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/discard', {
        body: JSON.stringify({ paths: ['tracked.txt'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitStatusTestPayload
    expect(payload.files).toEqual([])
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('one\n')
  })

  it('deletes an untracked file from disk on discard', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'new.txt'), 'new\n')
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/discard', {
        body: JSON.stringify({ paths: ['new.txt'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitStatusTestPayload
    expect(payload.files).toEqual([])
    await expect(readFile(path.join(root, 'new.txt'), 'utf8')).rejects.toThrow()
  })
})

describe('git rpc patches and file content', () => {
  it('applies a valid patch to the worktree', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const patch = (await runGit(root, ['diff'])).stdout
    await runGit(root, ['checkout', '--', '.'])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/apply-patch', {
        body: JSON.stringify({ patch }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as GitStatusTestPayload
    expect(payload.files).toContainEqual(
      expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
    )
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('two\n')
  })

  it('rejects a corrupted patch', async () => {
    const root = await fixtureRepo()
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/apply-patch', {
        body: JSON.stringify({ patch: 'not a real patch\n' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(500)
    expect(await errorCode(response)).toBe('GIT_COMMAND_FAILED')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('one\n')
  })

  it('returns committed content at HEAD when the worktree differs', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/git/file?path=tracked.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content: 'one\n',
      path: 'tracked.txt',
      ref: 'HEAD',
    })
  })

  it('returns content at an explicit older ref', async () => {
    const root = await fixtureRepo()
    const initial = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'second'])
    const app = testApp(root)

    const response = await app.handle(
      new Request(`http://local/git/file?path=tracked.txt&ref=${initial}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content: 'one\n',
      path: 'tracked.txt',
      ref: initial,
    })
  })
})

describe('git diff size budget', () => {
  it('keeps filesystem reads independent of the configured Git budget', async () => {
    const root = await fixtureRepo()
    await mkdir(path.join(root, '.platform-test'), { recursive: true })
    await writeFile(
      path.join(root, '.platform-test', 'settings.json'),
      JSON.stringify({ 'git.maxDiffFileSizeMiB': 1 }),
    )
    const text = 'a'.repeat(1024 * 1024) + '\n'
    await writeFile(path.join(root, 'tracked.txt'), text)
    const app = testApp(root)
    const diff = await app.handle(
      new Request('http://local/git/diff?path=tracked.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    expect(diff.status).toBe(200)
    const rows = await diff.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].newText).toBeUndefined()
    expect(rows[0].path).toBe('tracked.txt')
    expect(rows[0].omitted).toBe('size')
    expect(rows[0].patch).toBe('')
    const read = await app.handle(
      new Request('http://local/fs/read?path=tracked.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ content: text })
  })

  it('opens a revision above the diff budget and refuses a large patch before collecting it', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'a'.repeat(4096))
    await runGit(root, ['commit', '-am', 'large baseline'])
    await writeFile(path.join(root, 'tracked.txt'), 'b'.repeat(4096))
    const service = new GitService(createWorkspacePaths(root), {
      maxDiffFileBytes: () => 1024,
      maxCommandOutputBytes: 512,
    })
    expect((await service.file('tracked.txt', 'HEAD')).content).toHaveLength(4096)
    expect(await service.diff('tracked.txt')).toMatchObject([{ omitted: 'size', patch: '' }])
    await runGit(root, ['commit', '-am', 'large change'])
    expect(await service.diffRefs({ path: '', oldRef: 'HEAD~1', newRef: 'HEAD' })).toMatchObject([
      { path: 'tracked.txt', omitted: 'size', patch: '' },
    ])
    const oldObjectId = (await runGit(root, ['rev-parse', 'HEAD~1:tracked.txt'])).stdout.trim()
    const newObjectId = (await runGit(root, ['rev-parse', 'HEAD:tracked.txt'])).stdout.trim()
    expect(await service.diffBlob({ path: 'tracked.txt', oldObjectId, newObjectId })).toMatchObject(
      [{ path: 'tracked.txt', omitted: 'size', patch: '' }],
    )
  })

  it('keeps exact checkpoint counts and object identities for an oversized staged rename', async () => {
    const root = await fixtureRepo()
    const original = 'unchanged\n'.repeat(100) + 'old\n'
    const changed = 'unchanged\n'.repeat(100) + 'new\nextra\n'
    const renamed = 'renamed\twith\nlines.txt'
    await writeFile(path.join(root, 'tracked.txt'), original)
    await runGit(root, ['commit', '-am', 'large baseline'])
    await runGit(root, ['mv', 'tracked.txt', renamed])
    await writeFile(path.join(root, renamed), changed)
    await runGit(root, ['add', renamed])
    const service = new GitService(createWorkspacePaths(root), { maxDiffFileBytes: () => 64 })
    const staged = await service.diff(renamed, true)
    expect(staged).toMatchObject([
      {
        path: renamed,
        oldPath: 'tracked.txt',
        omitted: 'size',
        patch: '',
        lineStats: { additions: 2, deletions: 1 },
        oldObjectId: expect.stringMatching(/^[a-f0-9]{40}$/),
        newObjectId: expect.stringMatching(/^[a-f0-9]{40}$/),
      },
    ])
    await runGit(root, ['commit', '-m', 'rename and edit'])
    const refs = await service.diffRefs({ path: '', oldRef: 'HEAD~1', newRef: 'HEAD' })
    expect(checkpointFilesFromDiffs(refs)).toEqual([
      {
        path: renamed,
        kind: 'renamed',
        additions: 2,
        deletions: 1,
      },
    ])
    await writeFile(path.join(root, renamed), changed + 'another\n')
    const worktree = await service.diff(renamed)
    expect(worktree[0]?.lineStats).toEqual({ additions: 1, deletions: 0 })
  })

  it('pins an omitted untracked version so raising the budget opens that exact snapshot', async () => {
    const root = await fixtureRepo()
    const saved = 'original snapshot\n'
    await writeFile(path.join(root, 'new.txt'), saved)
    let budget = 4
    const service = new GitService(createWorkspacePaths(root), { maxDiffFileBytes: () => budget })
    const [omitted] = await service.diff('new.txt')
    expect(omitted).toMatchObject({
      omitted: 'size',
      newObjectId: expect.stringMatching(/^[a-f0-9]{40}$/),
    })
    expect(omitted?.oldObjectId).toBeUndefined()
    await writeFile(path.join(root, 'new.txt'), 'later disk change\n')
    budget = 64
    const hydrated = await service.diffBlob({ path: 'new.txt', newObjectId: omitted!.newObjectId })
    expect(hydrated).toMatchObject([{ newText: saved }])
  })

  it('keeps small diffs when a neighboring path exceeds the budget', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'large [x].txt'), 'a'.repeat(64))
    await runGit(root, ['add', '.'])
    await runGit(root, ['commit', '-m', 'second file'])
    await writeFile(path.join(root, 'large [x].txt'), 'b'.repeat(64))
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const service = new GitService(createWorkspacePaths(root), { maxDiffFileBytes: () => 4 })
    const diffs = await service.diff()
    expect(diffs).toHaveLength(2)
    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'large [x].txt', omitted: 'size', patch: '' }),
        expect.objectContaining({ path: 'tracked.txt', hunks: expect.any(Array) }),
      ]),
    )
    expect(diffs.find((diff) => diff.path === 'tracked.txt')?.patch).toContain('+two')
  })

  it('includes the exact boundary and uses a changed budget on the next read', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    let budget = 4
    const service = new GitService(createWorkspacePaths(root), {
      maxDiffFileBytes: () => budget,
    })
    expect(await service.diff('tracked.txt')).toMatchObject([
      { oldText: 'one\n', newText: 'two\n' },
    ])
    budget = 3
    const [diff] = await service.diff('tracked.txt')
    expect(diff?.oldText).toBeUndefined()
    expect(diff?.newText).toBeUndefined()
    await writeFile(path.join(root, 'new.txt'), 'new\n')
    expect(await service.diff('new.txt')).toMatchObject([{ path: 'new.txt', omitted: 'size' }])
    budget = 4
    expect(await service.diff('new.txt')).toMatchObject([{ newText: 'new\n' }])
  })
})

describe('git service refs', () => {
  it('reports whether a ref exists', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root))

    expect(await service.hasRef({ path: '', ref: 'refs/checkpoints/a' })).toBe(false)

    const head = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(root, ['update-ref', 'refs/checkpoints/a', head])

    expect(await service.hasRef({ path: '', ref: 'refs/checkpoints/a' })).toBe(true)
  })

  it('restores the worktree, index, and untracked files to the ref', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root))
    const head = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(root, ['update-ref', 'refs/checkpoints/snap', head])
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')
    await runGit(root, ['add', 'tracked.txt'])
    await writeFile(path.join(root, 'untracked.txt'), 'junk\n')

    const restored = await service.restoreRef({ path: '', ref: 'refs/checkpoints/snap' })

    expect(restored).toBe(true)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('one\n')
    await expect(readFile(path.join(root, 'untracked.txt'), 'utf8')).rejects.toThrow()
    const status = await runGit(root, ['status', '--porcelain'])
    expect(status.stdout).toBe('')
  })

  it('returns false for a missing ref without fallback', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root))
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')

    const restored = await service.restoreRef({ path: '', ref: 'refs/checkpoints/missing' })

    expect(restored).toBe(false)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('dirty\n')
  })

  it('falls back to HEAD when the ref is missing and fallback is requested', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root))
    await writeFile(path.join(root, 'tracked.txt'), 'dirty\n')

    const restored = await service.restoreRef({
      fallbackToHead: true,
      path: '',
      ref: 'refs/checkpoints/missing',
    })

    expect(restored).toBe(true)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('one\n')
  })

  it('deletes refs and ignores missing ones', async () => {
    const root = await fixtureRepo()
    const service = new GitService(createWorkspacePaths(root))
    const head = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(root, ['update-ref', 'refs/checkpoints/a', head])
    await runGit(root, ['update-ref', 'refs/checkpoints/b', head])

    await service.deleteRefs({
      path: '',
      refs: ['refs/checkpoints/a', 'refs/checkpoints/b', 'refs/checkpoints/missing'],
    })

    expect(await service.hasRef({ path: '', ref: 'refs/checkpoints/a' })).toBe(false)
    expect(await service.hasRef({ path: '', ref: 'refs/checkpoints/b' })).toBe(false)
  })
})

describe('git upstream fetch', () => {
  it('fetches the upstream remote in the background after status', async () => {
    const origin = await fixtureRepo()
    const root = await mkdtemp(path.join(tmpdir(), 'platform-git-clone-'))
    roots.push(root)
    await runGit(origin, ['clone', origin, root])
    await writeFile(path.join(origin, 'tracked.txt'), 'two\n')
    await runGit(origin, ['commit', '-am', 'second'])
    const expected = (await runGit(origin, ['rev-parse', 'HEAD'])).stdout.trim()
    const service = new GitService(createWorkspacePaths(root))

    const status = await service.status('')

    expect(status.repository?.branch).toBe('main')
    await vi.waitFor(
      async () => {
        const remoteHead = await runGit(root, ['rev-parse', 'origin/main'])
        expect(remoteHead.stdout.trim()).toBe(expected)
      },
      { timeout: 5_000 },
    )
  })
})

type GitStatusTestPayload = {
  repository: { branch: string | null; path: string } | null
  files: Array<Record<string, unknown>>
}

type GitBranchesTestPayload = {
  repository: { branch: string | null; path: string } | null
  branches: Array<{ commit: string; current: boolean; name: string; upstream: string | null }>
}

function testApp(root: string) {
  const app = createTestApp({
    auth: {
      allowedOrigins: [TRUSTED_ORIGIN],
    },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
  return app
}

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', 'initial'])
  return root
}

function trustedOriginHeaders(headers: HeadersInit = {}) {
  return {
    ...headers,
    origin: TRUSTED_ORIGIN,
  }
}

async function errorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } }
  return payload.error.code
}
