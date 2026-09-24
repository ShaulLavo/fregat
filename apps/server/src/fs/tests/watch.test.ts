import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
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
