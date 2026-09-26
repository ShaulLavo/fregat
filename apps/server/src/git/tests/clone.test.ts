import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GitCloneProgressEvent } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../../testing/git'
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

  it('publishes exactly one of two concurrent clones', async () => {
    const { root, source, git } = await workspace()
    const first = git.cloneProgress({ source, destination: 'race' }, async () => 'first')
    const second = git.cloneProgress({ source, destination: 'race' }, async () => 'second')
    await Promise.all([first.next(), second.next()])
    const outcomes = await Promise.all([collect(first), collect(second)])
    expect(outcomes.flat().filter((event) => event.kind === 'result')).toHaveLength(1)
    expect(outcomes.flat().filter((event) => event.kind === 'failed')).toHaveLength(1)
    expect(
      (await runGit(path.join(root, 'race'), ['status', '--porcelain'])).stdout.trimEnd(),
    ).toBe('')
    expect((await readdir(root)).filter((entry) => entry.startsWith('.platform-clone-'))).toEqual(
      [],
    )
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

  it('preserves a destination populated after validation when cloning fails', async () => {
    const { root, git } = await workspace()
    const stream = git.cloneProgress(
      { source: path.join(root, 'missing'), destination: 'raced' },
      async () => null,
    )
    await stream.next()
    await mkdir(path.join(root, 'raced'))
    await writeFile(path.join(root, 'raced/keep.txt'), 'owned elsewhere')
    await collect(stream)
    expect(await readdir(path.join(root, 'raced'))).toEqual(['keep.txt'])
  })

  it('rejects destination ancestors that escape through a symlink', async () => {
    const { root, source } = await workspace()
    const outside = await workspace()
    await symlink(outside.root, path.join(root, 'link'))
    const git = new GitService(createWorkspacePaths(root), {
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    })
    await expect(
      collect(git.cloneProgress({ source, destination: 'link/new/copy' }, async () => null)),
    ).rejects.toThrow()
    expect(await exists(path.join(outside.root, 'new'))).toBe(false)
  })

  it('aborts a spawned git process while stderr is stalled', async () => {
    const { root, git } = await workspace()
    const connected = Promise.withResolvers<void>()
    const disconnected = Promise.withResolvers<void>()
    let connection: Socket | undefined
    const server = createServer((socket) => {
      connection = socket
      socket.once('data', () => connected.resolve())
      socket.once('end', () => socket.end())
      socket.once('close', () => disconnected.resolve())
    })
    server.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    expect(address).toBeTypeOf('object')
    if (!address || typeof address === 'string') return
    const abort = new AbortController()
    const stream = git.cloneProgress(
      { source: `git://127.0.0.1:${address.port}/stalled`, destination: 'cancelled' },
      async () => 'never',
      abort.signal,
    )
    try {
      await stream.next()
      const pending = stream.next()
      await connected.promise
      abort.abort()
      await pending
      await stream.return(undefined)
      await disconnected.promise
      expect(await exists(path.join(root, 'cancelled'))).toBe(false)
      expect((await readdir(root)).filter((name) => name.startsWith('.platform-clone-'))).toEqual(
        [],
      )
    } finally {
      abort.abort()
      connection?.destroy()
      server.close()
    }
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
