import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WatchServerMessage } from '@workspace/contracts'
import { startWorkspaceEventStreams } from '@/features/workspace/state/event-streams'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { test, expect } from '../../../../test/fixtures'

test('keeps the project stream and retained file events alive across tab changes', async ({
  server,
  client,
}) => {
  await mkdir(path.join(server.root, 'project', 'dist'), { recursive: true })
  const first = 'project/dist/first.txt'
  const second = 'project/dist/second.txt'
  await writeFile(path.join(server.root, first), 'first')
  await writeFile(path.join(server.root, second), 'second')
  const messages: WatchServerMessage[] = []
  const readyFiles: (readonly string[])[] = []
  const errors: unknown[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: (message) => messages.push(message),
    onFilesReady: (files) => readyFiles.push(files),
    onError: (error) => errors.push(error),
  })
  try {
    streams.setFiles([first])
    await expect.poll(() => readyFiles).toEqual([[first]])
    await expect.poll(() => messages.filter((message) => message.type === 'ready')).toHaveLength(1)
    streams.setFiles([first, second])
    streams.setFiles([first])
    streams.setFiles([first, second])
    await writeFile(path.join(server.root, first), 'changed while adding a tab')
    await expect
      .poll(() => messages)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: first }))
    await expect.poll(() => readyFiles).toEqual([[first], [second]])
    messages.length = 0
    streams.setFiles([first, second, first])
    streams.setFiles([first])
    await writeFile(path.join(server.root, first), 'changed while closing a tab')
    await expect
      .poll(() => messages)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: first }))
    expect(messages.some((message) => message.type === 'ready')).toBe(false)
    expect(readyFiles).toEqual([[first], [second]])
    streams.setFiles([])
    await writeFile(path.join(server.root, 'project', 'ordinary.txt'), 'project is still watched')
    await expect
      .poll(() => messages)
      .toContainEqual(expect.objectContaining({ path: 'project/ordinary.txt' }))
    expect(errors).toEqual([])
    expect(messages.some((message) => message.type === 'error')).toBe(false)
  } finally {
    streams.close()
  }
})

test('a file-only subscription excludes unrelated project events', async ({ server, client }) => {
  await mkdir(path.join(server.root, 'project'))
  await writeFile(path.join(server.root, 'project', 'open.txt'), 'before')
  const controller = new AbortController()
  const messages: WatchServerMessage[] = []
  const completion = streamWorkspaceEvents(
    client,
    'project',
    controller.signal,
    (message) => messages.push(message),
    ['project/open.txt'],
    'files',
  ).catch((error: unknown) => {
    if (!controller.signal.aborted) throw error
  })
  try {
    await expect.poll(() => messages).toContainEqual(expect.objectContaining({ type: 'ready' }))
    await writeFile(path.join(server.root, 'project', 'unrelated.txt'), 'not subscribed')
    await writeFile(path.join(server.root, 'project', 'open.txt'), 'after')
    await expect
      .poll(() => messages)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: 'project/open.txt' }))
    expect(
      messages.some((message) => 'path' in message && message.path === 'project/unrelated.txt'),
    ).toBe(false)
  } finally {
    controller.abort()
    await completion
  }
})
