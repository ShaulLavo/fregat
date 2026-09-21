import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import {
  createConflictResolutionFixture,
  watchConflictResolutionEvents,
} from '../../../../test/factories/conflict-resolution'
import { createInProcessClient } from '../../../../test/client'
import { makeTestServer } from '../../../../test/server'
import { getClient, setClient } from '@/lib/client'
import { log } from '@/lib/client-logging'
import { fileSystemKeys } from '@/lib/query-keys'
import { fileDocumentKey } from '@/lib/documents/utils/identity'

// The wide event records completion after persistence and local reconciliation.
function observeResolution() {
  const observer = vi.spyOn(log, 'info')
  const recorded = () =>
    observer.mock.calls.flatMap(([event]) => {
      const input: unknown = event
      const value: unknown = typeof input === 'function' ? input() : input
      if (
        !value ||
        typeof value !== 'object' ||
        !('action' in value) ||
        value.action !== 'conflict.resolve'
      )
        return []
      return [value]
    })
  return {
    outcomes: () => recorded().map((event) => ('outcome' in event ? event.outcome : undefined)),
    writeIds: () => recorded().map((event) => ('writeId' in event ? event.writeId : undefined)),
    restore: () => observer.mockRestore(),
  }
}

test('conflict resolution keeps its owner through debounce and persistence', async ({ server }) => {
  const fixture = await createConflictResolutionFixture(server)
  const other = await makeTestServer()
  const previous = getClient()
  const events = observeResolution()
  try {
    await writeFile(join(other.root, fixture.path), 'other machine')
    fixture.schedule()
    setClient(createInProcessClient(other))
    await fixture.transport.entered
    fixture.transport.release()
    await expect.poll(events.outcomes).toEqual(['resolved'])
    expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('merged text')
    expect(await readFile(join(other.root, fixture.path), 'utf8')).toBe('other machine')
    expect(fixture.destinationText()).toBe('merged text')
    expect(fixture.documentStore.getState().getLiveEditorDocument(fixture.key)).toBeNull()
    expect(fixture.conflictStore.getState().conflicts).toEqual({})
    expect(
      fixture.queryClient.getQueryData(fileSystemKeys.fileSnapshot(fixture.path)),
    ).toMatchObject({ content: 'merged text' })
  } finally {
    setClient(previous)
    events.restore()
    fixture.dispose()
    await other.cleanup()
  }
})

test.for(['destination', 'conflict'] as const)(
  'newer %s survives an acknowledged resolution write',
  async (change, { server }) => {
    const fixture = await createConflictResolutionFixture(server)
    const events = observeResolution()
    try {
      fixture.schedule()
      await fixture.transport.entered
      if (change === 'destination') fixture.editDestination()
      else
        fixture.conflictStore.getState().addConflict({
          ...fixture.conflictStore.getState().conflicts[fixture.target.conflictId]!,
          remoteText: 'new conflict',
        })
      fixture.transport.release()
      await expect.poll(events.outcomes).toEqual(['unresolved'])
      expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('merged text')
      expect(fixture.documentStore.getState().getLiveEditorDocument(fixture.key)).not.toBeNull()
      expect(fixture.destinationText()).toBe(
        change === 'destination' ? 'remote textnew ' : 'remote text',
      )
      expect(fixture.conflictStore.getState().conflicts[fixture.target.conflictId]).toBeDefined()
      expect(
        fixture.transport.requests.filter(
          (request) => new URL(request.url).pathname === '/fs/write',
        ),
      ).toHaveLength(1)
    } finally {
      events.restore()
      fixture.dispose()
    }
  },
)

test('newer resolution retries with the acknowledged base and finishes its second write', async ({
  server,
}) => {
  const fixture = await createConflictResolutionFixture(server)
  const events = observeResolution()
  try {
    fixture.schedule()
    await fixture.transport.entered
    fixture.editResolution()
    fixture.schedule()
    fixture.transport.release()
    await expect.poll(events.outcomes).toEqual(['retry', 'resolved'])
    expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('merged textnew ')
    expect(fixture.destinationText()).toBe('merged textnew ')
    expect(fixture.conflictStore.getState().conflicts).toEqual({})
    expect(fixture.documentStore.getState().getLiveEditorDocument(fixture.key)).toBeNull()
    const requests = fixture.transport.requests.filter(
      (request) => new URL(request.url).pathname === '/fs/write',
    )
    const bodies = await Promise.all(requests.map((request) => request.json()))
    expect(bodies).toHaveLength(2)
    expect(bodies[0].baseVersion).not.toBe(bodies[1].baseVersion)
    expect(bodies.map((body) => body.content)).toEqual(['merged text', 'merged textnew '])
  } finally {
    events.restore()
    fixture.dispose()
  }
})

test.for(['root', 'destination', 'resolution'] as const)(
  'changed %s before debounce prevents the write',
  async (change, { server }) => {
    const fixture = await createConflictResolutionFixture(server)
    const events = observeResolution()
    try {
      fixture.schedule()
      if (change === 'root') fixture.resetRoot()
      if (change === 'destination') fixture.editDestination()
      if (change === 'resolution') fixture.editResolution()
      await expect.poll(events.outcomes).toEqual(['stale'])
      expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('remote text')
      expect(fixture.transport.requests.some((request) => request.method === 'POST')).toBe(false)
    } finally {
      events.restore()
      fixture.dispose()
    }
  },
)

test('a deleted file recreated before resolution cannot be overwritten', async ({ server }) => {
  const fixture = await createConflictResolutionFixture(server, true)
  const errors = vi.spyOn(log, 'warn')
  try {
    await rm(join(server.root, fixture.path))
    fixture.schedule()
    await writeFile(join(server.root, fixture.path), 'recreated text')
    await fixture.transport.entered
    fixture.transport.release()
    await expect.poll(() => errors.mock.calls.length).toBeGreaterThan(0)
    expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('recreated text')
    expect(fixture.conflictStore.getState().conflicts[fixture.target.conflictId]).toBeDefined()
    expect(fixture.documentStore.getState().getLiveEditorDocument(fixture.key)).not.toBeNull()
  } finally {
    errors.mockRestore()
    fixture.dispose()
  }
})

test('an absent destination opened then closed during the write invalidates completion', async ({
  server,
}) => {
  const fixture = await createConflictResolutionFixture(server)
  const events = observeResolution()
  try {
    fixture.documentStore.getState().deleteLiveEditorDocument(fileDocumentKey(fixture.path))
    fixture.schedule()
    await fixture.transport.entered
    fixture.documentStore.getState().ensureLiveEditorDocument(fixture.remote)
    fixture.documentStore.getState().deleteLiveEditorDocument(fileDocumentKey(fixture.path))
    fixture.transport.release()
    await expect.poll(events.outcomes).toEqual(['unresolved'])
    expect(fixture.destinationText()).toBeUndefined()
    expect(fixture.conflictStore.getState().conflicts[fixture.target.conflictId]).toBeDefined()
  } finally {
    events.restore()
    fixture.dispose()
  }
})

test('a queued resolution survives the deleted-file folder wait', async ({ server }) => {
  const fixture = await createConflictResolutionFixture(
    server,
    true,
    '/fs/create-folder',
    'nested/conflict.txt',
  )
  const events = observeResolution()
  try {
    await rm(join(server.root, 'nested'), { recursive: true })
    fixture.schedule()
    await fixture.transport.entered
    fixture.editResolution()
    vi.useFakeTimers()
    fixture.schedule()
    await vi.advanceTimersByTimeAsync(250)
    vi.useRealTimers()
    fixture.transport.release()
    await expect.poll(events.outcomes).toEqual(['stale', 'resolved'])
    expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('merged textnew ')
    expect(fixture.conflictStore.getState().conflicts).toEqual({})
  } finally {
    vi.useRealTimers()
    events.restore()
    fixture.dispose()
  }
})

test.for([
  { deleted: false, watchBackend: 'auto' },
  { deleted: true, watchBackend: 'auto' },
  { deleted: false, watchBackend: 'node' },
  { deleted: true, watchBackend: 'node' },
] as const)(
  'own watcher events preserve completion and retry, deleted $deleted on $watchBackend',
  async ({ deleted, watchBackend }) => {
    const server = await makeTestServer({ watchBackend })
    const fixture = await createConflictResolutionFixture(server, deleted)
    if (deleted) await rm(join(server.root, fixture.path))
    fixture.editDestination()
    const watcher = await watchConflictResolutionEvents(fixture)
    const events = observeResolution()
    try {
      fixture.schedule()
      await fixture.transport.entered
      await expect
        .poll(() => watcher.events.filter((event) => event.writeId).length)
        .toBeGreaterThan(1)
      const published = watcher.events.find((event) => event.writeId)
      expect(published).toMatchObject({
        type: deleted ? 'created' : 'changed',
        origin: 'conflict-editor-resolution',
      })
      await watcher.flush()
      expect(watcher.gitInvalidations()).toBeGreaterThan(0)
      fixture.editResolution()
      fixture.schedule()
      fixture.transport.release()
      await expect.poll(events.outcomes).toEqual(['retry'])
      // Replay the same emitted event after acknowledgement, while retry is debouncing.
      if (published) watcher.events.push(published)
      await watcher.flush()
      await expect.poll(events.outcomes).toEqual(['retry', 'resolved'])
      expect(events.writeIds()[0]).toBe(published?.writeId)
      expect(new Set(events.writeIds()).size).toBe(2)
      expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('merged textnew ')
      expect(fixture.destinationText()).toBe('merged textnew ')
      expect(fixture.conflictStore.getState().conflicts).toEqual({})
      expect(fixture.documentStore.getState().getLiveEditorDocument(fixture.key)).toBeNull()
    } finally {
      await watcher.stop()
      events.restore()
      fixture.dispose()
      await server.cleanup()
    }
  },
)

test.for([false, true])(
  'external watcher changes during an owned acknowledgement remain conflicts, deleted target %s',
  async (deleted, { server }) => {
    const fixture = await createConflictResolutionFixture(server, deleted)
    if (deleted) await rm(join(server.root, fixture.path))
    fixture.editDestination()
    const watcher = await watchConflictResolutionEvents(fixture)
    const events = observeResolution()
    try {
      fixture.schedule()
      await fixture.transport.entered
      await writeFile(join(server.root, fixture.path), 'external change')
      await expect
        .poll(() => watcher.events.some((event) => event.path === fixture.path && !event.writeId))
        .toBe(true)
      await watcher.flush()
      fixture.transport.release()
      await expect.poll(events.outcomes).toEqual(['unresolved'])
      expect(await readFile(join(server.root, fixture.path), 'utf8')).toBe('external change')
      expect(fixture.destinationText()).toBe('remote textnew ')
      expect(fixture.conflictStore.getState().conflicts).not.toEqual({})
      expect(
        fixture.documentStore
          .getState()
          .getLiveEditorDocument(fixture.key)
          ?.buffer.materializeFullText(),
      ).toBe('merged text')
    } finally {
      await watcher.stop()
      events.restore()
      fixture.dispose()
    }
  },
)
