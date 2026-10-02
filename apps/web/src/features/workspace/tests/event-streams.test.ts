import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WatchServerMessage } from '@workspace/contracts'
import { afterEach, beforeEach, vi } from 'vitest'
import { initLogger } from 'evlog'
import { startWorkspaceEventStreams } from '@/features/workspace/state/event-streams'
import { toClientError } from '@/lib/client-error-taxonomy'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { test, expect } from '../../../../test/fixtures'
import { createCuttableEventsClient, createObservedInProcessClient } from '../../../../test/client'
import type { StreamInterruption } from '@/features/workspace/state/event-streams'

const events: Record<string, unknown>[] = []
beforeEach(() => {
  events.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  initLogger({
    enabled: true,
    silent: true,
    minLevel: 'info',
    drain: ({ event }) => {
      events.push(event)
    },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

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
    const rejected = [open, path.resolve(server.root, '..', 'outside.log')]
    streams.setFiles(rejected)
    await expect.poll(() => fileRequests).toHaveLength(1)
    // Longer than the first two backoff steps, so a retry would have gone out.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(fileRequests).toHaveLength(1)
    expect(interruptions).toEqual([])
    expect(errors).toEqual([expect.objectContaining({ status: 403 })])

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
    expect(errors).toEqual([])
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
    onError: () => undefined,
    onInterrupted: () => undefined,
  })
  try {
    streams.setFiles([open])
    await expect.poll(() => readyFiles).toEqual([[open]])
    streams.setFiles([open, path.resolve(server.root, '..', 'outside.log')])
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

test.for(['refused', 'reset', '503'] as const)(
  'a project stream starting during %s downtime recovers without reporting an error',
  async (failure, { server }) => {
    await mkdir(path.join(server.root, 'project'))
    let requests = 0
    const { client } = createCuttableEventsClient(server, (request) => {
      if (new URL(request.url).pathname !== '/fs/events') return undefined
      requests++
      if (requests > 1) return undefined
      if (failure !== '503') throw new TypeError(`Connection ${failure}`)
      return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
    })
    const messages: WatchServerMessage[] = []
    const errors: unknown[] = []
    const streams = startWorkspaceEventStreams({
      client,
      rootPath: 'project',
      onMessage: (message) => messages.push(message),
      onFilesReady: () => undefined,
      onError: (error) => errors.push(error),
      onInterrupted: () => undefined,
    })
    try {
      await expect
        .poll(() => messages.filter((message) => message.type === 'ready'))
        .toHaveLength(1)
      expect(requests).toBe(2)
      expect(errors).toEqual([])
      expect(events.filter((event) => event.action === 'workspace.events.reconnecting')).toEqual([
        expect.objectContaining({ level: 'warn', scope: 'project' }),
      ])
      expect(events.filter((event) => event.action === 'workspace.events.recovered')).toEqual([
        expect.objectContaining({ level: 'info', scope: 'project', failedAttemptCount: 1 }),
      ])
    } finally {
      streams.close()
    }
  },
)

test.for(['project', 'files'] as const)(
  'an unavailable %s stream reports one error after bounded reconnect attempts',
  { timeout: 15_000 },
  async (scope, { server }) => {
    await mkdir(path.join(server.root, 'project'))
    const open = 'project/open.txt'
    await writeFile(path.join(server.root, open), 'before')
    let requests = 0
    const { client } = createCuttableEventsClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== scope) return undefined
      requests++
      return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
    })
    const errors: unknown[] = []
    const interruptions: StreamInterruption[] = []
    const streams = startWorkspaceEventStreams({
      client,
      rootPath: 'project',
      onMessage: () => undefined,
      onFilesReady: () => undefined,
      onError: (error) => errors.push(error),
      onInterrupted: (interruption) => interruptions.push(interruption),
    })
    try {
      if (scope === 'files') streams.setFiles([open])
      await expect.poll(() => interruptions).toHaveLength(1)
      expect(errors).toEqual([])
      await expect.poll(() => errors, { timeout: 12_000 }).toHaveLength(1)
      expect(requests).toBe(5)
      expect(errors).toEqual([expect.objectContaining({ status: 503 })])
      expect(events.filter((event) => event.action === 'workspace.events.reconnecting')).toEqual([
        expect.objectContaining({ level: 'warn', scope }),
      ])
      expect(events.filter((event) => event.action === 'workspace.events.recovered')).toEqual([])
      if (scope === 'files') streams.setFiles([open])
      await sleep(700)
      expect(requests).toBe(5)
    } finally {
      streams.close()
    }
  },
)

test('closing a project stream during startup downtime cancels its retries and error report', async ({
  server,
}) => {
  await mkdir(path.join(server.root, 'project'))
  let requests = 0
  const { client } = createCuttableEventsClient(server, (request) => {
    if (new URL(request.url).pathname !== '/fs/events') return undefined
    requests++
    return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
  })
  const errors: unknown[] = []
  const interruptions: StreamInterruption[] = []
  const streams = startWorkspaceEventStreams({
    client,
    rootPath: 'project',
    onMessage: () => undefined,
    onFilesReady: () => undefined,
    onError: (error) => errors.push(error),
    onInterrupted: (interruption) => interruptions.push(interruption),
  })
  try {
    await expect.poll(() => interruptions).toHaveLength(1)
    streams.close()
    await sleep(700)
    expect(requests).toBe(1)
    expect(errors).toEqual([])
  } finally {
    streams.close()
  }
})

test.for(['project', 'files'] as const)(
  'an exhausted %s stream resumes unchanged subscriptions and closes without leaking',
  { timeout: 15_000 },
  async (scope, { server }) => {
    await mkdir(path.join(server.root, 'project', 'dist'), { recursive: true })
    const open = 'project/dist/open.txt'
    await writeFile(path.join(server.root, open), 'before')
    let unavailable = true
    let requests = 0
    const { client } = createCuttableEventsClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== scope) return undefined
      requests++
      if (!unavailable) return undefined
      return Response.json({ status: 503, message: 'Watcher unavailable' }, { status: 503 })
    })
    const errors: unknown[] = []
    const messages: WatchServerMessage[] = []
    const readyFiles: (readonly string[])[] = []
    const streams = startWorkspaceEventStreams({
      client,
      rootPath: 'project',
      onMessage: (message) => messages.push(message),
      onFilesReady: (files) => readyFiles.push(files),
      onError: (error) => errors.push(error),
      onInterrupted: () => undefined,
    })
    try {
      streams.setFiles([open])
      await expect.poll(() => errors, { timeout: 12_000 }).toHaveLength(1)
      expect(requests).toBe(5)
      unavailable = false
      streams.resume()
      streams.resume()
      await expect.poll(() => readyFiles).toEqual([[open]])
      await expect
        .poll(() => messages.filter((message) => message.type === 'ready'))
        .toHaveLength(1)
      expect(requests).toBe(6)
      await writeFile(path.join(server.root, open), 'after recovery')
      await writeFile(path.join(server.root, 'project', 'new.txt'), 'project is watched again')
      await expect
        .poll(() => messages.flatMap((message) => ('path' in message ? [message.path] : [])))
        .toEqual(expect.arrayContaining([open, 'project/new.txt']))
      streams.close()
      const messageCount = messages.length
      streams.resume()
      await writeFile(path.join(server.root, open), 'after close')
      await sleep(700)
      expect(requests).toBe(6)
      expect(messages).toHaveLength(messageCount)
      expect(errors).toHaveLength(1)
    } finally {
      streams.close()
    }
  },
)

test.for(
  [400, 401, 403, 404, 408, 429].flatMap((status) =>
    (['project', 'files'] as const).map((scope) => ({ status, scope })),
  ),
)(
  'a semantic HTTP $status $scope refusal reports immediately and stops retrying',
  async ({ status, scope }, { server }) => {
    await mkdir(path.join(server.root, 'project'))
    let requests = 0
    const { client } = createCuttableEventsClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== scope) return undefined
      requests++
      return Response.json({ status, message: 'Watcher refused' }, { status })
    })
    const errors: unknown[] = []
    const streams = startWorkspaceEventStreams({
      client,
      rootPath: 'project',
      onMessage: () => undefined,
      onFilesReady: () => undefined,
      onError: (error) => errors.push(error),
      onInterrupted: () => undefined,
    })
    try {
      if (scope === 'files') streams.setFiles(['project/open.txt'])
      await expect.poll(() => errors, { timeout: 500 }).toHaveLength(1)
      expect(errors).toEqual([expect.objectContaining({ status })])
      streams.resume()
      await sleep(700)
      expect(requests).toBe(1)
    } finally {
      streams.close()
    }
  },
)

test.for(['503', 'network'] as const)(
  'simultaneous %s outages give up with one toastable watch error',
  { timeout: 15_000 },
  async (failure, { server }) => {
    await mkdir(path.join(server.root, 'project'))
    const requests = { project: 0, files: 0 }
    const { client } = createCuttableEventsClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/events') return undefined
      const scope = url.searchParams.get('scope') as 'project' | 'files'
      requests[scope]++
      if (failure === 'network') throw new TypeError('Failed to fetch')
      return Response.json({ status: 503 }, { status: 503 })
    })
    const errors: unknown[] = []
    const streams = startWorkspaceEventStreams({
      client,
      rootPath: 'project',
      onMessage: () => undefined,
      onFilesReady: () => undefined,
      onError: (error) => errors.push(error),
      onInterrupted: () => undefined,
    })
    try {
      streams.setFiles(['project/open.txt'])
      await expect.poll(() => requests, { timeout: 12_000 }).toEqual({ project: 5, files: 5 })
      await expect
        .poll(() => events.filter((event) => event.action === 'workspace.events.gave_up'))
        .toHaveLength(2)
      expect(errors).toHaveLength(1)
      expect(toClientError(errors[0])).toMatchObject({
        code: 'client.WATCH_FAILED',
        category: 'io_error',
      })
      expect(events.filter((event) => event.action === 'workspace.events.gave_up')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: 'info', scope: 'project', failedAttemptCount: 5 }),
          expect.objectContaining({ level: 'info', scope: 'files', failedAttemptCount: 5 }),
        ]),
      )
      await sleep(700)
      expect(requests).toEqual({ project: 5, files: 5 })
      expect(errors).toHaveLength(1)
    } finally {
      streams.close()
    }
  },
)

function filesRequest(request: Request): readonly string[] | undefined {
  const url = new URL(request.url)
  if (url.pathname !== '/fs/events' || url.searchParams.get('scope') !== 'files') return undefined
  return JSON.parse(url.searchParams.get('files') ?? '[]') as string[]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
