import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WatchServerMessage } from '@workspace/contracts'
import { startWorkspaceEventStreams } from '@/features/workspace/state/event-streams'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { test, expect } from '../../../../test/fixtures'
import { createCuttableEventsClient, createObservedInProcessClient } from '../../../../test/client'
import type { StreamInterruption } from '@/features/workspace/state/event-streams'

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
    onInterrupted: (interruption) => errors.push(interruption),
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

test('reopens both streams after they end and delivers later edits', async ({ server }) => {
  await mkdir(path.join(server.root, 'project'))
  const open = 'project/open.txt'
  await writeFile(path.join(server.root, open), 'before')
  const { client, endEventStreams } = createCuttableEventsClient(server)
  const messages: WatchServerMessage[] = []
  const readyFiles: (readonly string[])[] = []
  const interruptions: StreamInterruption[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: (message) => messages.push(message),
    onFilesReady: (files) => readyFiles.push(files),
    onError: (error) => {
      throw error
    },
    onInterrupted: (interruption) => interruptions.push(interruption),
  })
  try {
    streams.setFiles([open])
    await expect.poll(() => readyFiles).toEqual([[open]])
    await expect.poll(() => messages.filter((message) => message.type === 'ready')).toHaveLength(1)

    endEventStreams()
    await expect
      .poll(() => interruptions.map(({ scope, error }) => ({ scope, failed: error !== undefined })))
      .toEqual(
        expect.arrayContaining([
          { scope: 'project', failed: false },
          { scope: 'files', failed: false },
        ]),
      )
    // Each replacement is a new generation, and its ready is what resynchronizes the page.
    await expect.poll(() => messages.filter((message) => message.type === 'ready')).toHaveLength(2)
    await expect.poll(() => readyFiles).toEqual([[open], [open]])

    messages.length = 0
    await writeFile(path.join(server.root, open), 'after the gap')
    await writeFile(path.join(server.root, 'project', 'new.txt'), 'created after the gap')
    await expect
      .poll(() => messages.flatMap((message) => ('path' in message ? [message.path] : [])))
      .toEqual(expect.arrayContaining([open, 'project/new.txt']))
  } finally {
    streams.close()
  }
})

test('replaces a stream whose watcher failed, since events may have been lost', async ({
  server,
}) => {
  await mkdir(path.join(server.root, 'project'))
  const { client, injectWatchError } = createCuttableEventsClient(server)
  const messages: WatchServerMessage[] = []
  const interruptions: StreamInterruption[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: (message) => messages.push(message),
    onFilesReady: () => undefined,
    onError: (error) => {
      throw error
    },
    onInterrupted: (interruption) => interruptions.push(interruption),
  })
  try {
    await expect.poll(() => messages.filter((message) => message.type === 'ready')).toHaveLength(1)

    injectWatchError()

    await expect.poll(() => messages.map((message) => message.type)).toContain('error')
    await expect.poll(() => interruptions.map(({ scope }) => scope)).toContain('project')
    await expect.poll(() => messages.filter((message) => message.type === 'ready')).toHaveLength(2)
  } finally {
    streams.close()
  }
})

test('a rejected file set is not retried until the set changes', async ({ server }) => {
  await mkdir(path.join(server.root, 'project'))
  const open = 'project/open.txt'
  await writeFile(path.join(server.root, open), 'before')
  const fileRequests: string[] = []
  const client = createObservedInProcessClient(server, (request) => {
    const url = new URL(request.url)
    if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== 'files') return
    fileRequests.push(url.searchParams.get('files') ?? '')
  })
  const readyFiles: (readonly string[])[] = []
  const interruptions: StreamInterruption[] = []
  const errors: unknown[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: () => undefined,
    onFilesReady: (files) => readyFiles.push(files),
    onError: (error) => errors.push(error),
    onInterrupted: (interruption) => interruptions.push(interruption),
  })
  try {
    // The server refuses an absolute path, and with it every other file in the request.
    const rejected = [open, '/work/tmp/outside.log']
    streams.setFiles(rejected)
    await expect.poll(() => fileRequests).toHaveLength(1)
    // Longer than the first two backoff steps, so a retry would have gone out.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(fileRequests).toHaveLength(1)
    expect(interruptions).toEqual([])
    expect(errors).toEqual([])

    streams.setFiles([...rejected].reverse())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fileRequests).toHaveLength(1)

    streams.setFiles([open])
    await expect.poll(() => readyFiles).toEqual([[open]])
    expect(fileRequests).toHaveLength(2)
  } finally {
    streams.close()
  }
})

test('a files stream the server cannot serve yet is retried', async ({ server }) => {
  await mkdir(path.join(server.root, 'project'))
  const open = 'project/open.txt'
  await writeFile(path.join(server.root, open), 'before')
  const fileRequests: (readonly string[])[] = []
  const { client } = createCuttableEventsClient(server, (request) => {
    const files = filesRequest(request)
    if (!files) return undefined
    fileRequests.push(files)
    if (fileRequests.length > 1) return undefined
    return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
  })
  const readyFiles: (readonly string[])[] = []
  const errors: unknown[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: () => undefined,
    onFilesReady: (files) => readyFiles.push(files),
    onError: (error) => errors.push(error),
    onInterrupted: () => undefined,
  })
  try {
    streams.setFiles([open])
    await expect.poll(() => readyFiles).toEqual([[open]])
    expect(fileRequests).toEqual([[open], [open]])
    expect(errors).toEqual([expect.objectContaining({ status: 503 })])
  } finally {
    streams.close()
  }
})

test('a rejected set leaves the running stream watching, and nothing reopens it', async ({
  server,
}) => {
  // The project stream skips `dist`, so only the files stream can report this file.
  await mkdir(path.join(server.root, 'project', 'dist'), { recursive: true })
  const open = 'project/dist/open.txt'
  await writeFile(path.join(server.root, open), 'before')
  const fileRequests: (readonly string[])[] = []
  const { client, endEventStreams } = createCuttableEventsClient(server, (request) => {
    const files = filesRequest(request)
    if (files) fileRequests.push(files)
    return undefined
  })
  const messages: WatchServerMessage[] = []
  const readyFiles: (readonly string[])[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: (message) => messages.push(message),
    onFilesReady: (files) => readyFiles.push(files),
    onError: (error) => {
      throw error
    },
    onInterrupted: () => undefined,
  })
  try {
    streams.setFiles([open])
    await expect.poll(() => readyFiles).toEqual([[open]])
    streams.setFiles([open, '/work/tmp/outside.log'])
    await expect.poll(() => fileRequests).toHaveLength(2)
    await sleep(100)

    messages.length = 0
    await writeFile(path.join(server.root, open), 'changed after the rejection')
    await expect
      .poll(() => messages)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: open }))

    // Its files belong to a set the tabs replaced; the refused set is what they hold.
    endEventStreams()
    await sleep(700)
    expect(fileRequests).toHaveLength(2)
  } finally {
    streams.close()
  }
})

test('a retry scheduled for an earlier set is dropped when the set changes', async ({ server }) => {
  await mkdir(path.join(server.root, 'project'))
  const open = 'project/open.txt'
  await writeFile(path.join(server.root, open), 'before')
  const fileRequests: (readonly string[])[] = []
  const { client } = createCuttableEventsClient(server, (request) => {
    const files = filesRequest(request)
    if (!files) return undefined
    fileRequests.push(files)
    return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
  })
  const interruptions: StreamInterruption[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: () => undefined,
    onFilesReady: () => undefined,
    onError: () => undefined,
    onInterrupted: (interruption) => interruptions.push(interruption),
  })
  try {
    streams.setFiles([open])
    await expect.poll(() => interruptions.filter(({ scope }) => scope === 'files')).toHaveLength(1)
    streams.setFiles([])
    // Past the first backoff step, when the retry for the earlier set would have gone out.
    await sleep(700)
    expect(fileRequests).toEqual([[open]])
  } finally {
    streams.close()
  }
})

function filesRequest(request: Request): readonly string[] | undefined {
  const url = new URL(request.url)
  if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== 'files') return undefined
  return JSON.parse(url.searchParams.get('files') ?? '[]') as string[]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
