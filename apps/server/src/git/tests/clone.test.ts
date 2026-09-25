import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GitCloneProgressEvent } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../../../test/factories/git-worktree'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { cloneUrl, parseCloneProgress } from '../clone'
import { GitService } from '../service'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-clone-'))
  roots.push(root)
  const source = path.join(root, 'source')
  await mkdir(source)
  await runGit(source, ['init', '-b', 'main'])
  await runGit(source, ['config', 'user.email', 'test@example.com'])
  await runGit(source, ['config', 'user.name', 'Test User'])
  await writeFile(path.join(source, 'readme.md'), 'hello\n')
  await runGit(source, ['add', '--all'])
  await runGit(source, ['commit', '-m', 'initial'])
  const git = new GitService(createWorkspacePaths(root), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
  return { root, source, git }
}

async function collect(stream: AsyncGenerator<GitCloneProgressEvent>) {
  const events: GitCloneProgressEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  )

describe('clone', () => {
  it('clones into a new folder, reports progress and registers the checkout', async () => {
    const { root, source, git } = await workspace()
    const registered: string[] = []
    const events = await collect(
      git.cloneProgress({ source, destination: 'projects/copy' }, async (checkout) => {
        registered.push(checkout)
        return 'project-1'
      }),
    )
    expect(events[0]).toEqual({ kind: 'progress', stage: 'connecting', percent: null })
    expect(events.at(-1)).toEqual({ kind: 'result', path: 'projects/copy', projectId: 'project-1' })
    expect(registered).toEqual([path.join(root, 'projects/copy')])
    expect(await exists(path.join(root, 'projects/copy/readme.md'))).toBe(true)
  })

  it('refuses a folder with files and leaves it as it was', async () => {
    const { root, source, git } = await workspace()
    await mkdir(path.join(root, 'taken'))
    await writeFile(path.join(root, 'taken', 'keep.txt'), 'mine\n')
    const events = await collect(
      git.cloneProgress({ source, destination: 'taken' }, async () => null),
    )
    expect(events).toEqual([{ kind: 'failed', message: 'That folder is not empty.' }])
    expect(await readdir(path.join(root, 'taken'))).toEqual(['keep.txt'])
  })

  it('a failed clone reports git and leaves no folder or project behind', async () => {
    const { root, git } = await workspace()
    let registered = false
    const events = await collect(
      git.cloneProgress({ source: path.join(root, 'missing'), destination: 'broken' }, async () => {
        registered = true
        return null
      }),
    )
    expect(events.at(-1)?.kind).toBe('failed')
    expect(registered).toBe(false)
    expect(await exists(path.join(root, 'broken'))).toBe(false)
  })

  it('a cancelled clone removes what it wrote and keeps an empty folder the user chose', async () => {
    const { root, source, git } = await workspace()
    await mkdir(path.join(root, 'chosen'))
    const stream = git.cloneProgress({ source, destination: 'chosen' }, async () => 'never')
    expect((await stream.next()).value).toMatchObject({ stage: 'connecting' })
    await stream.return(undefined)
    expect(await readdir(path.join(root, 'chosen'))).toEqual([])
  })
})

describe('clone input', () => {
  it('reads owner/repo as GitHub and progress lines as stages', () => {
    expect(cloneUrl('acme/repo')).toBe('https://github.com/acme/repo.git')
    expect(cloneUrl('git@gitlab.com:group/project.git')).toBe('git@gitlab.com:group/project.git')
    expect(parseCloneProgress('Receiving objects:  45% (9/20), 1.2 MiB | 3 MiB/s')).toEqual({
      stage: 'receiving',
      percent: 45,
    })
    expect(parseCloneProgress('remote: Counting objects: 100% (3/3), done.')).toEqual({
      stage: 'counting',
      percent: 100,
    })
    expect(parseCloneProgress('Cloning into bare repository')).toBeNull()
  })
})
