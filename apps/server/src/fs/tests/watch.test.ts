import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { WatchServerMessage } from '../contracts'
import { createWorkspacePaths } from '../path'
import { FileChangeHub } from '../watch'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file change hub', () => {
  it('broadcasts watcher errors to public and internal streams', async () => {
    const root = await fixtureRoot()
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: false })
    const publicAbort = new AbortController()
    const rawAbort = new AbortController()
    const publicEvents = hub.stream([''], publicAbort.signal)[Symbol.asyncIterator]()
    const rawEvents = hub
      .stream([''], rawAbort.signal, { includeIgnored: true })
      [Symbol.asyncIterator]()

    try {
      expect(await nextRequiredEvent(publicEvents)).toMatchObject({ type: 'ready' })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({ type: 'ready' })

      hub.emit({
        code: 'WATCH_FAILED',
        message: 'watch failed',
        type: 'error',
      })

      expect(await nextRequiredEvent(publicEvents)).toMatchObject({
        code: 'WATCH_FAILED',
        type: 'error',
      })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({
        code: 'WATCH_FAILED',
        type: 'error',
      })
    } finally {
      publicAbort.abort()
      rawAbort.abort()
      await publicEvents.return?.()
      await rawEvents.return?.()
      await hub.close()
    }
  })

  it('keeps ignored filesystem events on internal streams only', async () => {
    const root = await fixtureRoot()
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: false })
    const publicAbort = new AbortController()
    const rawAbort = new AbortController()
    const publicEvents = hub.stream([''], publicAbort.signal)[Symbol.asyncIterator]()
    const rawEvents = hub
      .stream([''], rawAbort.signal, { includeIgnored: true })
      [Symbol.asyncIterator]()

    try {
      expect(await nextRequiredEvent(publicEvents)).toMatchObject({ type: 'ready' })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({ type: 'ready' })

      hub.emit({ type: 'created', path: 'node_modules' })

      expect(await nextRequiredEvent(rawEvents)).toMatchObject({
        path: 'node_modules',
        type: 'created',
      })
      expect(await nextOptionalEvent(publicEvents, 20)).toBeUndefined()
    } finally {
      publicAbort.abort()
      rawAbort.abort()
      await publicEvents.return?.()
      await rawEvents.return?.()
      await hub.close()
    }
  })

  it('splits renames that cross the ignored boundary for public streams', async () => {
    const root = await fixtureRoot()
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: false })
    const publicAbort = new AbortController()
    const rawAbort = new AbortController()
    const publicEvents = hub.stream([''], publicAbort.signal)[Symbol.asyncIterator]()
    const rawEvents = hub
      .stream([''], rawAbort.signal, { includeIgnored: true })
      [Symbol.asyncIterator]()

    try {
      expect(await nextRequiredEvent(publicEvents)).toMatchObject({ type: 'ready' })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({ type: 'ready' })

      hub.emit({
        oldPath: 'src/a.ts',
        path: 'node_modules/a.ts',
        type: 'renamed',
      })

      expect(await nextRequiredEvent(publicEvents)).toMatchObject({
        path: 'src/a.ts',
        type: 'deleted',
      })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({
        oldPath: 'src/a.ts',
        path: 'node_modules/a.ts',
        type: 'renamed',
      })

      hub.emit({
        oldPath: 'node_modules/b.ts',
        path: 'src/b.ts',
        type: 'renamed',
      })

      expect(await nextRequiredEvent(publicEvents)).toMatchObject({
        path: 'src/b.ts',
        type: 'created',
      })
      expect(await nextRequiredEvent(rawEvents)).toMatchObject({
        oldPath: 'node_modules/b.ts',
        path: 'src/b.ts',
        type: 'renamed',
      })
    } finally {
      publicAbort.abort()
      rawAbort.abort()
      await publicEvents.return?.()
      await rawEvents.return?.()
      await hub.close()
    }
  })
})

describe.runIf(process.platform === 'linux')('native watch coverage', () => {
  it('shows language-server paths to internal streams only', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'dist'))
    await mkdir(path.join(root, 'node_modules/existing'), { recursive: true })
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
    const abort = new AbortController()
    const publicEvents = collect(hub.stream([''], abort.signal))
    const rawEvents = collect(hub.stream([''], abort.signal, { includeIgnored: true }))
    try {
      await expect.poll(() => rawEvents.length && publicEvents.length).toBeGreaterThan(0)

      await writeFile(path.join(root, 'dist/index.d.ts'), 'export {}\n')
      await mkdir(path.join(root, 'node_modules/installed'))
      await writeFile(path.join(root, 'node_modules/existing/index.d.ts'), 'export {}\n')
      await writeFile(path.join(root, 'visible.txt'), 'barrier\n')

      await expect
        .poll(() => paths(rawEvents))
        .toEqual(
          expect.arrayContaining(['dist/index.d.ts', 'node_modules/installed', 'visible.txt']),
        )
      await expect.poll(() => paths(publicEvents)).toContain('visible.txt')
      expect(paths(publicEvents)).toEqual(['visible.txt'])
      expect(paths(rawEvents)).not.toContain('node_modules/existing/index.d.ts')
    } finally {
      abort.abort()
      await hub.close()
    }
  })
})

describe.runIf(process.platform === 'linux')('native watch structure changes', () => {
  // Each of these lost the later write under the previous watcher.
  it('keeps watching directories that are created, moved in, renamed or recreated', async () => {
    const base = await fixtureRoot()
    const root = path.join(base, 'root')
    await mkdir(path.join(root, 'existing/deep'), { recursive: true })
    await mkdir(path.join(base, 'outside/inner'), { recursive: true })
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
    const abort = new AbortController()
    const events = collect(hub.stream([''], abort.signal))
    const expectWrite = async (relative: string) => {
      await writeFile(path.join(root, relative), 'x')
      await expect.poll(() => paths(events), { timeout: 3000 }).toContain(relative)
    }
    try {
      await expect.poll(() => events.length).toBeGreaterThan(0)

      await mkdir(path.join(root, 'fresh/a/b'), { recursive: true })
      await expectWrite('fresh/a/b/file.txt')
      await rename(path.join(base, 'outside'), path.join(root, 'moved'))
      await expectWrite('moved/inner/file.txt')
      await rename(path.join(root, 'existing'), path.join(root, 'renamed'))
      await expectWrite('renamed/deep/file.txt')
      await rm(path.join(root, 'renamed'), { recursive: true })
      await mkdir(path.join(root, 'renamed/deep'), { recursive: true })
      await expectWrite('renamed/deep/again.txt')
    } finally {
      abort.abort()
      await hub.close()
    }
  })
})

describe.runIf(process.platform === 'linux')('native watch lifetime', () => {
  it('returns to no watches after repeated opens and closes', async () => {
    const base = await fixtureRoot()
    const root = path.join(base, 'root')
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(base, 'target'))
    await symlink('../target', path.join(root, 'linked'))
    await writeFile(path.join(root, 'src/a.ts'), 'a')
    await writeFile(path.join(base, 'target/b.ts'), 'b')
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
    try {
      for (let round = 0; round < 20; round += 1) {
        const abort = new AbortController()
        const project = collect(hub.stream(['src'], abort.signal))
        const files = collect(
          hub.stream(['src'], abort.signal, {
            files: ['src/a.ts', 'linked/b.ts'],
            onlyFiles: true,
          }),
        )
        await expect.poll(() => project.length > 0 && files.length > 0).toBe(true)
        abort.abort()
      }
      await expect
        .poll(() => hub.info())
        .toMatchObject({
          nativeWatcherCount: 0,
          openFileWatcherCount: 0,
          shallowWatcherCount: 0,
        })
    } finally {
      await hub.close()
    }
  })
})

describe('watch error delivery', () => {
  it('sends a watcher error only to streams that use that watcher', async () => {
    const root = await fixtureRoot()
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: false })
    const abort = new AbortController()
    const covered = hub.stream(['work/projects'], abort.signal)[Symbol.asyncIterator]()
    const unrelated = hub.stream(['home'], abort.signal)[Symbol.asyncIterator]()
    try {
      expect(await nextRequiredEvent(covered)).toMatchObject({ type: 'ready' })
      expect(await nextRequiredEvent(unrelated)).toMatchObject({ type: 'ready' })

      hub.emit({ code: 'WATCH_FAILED', message: 'failed', path: 'work', type: 'error' })

      expect(await nextRequiredEvent(covered)).toMatchObject({ path: 'work', type: 'error' })
      expect(await nextOptionalEvent(unrelated, 20)).toBeUndefined()
    } finally {
      abort.abort()
      await covered.return?.()
      await unrelated.return?.()
      await hub.close()
    }
  })
})

describe.runIf(process.platform === 'linux')('native watch limit and unreadable folders', () => {
  // Root reads every directory, so only an ordinary user can see an unreadable one.
  it.skipIf(process.getuid?.() === 0)(
    'keeps watching past an unreadable directory without reporting an error',
    async () => {
      const root = await fixtureRoot()
      const locked = path.join(root, 'locked')
      await mkdir(path.join(locked, 'inner'), { recursive: true })
      await mkdir(path.join(root, 'open'))
      await chmod(locked, 0o000)
      const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
      const abort = new AbortController()
      const events = collect(hub.stream([''], abort.signal))
      try {
        await expect.poll(() => events.length).toBeGreaterThan(0)
        expect(events[0]).toMatchObject({ type: 'ready', watch: { mode: 'recursive' } })

        await writeFile(path.join(root, 'open/file.txt'), 'x')

        await expect.poll(() => paths(events), { timeout: 3000 }).toContain('open/file.txt')
        expect(events.some((event) => event.type === 'error')).toBe(false)
      } finally {
        abort.abort()
        await hub.close()
        await chmod(locked, 0o755)
      }
    },
  )

  it('watches only the top level of a root over the directory limit', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'a/b/c'), { recursive: true })
    await mkdir(path.join(root, 'd'))
    // The root, a, a/b, a/b/c and d: five directories against a limit of three.
    const hub = new FileChangeHub(createWorkspacePaths(root), {
      enabled: true,
      directoryLimit: () => 3,
    })
    const abort = new AbortController()
    const events = collect(hub.stream([''], abort.signal))
    try {
      await expect.poll(() => events.length).toBeGreaterThan(0)
      expect(events[0]).toMatchObject({ type: 'ready', watch: { mode: 'limited', limit: 3 } })

      await writeFile(path.join(root, 'a/b/nested.txt'), 'x')
      await writeFile(path.join(root, 'top.txt'), 'x')

      await expect.poll(() => paths(events), { timeout: 3000 }).toContain('top.txt')
      expect(paths(events)).not.toContain('a/b/nested.txt')
      expect(hub.info()).toMatchObject({ watchedDirectoryCount: 0 })
    } finally {
      abort.abort()
      await hub.close()
    }
  })

  it('shares one limit across every root and gives freed room to a limited root', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'one/x'), { recursive: true })
    await mkdir(path.join(root, 'two/y'), { recursive: true })
    const hub = new FileChangeHub(createWorkspacePaths(root), {
      enabled: true,
      directoryLimit: () => 3,
    })
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = collect(hub.stream(['one'], firstAbort.signal))
    try {
      await expect.poll(() => first.length).toBeGreaterThan(0)
      expect(first[0]).toMatchObject({ watch: { mode: 'recursive', directoryCount: 2 } })

      const second = collect(hub.stream(['two'], secondAbort.signal))
      await expect.poll(() => second.length).toBeGreaterThan(0)
      expect(second[0]).toMatchObject({ watch: { mode: 'limited', available: 1 } })
      expect(hub.info()).toMatchObject({ watchedDirectoryCount: 2 })

      firstAbort.abort()
      await expect.poll(() => second.some((event) => event.type === 'coverage')).toBe(true)
      expect(second.find((event) => event.type === 'coverage')).toMatchObject({
        path: 'two',
        watch: { mode: 'recursive', directoryCount: 2 },
      })
      expect(hub.info()).toMatchObject({ watchedDirectoryCount: 2 })

      await writeFile(path.join(root, 'two/y/deep.txt'), 'x')
      await expect.poll(() => paths(second), { timeout: 3000 }).toContain('two/y/deep.txt')
    } finally {
      firstAbort.abort()
      secondAbort.abort()
      await hub.close()
    }
  })
})

function collect(stream: AsyncGenerator<WatchServerMessage>) {
  const events: WatchServerMessage[] = []
  void (async () => {
    for await (const event of stream) events.push(event)
  })()
  return events
}

function paths(events: readonly WatchServerMessage[]) {
  return [
    ...new Set(events.flatMap((event) => ('path' in event && event.path ? [event.path] : []))),
  ]
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-watch-'))
  roots.push(root)
  return root
}

async function nextRequiredEvent(
  events: AsyncIterator<WatchServerMessage>,
): Promise<WatchServerMessage> {
  const event = await nextOptionalEvent(events, 50)
  if (event) return event

  throw new Error('Expected watch event')
}

async function nextOptionalEvent(events: AsyncIterator<WatchServerMessage>, timeoutMs: number) {
  const result = await Promise.race([events.next(), delay(timeoutMs).then(() => undefined)])
  if (!result) return undefined
  if (result.done) return undefined

  return result.value
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
