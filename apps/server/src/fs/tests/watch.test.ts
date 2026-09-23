import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

// One `sh` per subscribe was left behind on the production server while Watchman is absent.
describe.runIf(process.platform === 'linux')('native watch lifetime', () => {
  it('opens a live watch without leaving an unreaped shell', async () => {
    const root = await fixtureRoot()
    const before = await zombieShells()
    const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
    const abort = new AbortController()
    const events = hub.stream([''], abort.signal)[Symbol.asyncIterator]()

    expect(await nextRequiredEvent(events)).toMatchObject({ type: 'ready' })
    abort.abort()
    await delay(200)

    expect(await zombieShells()).toEqual(before)
  })
})

async function zombieShells() {
  const children = await readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8')
  const stats = await Promise.all(
    children
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((pid) => readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')),
  )
  return stats.filter((stat) => /\(sh\) Z /.test(stat)).map((stat) => stat.split(' ')[0])
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
