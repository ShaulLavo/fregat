import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LogReaderService, normalizeLogEvent } from '../log-reader'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('log reader', () => {
  it('normalizes wide events and generates stable ids', () => {
    const first = normalizeLogEvent({
      action: 'fs.read',
      area: 'fs',
      duration: '1.25s',
      environment: 'test',
      level: 'warn',
      path: '/fs/read',
      requestId: 'request-1',
      service: 'platform',
      source: 'be',
      timestamp: '2026-05-25T10:00:00.000Z',
    })
    const second = normalizeLogEvent({
      requestId: 'request-1',
      timestamp: '2026-05-25T10:00:00.000Z',
      source: 'be',
      path: '/fs/read',
      level: 'warn',
      duration: '1.25s',
      environment: 'test',
      area: 'fs',
      action: 'fs.read',
      service: 'platform',
    })

    expect(first.summary).toMatchObject({
      action: 'fs.read',
      area: 'fs',
      durationMs: 1_250,
      level: 'warn',
      requestId: 'request-1',
      source: 'be',
    })
    expect(first.summary.id).toBe(second.summary.id)
  })

  it('summarizes and pages retained log events with filters', async () => {
    const dir = await fixtureLogDir()
    await writeLogEvents(dir, [
      {
        action: 'fs.read',
        area: 'fs',
        durationMs: 12,
        level: 'info',
        source: 'be',
        timestamp: '2026-05-25T10:00:00.000Z',
      },
      {
        action: 'client.error',
        area: 'client-error-taxonomy',
        error: { code: 'RENDER_FAILED', message: 'Render failed', name: 'Error' },
        level: 'error',
        source: 'fe',
        timestamp: '2026-05-25T10:01:00.000Z',
      },
      {
        action: 'git.status',
        area: 'git',
        duration: '750ms',
        level: 'warn',
        source: 'be',
        timestamp: '2026-05-25T10:02:00.000Z',
      },
    ])
    const logs = new LogReaderService({ dir })

    const summary = await logs.summary({
      search: 'git',
      since: '2026-05-25T09:59:00.000Z',
      slowMs: 500,
    })
    const page = await logs.events({ levels: ['warn'], limit: 1 })

    expect(summary).toMatchObject({
      errorCount: 0,
      slowCount: 1,
      total: 1,
      warnCount: 1,
    })
    expect(summary.areas).toContainEqual({ count: 1, value: 'git' })
    expect(page.events).toHaveLength(1)
    expect(page.events[0]).toMatchObject({ action: 'git.status', level: 'warn' })
    expect(page.detailsById[page.events[0].id]?.rawJson).toMatchObject({ area: 'git' })
    expect(page.nextCursor).toBe(null)
  })

  it('returns raw JSON details by stable id', async () => {
    const dir = await fixtureLogDir()
    await writeLogEvents(dir, [
      {
        action: 'orchestration.session_stream.error',
        area: 'orchestration',
        level: 'warn',
        sessionId: '00000000-0000-4000-8000-000000000001',
        timestamp: '2026-05-25T10:03:00.000Z',
      },
    ])
    const logs = new LogReaderService({ dir })
    const page = await logs.events()
    const detail = await logs.event(page.events[0].id)

    expect(detail?.event.sessionId).toBe('00000000-0000-4000-8000-000000000001')
    expect(detail?.rawJson).toMatchObject({
      action: 'orchestration.session_stream.error',
      sessionId: '00000000-0000-4000-8000-000000000001',
    })
  })

  it('serves raw details from recently read history without another filesystem hit', async () => {
    const dir = await fixtureLogDir()
    await writeLogEvents(dir, [
      {
        action: 'cached.detail',
        area: 'logs',
        level: 'info',
        source: 'be',
        timestamp: '2026-05-25T10:03:00.000Z',
      },
    ])
    const logs = new LogReaderService({ dir })
    const page = await logs.events()

    await rm(logFilePath(dir))

    const detail = await logs.event(page.events[0].id)

    expect(detail?.rawJson).toMatchObject({
      action: 'cached.detail',
      area: 'logs',
    })
  })

  it('skips malformed retained JSONL lines', async () => {
    const dir = await fixtureLogDir()
    await writeFile(
      logFilePath(dir),
      [
        JSON.stringify({
          action: 'valid.first',
          level: 'info',
          timestamp: '2026-05-25T10:04:00.000Z',
        }),
        'not json',
        JSON.stringify({
          action: 'valid.second',
          level: 'warn',
          timestamp: '2026-05-25T10:05:00.000Z',
        }),
      ].join('\n'),
    )
    const logs = new LogReaderService({ dir })

    const result = await logs.events()

    expect(result.total).toBe(2)
    expect(result.events.map((event) => event.action)).toEqual(['valid.second', 'valid.first'])
  })

  it('tails future filesystem drain events', async () => {
    const dir = await fixtureLogDir()
    const logs = new LogReaderService({ dir })
    const abort = new AbortController()
    const iterator = logs.live({ pollIntervalMs: 50, signal: abort.signal })[Symbol.asyncIterator]()
    try {
      await waitForLogTail(dir, iterator)
      const nextEvent = nextLogEvent(iterator, 'app.bootstrap')
      await appendLogEvent(dir, {
        action: 'app.bootstrap',
        area: 'app',
        level: 'info',
        source: 'fe',
        timestamp: new Date().toISOString(),
      })

      expect(await withTimeout(nextEvent, 15_000)).toMatchObject({
        event: { action: 'app.bootstrap', area: 'app' },
        detail: { rawJson: { action: 'app.bootstrap', area: 'app' } },
        kind: 'event',
      })
    } finally {
      abort.abort()
      await iterator.return(undefined)
    }
  })
})

async function waitForLogTail(dir: string, iterator: ReturnType<LogReaderService['live']>) {
  const stop = new AbortController()
  // evlog exposes no ready signal; receiving a marker proves its startup snapshot is complete.
  const writes = writeTailReadiness(dir, stop.signal)
  try {
    await withTimeout(Promise.race([nextLogEvent(iterator, 'tail.ready'), writes]), 15_000)
  } finally {
    stop.abort()
    await writes
  }
}

async function writeTailReadiness(dir: string, signal: AbortSignal) {
  while (!signal.aborted) {
    await appendLogEvent(dir, {
      action: 'tail.ready',
      level: 'debug',
      timestamp: new Date().toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function nextLogEvent(iterator: ReturnType<LogReaderService['live']>, action: string) {
  while (true) {
    const result = await iterator.next()
    if (result.done) throw new TypeError('expected live event')
    if (result.value.event.action === action) return result.value
  }
}

async function fixtureLogDir() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-log-reader-'))
  const dir = path.join(root, 'logs')
  roots.push(root)
  await mkdir(dir, { recursive: true })

  return dir
}

async function writeLogEvents(dir: string, events: readonly Record<string, unknown>[]) {
  await writeFile(logFilePath(dir), events.map((event) => JSON.stringify(event)).join('\n'))
}

async function appendLogEvent(dir: string, event: Record<string, unknown>) {
  await appendFile(logFilePath(dir), `${JSON.stringify(event)}\n`)
}

function logFilePath(dir: string) {
  return path.join(dir, '2026-05-25.jsonl')
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timed out waiting for log event')), ms)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
