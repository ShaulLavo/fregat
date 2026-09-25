import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitCheckpointStore } from '../checkpoint-store'
import { GitService } from '../service'
import { runGit } from '../../testing/git'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git checkpoint capture', () => {
  it('round-trips the worktree through capture, edit, and restore', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'tracked.txt'), 'captured\n')
    await writeFile(path.join(root, 'fresh.txt'), 'new file\n')

    await store.capture({ path: '', ref: REF })
    await writeFile(path.join(root, 'tracked.txt'), 'drifted\n')
    await writeFile(path.join(root, 'fresh.txt'), 'drifted too\n')
    await writeFile(path.join(root, 'later.txt'), 'written after the checkpoint\n')
    await rm(path.join(root, 'sub/nested.txt'))

    expect(await store.restore({ path: '', ref: REF })).toBe(true)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('captured\n')
    expect(await readFile(path.join(root, 'fresh.txt'), 'utf8')).toBe('new file\n')
    expect(await readFile(path.join(root, 'sub/nested.txt'), 'utf8')).toBe('nested\n')
    await expect(readFile(path.join(root, 'later.txt'), 'utf8')).rejects.toThrow()
  })

  it('leaves the user index exactly as it was', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'tracked.txt'), 'staged content\n')
    await runGit(root, ['add', 'tracked.txt'])
    await writeFile(path.join(root, 'tracked.txt'), 'worktree content\n')
    await writeFile(path.join(root, 'untracked.txt'), 'never staged\n')
    const before = await porcelain(root)

    await store.capture({ path: '', ref: REF })

    expect(await porcelain(root)).toBe(before)
    expect(before).toContain('MM tracked.txt')
    expect(before).toContain('?? untracked.txt')
    const staged = await runGit(root, ['show', ':tracked.txt'])
    expect(staged.stdout).toBe('staged content\n')
  })

  it('captures the worktree, not the index', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'tracked.txt'), 'staged content\n')
    await runGit(root, ['add', 'tracked.txt'])
    await writeFile(path.join(root, 'tracked.txt'), 'worktree content\n')

    const commit = await store.capture({ path: '', ref: REF })

    const captured = await runGit(root, ['show', `${commit}:tracked.txt`])
    expect(captured.stdout).toBe('worktree content\n')
  })

  it('deletes its temporary index file', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)

    await store.capture({ path: '', ref: REF })

    const gitDir = await readdir(path.join(root, '.git'))
    expect(gitDir.filter((entry) => entry.startsWith('checkpoint-index-'))).toEqual([])
  })

  it('includes untracked files and excludes ignored ones', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, '.gitignore'), 'ignored.txt\nbuild/\n')
    await writeFile(path.join(root, 'ignored.txt'), 'secret\n')
    await writeFile(path.join(root, 'untracked.txt'), 'keep me\n')

    const commit = await store.capture({ path: '', ref: REF })

    const files = await runGit(root, ['ls-tree', '-r', '--name-only', commit])
    const paths = files.stdout.trim().split('\n')
    expect(paths).toContain('untracked.txt')
    expect(paths).toContain('.gitignore')
    expect(paths).not.toContain('ignored.txt')
  })

  it('captures a repository with no commits yet', async () => {
    const root = await emptyRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'turn-zero.txt'), 'baseline\n')

    const commit = await store.capture({ path: '', ref: REF })

    expect(await store.has({ path: '', ref: REF })).toBe(true)
    const captured = await runGit(root, ['show', `${commit}:turn-zero.txt`])
    expect(captured.stdout).toBe('baseline\n')
    const parents = await runGit(root, ['rev-list', '--parents', '-n', '1', commit])
    expect(parents.stdout.trim()).toBe(commit)
  })

  it('restores a repository with no commits yet', async () => {
    const root = await emptyRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'turn-zero.txt'), 'baseline\n')
    await store.capture({ path: '', ref: REF })
    await writeFile(path.join(root, 'turn-zero.txt'), 'drifted\n')

    expect(await store.restore({ path: '', ref: REF })).toBe(true)
    expect(await readFile(path.join(root, 'turn-zero.txt'), 'utf8')).toBe('baseline\n')
  })

  it('deletes checkpoint refs', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await store.capture({ path: '', ref: REF })

    await store.deleteRefs({ path: '', refs: [REF, 'refs/platform/checkpoints/missing'] })

    expect(await store.has({ path: '', ref: REF })).toBe(false)
  })
})

describe('git checkpoint restore', () => {
  it('leaves the index clean so the revert reads as unstaged work', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await store.capture({ path: '', ref: REF })
    await writeFile(path.join(root, 'tracked.txt'), 'agent edit\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'agent turn'])
    await writeFile(path.join(root, 'tracked.txt'), 'more agent edits\n')

    expect(await store.restore({ path: '', ref: REF })).toBe(true)

    const staged = await runGit(root, ['diff', '--cached', '--name-only'])
    expect(staged.stdout.trim()).toBe('')
    // The revert itself is still visible: it is unstaged worktree drift.
    const unstaged = await runGit(root, ['diff', '--name-only'])
    expect(unstaged.stdout.trim()).toBe('tracked.txt')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('one\n')
  })
})

describe('git checkpoint diff', () => {
  it('diffs two captured refs that hasRef accepts', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await store.capture({ path: '', ref: REF })
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await writeFile(path.join(root, 'added.txt'), 'added\n')
    await store.capture({ path: '', ref: LATER_REF })

    expect(await store.has({ path: '', ref: REF })).toBe(true)
    expect(await store.has({ path: '', ref: LATER_REF })).toBe(true)
    const diffs = await store.diff({
      fromRef: REF,
      ignoreWhitespace: false,
      path: '',
      toRef: LATER_REF,
    })

    expect(diffs.map((diff) => diff.path).toSorted()).toEqual(['added.txt', 'tracked.txt'])
  })

  it('hides whitespace-only changes when asked to', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await store.capture({ path: '', ref: REF })
    await writeFile(path.join(root, 'tracked.txt'), 'one   \n')
    await store.capture({ path: '', ref: LATER_REF })

    const counted = await store.diff({
      fromRef: REF,
      ignoreWhitespace: false,
      path: '',
      toRef: LATER_REF,
    })
    const displayed = await store.diff({
      fromRef: REF,
      ignoreWhitespace: true,
      path: '',
      toRef: LATER_REF,
    })

    expect(counted.map((diff) => diff.path)).toEqual(['tracked.txt'])
    expect(displayed).toEqual([])
  })

  it('falls back to HEAD when the base ref was never captured', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    await store.capture({ path: '', ref: LATER_REF })

    const diffs = await store.diff({
      fallbackFromToHead: true,
      fromRef: REF,
      ignoreWhitespace: false,
      path: '',
      toRef: LATER_REF,
    })

    expect(diffs.map((diff) => diff.path)).toEqual(['tracked.txt'])
  })

  it('fails with a structured error when the base ref is unavailable', async () => {
    const root = await fixtureRepo()
    const store = checkpointStore(root)
    await store.capture({ path: '', ref: LATER_REF })

    await expect(
      store.diff({ fromRef: REF, ignoreWhitespace: false, path: '', toRef: LATER_REF }),
    ).rejects.toMatchObject({ code: 'git.CHECKPOINT_REF_UNAVAILABLE' })
  })
})

const REF = 'refs/platform/checkpoints/turn/0'
const LATER_REF = 'refs/platform/checkpoints/turn/1'

function checkpointStore(root: string) {
  return new GitCheckpointStore(
    new GitService(createWorkspacePaths(root), { maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES }),
  )
}

async function porcelain(root: string) {
  const result = await runGit(root, ['status', '--porcelain', '--untracked-files=all'])
  return result.stdout
}

async function emptyRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-checkpoint-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  return root
}

async function fixtureRepo() {
  const root = await emptyRepo()
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await Bun.write(path.join(root, 'sub/nested.txt'), 'nested\n')
  await runGit(root, ['add', '.'])
  await runGit(root, ['commit', '-m', 'initial'])
  return root
}
