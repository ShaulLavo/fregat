import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { WatchServerMessage } from '../contracts'
import { createWorkspacePaths } from '../path'
import { FileChangeHub, nativeEventType } from '../watch'

// macOS reports every mutation to `fs.watch` as a bare `rename`, so these tests
// exercise the only thing standing between an editor save and the client being
// told a file was created: the stat-based classifier.
const cleanups: (() => Promise<void>)[] = []
const eventTimeoutMs = 5000
const batchSeparationMs = 50

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('native watcher event classification', () => {
  it('reports a write to a file that existed before the watcher as changed', async () => {
    const root = await fixtureRoot()
    await seedFile(root, 'existing.txt', 'before')

    const events = await startWatching(root)
    await writeFile(path.join(root, 'existing.txt'), 'after')

    await expectEventForPath(events, 'existing.txt', 'changed')
  })

  it('reports a file that appears while watching as created', async () => {
    const root = await fixtureRoot()
    const events = await startWatching(root)

    await writeFile(path.join(root, 'fresh.txt'), 'hello')

    await expectEventForPath(events, 'fresh.txt', 'created')
  })

  it('reports a removed file as deleted', async () => {
    const root = await fixtureRoot()
    await seedFile(root, 'doomed.txt', 'here')

    const events = await startWatching(root)
    await rm(path.join(root, 'doomed.txt'))

    await expectEventForPath(events, 'doomed.txt', 'deleted')
  })

  it('reports a path that comes back after deletion as created again', async () => {
    const root = await fixtureRoot()
    await seedFile(root, 'phoenix.txt', 'first life')

    const events = await startWatching(root)
    await rm(path.join(root, 'phoenix.txt'))
    await expectEventForPath(events, 'phoenix.txt', 'deleted')

    // A delete and its recreate in one batch coalesce into no event at all.
    await delay(batchSeparationMs)
    await writeFile(path.join(root, 'phoenix.txt'), 'second life')

    await expectEventForPath(events, 'phoenix.txt', 'created')
  })

  it('keeps reporting later writes to a pre-existing file as changed', async () => {
    const root = await fixtureRoot()
    await seedFile(root, 'edited.txt', 'one')

    const events = await startWatching(root)
    await writeFile(path.join(root, 'edited.txt'), 'two')
    await expectEventForPath(events, 'edited.txt', 'changed')

    // inotify coalesces successive identical events for a path into one, so a
    // second write landing in the same batch as the first is not a second
    // event to observe. Separate the batches to make "later" actually later.
    await delay(batchSeparationMs)
    await writeFile(path.join(root, 'edited.txt'), 'three three three')

    await expectEventForPath(events, 'edited.txt', 'changed')
  })

  it('reports a later write to a file born while watching as changed', async () => {
    const root = await fixtureRoot()
    const events = await startWatching(root)

    await writeFile(path.join(root, 'newborn.txt'), 'one')
    await expectEventForPath(events, 'newborn.txt', 'created')

    // Past the creation settle window, so the second write cannot be mistaken
    // for the tail of the first one.
    await delay(400)
    await writeFile(path.join(root, 'newborn.txt'), 'two two two')

    await expectEventForPath(events, 'newborn.txt', 'changed')
  })
})

describe('native event type', () => {
  const attachedAtMs = 1_000_000.7
  const entry = (birthtimeMs: number, mtimeMs = birthtimeMs) =>
    ({ birthtimeMs, mtimeMs }) as Parameters<typeof nativeEventType>[1]

  it('counts a file stamped a clock tick before the attach as born while watching', () => {
    // File timestamps come from the kernel's coarse clock, which trails the precise one.
    expect(nativeEventType('rename', entry(attachedAtMs - 3), attachedAtMs)).toBe('created')
    expect(
      nativeEventType('rename', entry(attachedAtMs - 500, attachedAtMs - 3), attachedAtMs),
    ).toBe('changed')
  })

  it('still ignores a replayed write that clearly predates the watcher', () => {
    expect(
      nativeEventType('rename', entry(attachedAtMs - 500, attachedAtMs - 100), attachedAtMs),
    ).toBe(null)
  })
})

type EventStream = AsyncIterator<WatchServerMessage>

async function startWatching(root: string) {
  const hub = new FileChangeHub(createWorkspacePaths(root), { enabled: true })
  const abort = new AbortController()
  const events: EventStream = hub.stream([''], abort.signal)[Symbol.asyncIterator]()

  cleanups.push(async () => {
    abort.abort()
    await events.return?.()
    await hub.close()
  })

  // The stream only yields `ready` after the native watcher is attached, which
  // makes it the barrier every test here needs before touching the filesystem.
  expect((await events.next()).value).toMatchObject({ type: 'ready' })
  // FSEvents delivers in coalescing batches: a mutation made in the same batch
  // as the attach can be merged away entirely, exactly as the oracle test's own
  // comment describes for inotify. Let the attach batch close first.
  await delay(batchSeparationMs)

  return events
}

// Matches on type as well as path, the way the SSE oracle in app.test.ts does.
// A watcher's first event for a path can be a write replayed from before it
// attached, so "the next event" and "the event this test caused" are not the
// same thing. A misclassification still fails — as a timeout, with the types
// actually seen for that path.
async function expectEventForPath(
  events: EventStream,
  relativePath: string,
  type: 'created' | 'changed' | 'deleted',
) {
  const seen: string[] = []
  const deadline = Date.now() + eventTimeoutMs

  while (Date.now() < deadline) {
    const next = await Promise.race([events.next(), expire(deadline - Date.now())])
    if (next === 'expired') break
    if (next.done) break

    const event = next.value
    if (!('path' in event) || event.path !== relativePath) continue
    if (event.type === type) return

    seen.push(event.type)
  }

  throw new Error(
    `never saw a ${type} event for ${relativePath}; saw [${seen.join(', ') || 'nothing'}]`,
  )
}

function expire(ms: number) {
  return new Promise<'expired'>((resolve) => setTimeout(() => resolve('expired'), ms))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// Stat timestamps are whole milliseconds, so "this file existed before the
// watcher" is only a fact the classifier can read if the write lands in an
// earlier millisecond than the attach. Real workspaces are seeded long before a
// watcher starts; these tests have to spend the millisecond deliberately.
async function seedFile(root: string, relativePath: string, contents: string) {
  await writeFile(path.join(root, relativePath), contents)
  await delay(2)
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'watch-classification-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))

  return root
}
