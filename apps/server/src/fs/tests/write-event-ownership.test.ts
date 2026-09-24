import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, vi } from 'vitest'
import { watchedFiles } from '../../../test/factories/watched-files'
import type { WatchServerMessage } from '../contracts'
import { fileVersion, textFileVersion } from '../version'

const origin = 'conflict-editor-resolution'
type FilesystemEvent = Extract<
  WatchServerMessage,
  { type: 'created' | 'changed' | 'deleted' | 'renamed' }
>

test('correlates repeated real write/create echoes and hides only issued temporary files', async () => {
  const { root, service, events } = await watchedFiles()
  await mkdir(path.join(root, 'physical'))
  await symlink('physical', path.join(root, 'alias'))
  await delay(100)
  const content = 'a'.repeat(16 * 1024 * 1024)
  await service.createFile({ path: 'alias/file.txt', content, origin, writeId: 'create' })
  await vi.waitFor(() => expect(targetEvents(events).length).toBeGreaterThanOrEqual(2), {
    timeout: 5000,
  })
  expect(targetEvents(events).every((event) => event.writeId === 'create')).toBe(true)
  events.length = 0

  await service.write({ path: 'alias/file.txt', content: 'saved', origin, writeId: 'write' })
  await vi.waitFor(() => expect(targetEvents(events).length).toBeGreaterThanOrEqual(2))
  await delay(100)
  expect(targetEvents(events).every((event) => event.writeId === 'write')).toBe(true)
  expect(events.some((event) => 'path' in event && event.path.endsWith('.tmp'))).toBe(false)

  events.length = 0
  await utimes(path.join(root, 'physical/file.txt'), 1_800_000_000, 1_800_000_000)
  await vi.waitFor(() => expect(targetEvents(events).length).toBeGreaterThan(0))
  expect(targetEvents(events).every((event) => event.writeId === 'write')).toBe(true)
  events.length = 0
  await writeFile(path.join(root, 'physical/.external.tmp'), 'external save')
  await vi.waitFor(() =>
    expect(events.some((event) => 'path' in event && event.path === 'physical/.external.tmp')).toBe(
      true,
    ),
  )
})

test('keeps real writes external when bytes change with identical stat versions', async () => {
  const { root, service, events } = await watchedFiles()
  const file = path.join(root, 'file.txt')
  await delay(100)
  await service.createFile({ path: 'file.txt', content: 'before', origin, writeId: 'own' })
  await vi.waitFor(() => expect(fileEvents(events).length).toBeGreaterThanOrEqual(2))
  await utimes(file, 1_800_000_000, 1_800_000_000)
  await delay(150)
  const before = await stat(file)
  events.length = 0

  await writeFile(file, 'change')
  await utimes(file, 1_800_000_000, 1_800_000_000)
  expect(fileVersion(await stat(file))).toBe(fileVersion(before))
  await vi.waitFor(() =>
    expect(fileEvents(events).some((event) => event.version === textFileVersion('change'))).toBe(
      true,
    ),
  )
  expect(fileEvents(events).every((event) => !event.origin && !event.writeId)).toBe(true)
  expect(await readFile(file, 'utf8')).toBe('change')
  events.length = 0
  await rm(file)
  await vi.waitFor(() =>
    expect(fileEvents(events).some((event) => event.type === 'deleted')).toBe(true),
  )
  expect(fileEvents(events).every((event) => !event.origin && !event.writeId)).toBe(true)
})

test.each(['write', 'create'] as const)('releases native events after failed %s', async (kind) => {
  const { root, service, events } = await watchedFiles()
  const file = path.join(root, 'file.txt')
  await writeFile(file, 'before')
  await delay(100)
  events.length = 0
  const body = { path: 'file.txt', content: 'mine', origin, writeId: 'failed' }
  const pending =
    kind === 'write'
      ? service.write({ ...body, baseVersion: textFileVersion('stale') })
      : service.createFile(body)
  await expect(pending).rejects.toMatchObject({
    code: kind === 'write' ? 'FILE_CHANGED' : 'ALREADY_EXISTS',
  })
  await writeFile(file, 'external after failure')
  await vi.waitFor(() => expect(fileEvents(events).length).toBeGreaterThan(0))
  expect(fileEvents(events).every((event) => !event.origin && !event.writeId)).toBe(true)
  expect(await readFile(file, 'utf8')).toBe('external after failure')
})

test.each([true, false])(
  'replays queued external events after write settlement: success %s',
  async (success) => {
    const { service, events } = await watchedFiles(false)
    const hub = service.changes
    const barrier = hub.beginWrite(['file.txt'])
    hub.emit({ type: 'changed', path: 'file.txt', version: textFileVersion('external') })
    hub.emit({ type: 'deleted', path: 'file.txt' })
    hub.finishWrite(
      barrier,
      success
        ? {
            type: 'changed',
            path: 'file.txt',
            origin,
            writeId: 'mine',
            version: textFileVersion('mine'),
          }
        : undefined,
    )
    await vi.waitFor(() => expect(fileEvents(events)).toHaveLength(success ? 3 : 2))
    const external = fileEvents(events).filter((event) => !event.writeId)
    expect(external).toMatchObject([
      { type: 'changed', version: textFileVersion('external') },
      { type: 'deleted' },
    ])
  },
)

function fileEvents(events: readonly WatchServerMessage[]) {
  return events.filter(
    (event): event is FilesystemEvent => isFilesystemEvent(event) && event.path === 'file.txt',
  )
}

function targetEvents(events: readonly WatchServerMessage[]) {
  return events.filter(
    (event): event is FilesystemEvent =>
      isFilesystemEvent(event) && event.path.endsWith('/file.txt'),
  )
}

function isFilesystemEvent(event: WatchServerMessage): event is FilesystemEvent {
  return (
    event.type === 'created' ||
    event.type === 'changed' ||
    event.type === 'deleted' ||
    event.type === 'renamed'
  )
}
