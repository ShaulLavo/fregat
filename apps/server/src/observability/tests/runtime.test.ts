import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Elysia } from 'elysia'
import { applyObservability } from '../elysia'
import { captureRequestLogger, recordRequestError } from '../logging'
import { createInternalError } from '../structured-errors'
import { readFsLogs } from 'evlog/fs'
import type { WideEvent } from 'evlog'

import { closeTestApps, createTestApp } from '../../../test/server'
import { createPushSubscriber } from '../../../test/factories/push-subscriber'
import { createPushSessionFixture } from '../../../test/factories/push-sessions'
import { createInProcessOrchestrationSocket } from '../../../test/orchestration-socket'
import { flushObservability, initializeObservability, resetObservabilityForTests } from '../runtime'
import { settingsErrors } from '../../settings/structured-errors'
import { testSettingsOptions, type TestSettingsOverrides } from '../../settings/testing'
import { runGit } from '../../testing/git'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await resetObservabilityForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('observability runtime', () => {
  it('redacts credential properties on errors and nested causes in the file drain', async () => {
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const credentials = Object.fromEntries(
      [
        'authorization',
        'body',
        'content',
        'cookie',
        'password',
        'patch',
        'secret',
        'set-cookie',
        'text',
        'token',
        'x-api-key',
      ].map((key) => [key, `private-${key}`]),
    )
    let loggedError: unknown
    const app = new Elysia()
    applyObservability(app)
    app.get('/credential-error', ({ set }) => {
      const cause = Object.assign(createInternalError('nested failure'), credentials)
      const error = Object.assign(createInternalError('request failure', cause), credentials, {
        requestId: 'diagnostic-request',
      })
      const logger = captureRequestLogger()
      if (!logger) throw createInternalError('Request logger was not installed')
      const recorded = vi.spyOn(logger, 'error')
      recordRequestError(error)
      loggedError = recorded.mock.calls[0]?.[0]
      set.status = 500
      return { failed: true }
    })

    const response = await app.handle(new Request('http://local/credential-error'))
    expect(response.status).toBe(500)
    await response.text()
    const event = eventForPath(await flushedEvents(logDir), '/credential-error')
    const redacted = Object.fromEntries(Object.keys(credentials).map((key) => [key, '[redacted]']))

    expect(loggedError).toMatchObject({
      ...redacted,
      requestId: 'diagnostic-request',
      cause: redacted,
    })
    expect(event).toMatchObject({ error: { cause: redacted } })
    const serialized = JSON.stringify(event)
    for (const value of Object.values(credentials)) expect(serialized).not.toContain(value)
  })

  it('writes successful request events to the file drain and drops routine health checks', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const health = await app.handle(
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      }),
    )
    const tree = await app.handle(
      new Request('http://local/fs/tree?path=&depth=1', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(health.status).toBe(200)
    expect(tree.status).toBe(200)
    await health.text()
    await tree.text()
    const events = await flushedEvents(logDir)
    const paths = events.map((event) => event.path)
    const treeEvent = eventForPath(events, '/fs/tree')

    expect(paths).not.toContain('/health')
    expect(treeEvent).toMatchObject({
      fs: {
        operations: [
          expect.objectContaining({
            operation: 'tree',
            status: 'ok',
          }),
        ],
      },
      method: 'GET',
      source: 'be',
      status: 200,
    })
  })

  it('fans persisted request events out to PostHog when configured', async () => {
    const fetchRecorder = installFetchRecorder()

    try {
      const root = await fixtureRoot()
      const logDir = await fixtureRoot()
      initializeObservability(
        testObservabilityEnv(logDir, {
          OBSERVABILITY_POSTHOG_API_KEY: 'phc_test',
          OBSERVABILITY_POSTHOG_DISTINCT_ID: 'platform-test',
          OBSERVABILITY_POSTHOG_EVENT_NAME: 'platform_test_log',
          OBSERVABILITY_POSTHOG_HOST: 'https://posthog.test',
          OBSERVABILITY_POSTHOG_MODE: 'events',
        }),
      )
      const app = testApp(root)

      const response = await app.handle(
        new Request('http://local/fs/tree?path=&depth=1', {
          headers: trustedOriginHeaders(),
        }),
      )

      expect(response.status).toBe(200)
      await response.text()
      const event = eventForPath(await flushedEvents(logDir), '/fs/tree')
      const request = onlyPostHogRequest(fetchRecorder.requests)
      const payload = JSON.parse(request.body)

      expect(event).toMatchObject({
        path: '/fs/tree',
        source: 'be',
        status: 200,
      })
      expect(request.url).toBe('https://posthog.test/batch/')
      expect(payload.api_key).toBe('phc_test')
      expect(postHogBatchEvent(payload, '/fs/tree')).toMatchObject({
        distinct_id: 'platform-test',
        event: 'platform_test_log',
        properties: expect.objectContaining({
          path: '/fs/tree',
          service: 'platform',
          source: 'be',
        }),
      })
    } finally {
      try {
        await closeTestApps()
        await resetObservabilityForTests()
      } finally {
        fetchRecorder.restore()
      }
    }
  })

  it('keeps failed requests even when info sampling is disabled', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(
      testObservabilityEnv(logDir, {
        OBSERVABILITY_INFO_SAMPLE_RATE: '0',
      }),
    )
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/fs/read?path=missing.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(404)
    await response.text()
    const event = eventForPath(await flushedEvents(logDir), '/fs/read')
    const serialized = JSON.stringify(event)

    expect(event).toMatchObject({
      error: {
        code: 'NOT_FOUND',
      },
      level: 'warn',
      status: 404,
    })
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain(path.join(root, 'missing.txt'))
  })

  it('keeps successful requests at info when a nested operation fails', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    const stalePath = path.join(root, 'stale')
    await mkdir(stalePath)
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const record = await app.handle(
      new Request('http://local/fs/recents', {
        body: JSON.stringify({ path: 'stale' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    expect(record.status).toBe(200)
    await record.text()
    await rm(stalePath, { recursive: true })

    const response = await app.handle(
      new Request('http://local/fs/recents?limit=40&mode=file&showHidden=true', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    await response.text()
    const event = eventForRequest(await flushedEvents(logDir), 'GET', '/fs/recents')

    expect(event).toMatchObject({
      fs: {
        operations: expect.arrayContaining([
          expect.objectContaining({ operation: 'stat', status: 'error' }),
          expect.objectContaining({ operation: 'recents', status: 'ok' }),
        ]),
      },
      level: 'info',
      status: 200,
    })
  })

  it('does not persist authorization headers', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    const token = 'secret-bearer-value'
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/fs/tree?path=&depth=1', {
        headers: trustedOriginHeaders({
          authorization: `Bearer ${token}`,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await response.text()
    await flushObservability()
    const text = await readLogText(logDir)
    expect(text).not.toContain(token)
    expect(text.toLowerCase()).not.toContain('authorization')
  })

  it('records one value-free settings context for parse rejection and raw conflict', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    const hiddenValue = 'SETTING_VALUE_MUST_NOT_BE_LOGGED'
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)
    const headers = trustedOriginHeaders({ 'content-type': 'application/json' })

    const invalid = await app.handle(
      new Request('http://local/settings/write', {
        body: JSON.stringify({
          mutationId: 'invalid-settings-request',
          operations: [{ key: 'editor.fontSize', kind: 'set', value: hiddenValue }],
          target: 'user',
        }),
        headers,
        method: 'POST',
      }),
    )
    const firstRaw = await app.handle(
      new Request('http://local/settings/raw', {
        body: JSON.stringify({
          baseRevision: '',
          target: 'user',
          text: '{ "editor.fontSize": 20 }\n',
          writeId: 'raw-first',
        }),
        headers,
        method: 'POST',
      }),
    )
    const staleRaw = await app.handle(
      new Request('http://local/settings/raw', {
        body: JSON.stringify({
          baseRevision: '',
          target: 'user',
          text: '{ "editor.lineHeight": 30 }\n',
          writeId: 'raw-conflict',
        }),
        headers,
        method: 'POST',
      }),
    )

    expect(invalid.status).toBe(400)
    expect(firstRaw.status).toBe(200)
    expect(staleRaw.status).toBe(409)
    await Promise.all([invalid.text(), firstRaw.text(), staleRaw.text()])
    const events = await flushedEvents(logDir)
    const invalidEvent = events.find(
      (event) => event.path === '/settings/write' && event.status === 400,
    ) as (WideEvent & Record<string, unknown>) | undefined
    const conflictEvent = events.find(
      (event) => event.path === '/settings/raw' && event.status === 409,
    ) as (WideEvent & Record<string, unknown>) | undefined

    expect(invalidEvent?.settings).toEqual({
      affectedDomainIds: [],
      coordinatorWaitMs: 0,
      error: { code: 'settings.WRITE_INVALID', status: 400 },
      mutationId: 'invalid-settings-request',
      operationKinds: ['set'],
      outcome: 'rejected',
      rebaseAttempts: 0,
      settingIds: ['editor.fontSize'],
      target: 'user',
    })
    expect(conflictEvent?.settings).toEqual({
      coordinatorWaitMs: expect.any(Number),
      error: { code: 'settings.RAW_REVISION_STALE', status: 409 },
      mutationId: 'raw-conflict',
      operationKinds: ['raw.replace'],
      outcome: 'raw-conflict',
      rebaseAttempts: 0,
      settingIds: ['editor.lineHeight'],
      target: 'user',
    })
    const serialized = JSON.stringify([invalidEvent, conflictEvent])
    expect(serialized).not.toContain(hiddenValue)
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('editor.lineHeight": 30')
  })

  it('records complete settings context when transaction recovery blocks a later write', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root, {
      transactionHooks: {
        afterBoundary(boundary) {
          if (boundary !== 'settings-directory-synced') return

          throw settingsErrors.TRANSACTION_RECOVERY_INVALID({ detail: 'injected interruption' })
        },
      },
    })
    const headers = trustedOriginHeaders({ 'content-type': 'application/json' })
    const interrupted = await app.handle(
      new Request('http://local/settings/raw', {
        body: JSON.stringify({
          baseRevision: '',
          target: 'user',
          text: JSON.stringify({
            'providers.instances': [
              {
                driverKind: 'codex',
                environment: [{ name: 'CODEX_TOKEN', value: 'test-credential' }],
                providerInstanceId: 'codex-work',
              },
            ],
          }),
          writeId: 'interrupt-settings-transaction',
        }),
        headers,
        method: 'POST',
      }),
    )
    const blocked = await app.handle(
      new Request('http://local/settings/write', {
        body: JSON.stringify({
          mutationId: 'blocked-after-interruption',
          operations: [{ key: 'editor.fontSize', kind: 'set', value: 18 }],
          target: 'user',
        }),
        headers,
        method: 'POST',
      }),
    )

    expect(interrupted.status).toBe(500)
    expect(blocked.status).toBe(503)
    await Promise.all([interrupted.text(), blocked.text()])
    const events = await flushedEvents(logDir)
    const blockedEvent = events.find(
      (event) => event.path === '/settings/write' && event.status === 503,
    ) as (WideEvent & Record<string, unknown>) | undefined

    expect(blockedEvent?.settings).toEqual({
      affectedDomainIds: [],
      coordinatorWaitMs: 0,
      error: { code: 'settings.TRANSACTION_RECOVERY_REQUIRED', status: 503 },
      mutationId: 'blocked-after-interruption',
      operationKinds: ['set'],
      outcome: 'rejected',
      rebaseAttempts: 0,
      settingIds: ['editor.fontSize'],
      target: 'user',
    })
  })

  it('persists client logs in the shared file drain with a client source marker', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/_log/ingest', {
        body: JSON.stringify({
          action: 'client.test',
          area: 'test',
          content: 'SECRET_CLIENT_CONTENT',
          level: 'info',
          path: 'src/app.ts',
          service: 'platform-web',
          timestamp: new Date().toISOString(),
        }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(204)
    await response.text()
    const events = await flushedEvents(logDir)
    const event = eventForAction(events, 'client.test')
    const serialized = JSON.stringify(events)

    expect(event).toMatchObject({
      action: 'client.test',
      area: 'test',
      client: {
        service: 'platform-web',
        timestamp: expect.any(String),
      },
      ingest: {
        method: 'POST',
        path: '/_log/ingest',
      },
      service: 'platform',
      source: 'client',
    })
    expect(events.map((candidate) => candidate.path)).not.toContain('/_log/ingest')
    expect(serialized).not.toContain('SECRET_CLIENT_CONTENT')
  })

  it('does not persist successful dashboard reads', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/_log/dashboard/events', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    await response.text()
    const events = await flushedEvents(logDir)

    expect(events.map((event) => event.path)).not.toContain('/_log/dashboard/events')
  })

  it('accepts batched client drain payloads', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/_log/ingest', {
        body: JSON.stringify([
          {
            event: {
              action: 'client.batch',
              area: 'test',
              level: 'warn',
              service: 'platform-web',
              timestamp: new Date().toISOString(),
            },
          },
        ]),
        headers: trustedOriginHeaders({
          'content-type': 'application/json',
          'x-evlog-source': 'client',
        }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(204)
    await response.text()
    const event = eventForAction(await flushedEvents(logDir), 'client.batch')

    expect(event).toMatchObject({
      action: 'client.batch',
      area: 'test',
      client: {
        service: 'platform-web',
        timestamp: expect.any(String),
      },
      level: 'warn',
      source: 'client',
    })
  })

  it('records one push context per test send without endpoints, keys or payload', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const endpoint = 'https://fcm.googleapis.com/PUSH_ENDPOINT_MARKER'
    let answer: (url: string) => Promise<Response> = async () => new Response(null, { status: 201 })
    const app = createTestApp({
      auth: { allowedOrigins: [TRUSTED_ORIGIN] },
      push: { fetcher: (url) => answer(url) },
      settings: testSettingsOptions(root),
      watch: false,
      workspaceRoot: root,
    })
    const subscriber = createPushSubscriber(endpoint)
    const { auth, p256dh } = subscriber.subscription.keys
    const post = (pathname: string, body?: unknown) =>
      app.handle(
        new Request(`http://local${pathname}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
          method: 'POST',
        }),
      )

    const registered = await post('/push/devices', {
      label: 'Chrome on Linux',
      subscription: subscriber.subscription,
    })
    const { device } = await registered.json()
    const sent = await post(`/push/devices/${device.id}/test`)
    answer = async (url) => {
      throw new TypeError(`connect failed ${url}`)
    }
    const unreachable = await post(`/push/devices/${device.id}/test`)
    // Last: a 410 removes the device.
    answer = async () => new Response('gone', { status: 410 })
    const expired = await post(`/push/devices/${device.id}/test`)
    const rejected = await post('/push/devices', {
      label: 'L'.repeat(81),
      subscription: subscriber.subscription,
    })

    expect([sent.status, expired.status, unreachable.status, rejected.status]).toEqual([
      200, 410, 502, 400,
    ])
    await Promise.all([sent.text(), expired.text(), unreachable.text(), rejected.text()])
    const events = await flushedEvents(logDir)
    const sendPath = `/push/devices/${device.id}/test`
    const pushContext = (status: number) =>
      (
        events.find((event) => event.path === sendPath && event.status === status) as
          | (WideEvent & Record<string, unknown>)
          | undefined
      )?.push
    const secrets = JSON.parse(
      await readFile(path.join(root, '.platform-test', 'secrets.json'), 'utf8'),
    )

    expect(pushContext(200)).toEqual({
      deviceCount: 1,
      failure: null,
      kind: 'test',
      outcome: 'sent',
      service: 'google',
      status: 201,
    })
    expect(pushContext(410)).toEqual({
      deviceCount: 1,
      failure: null,
      kind: 'test',
      outcome: 'expired',
      service: 'google',
      status: 410,
    })
    expect(pushContext(502)).toEqual({
      deviceCount: 1,
      failure: 'TypeError',
      kind: 'test',
      outcome: 'unreachable',
      service: 'google',
      status: null,
    })
    const serialized = JSON.stringify(events)
    for (const secret of [
      'PUSH_ENDPOINT_MARKER',
      p256dh,
      auth,
      secrets['push.vapid.privateKey'],
      'reach this device',
    ])
      expect(serialized).not.toContain(secret)
  })

  it('records one session notice event per delivery without endpoints, titles or payload', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    initializeObservability(testObservabilityEnv(logDir))
    const fixture = await createPushSessionFixture({ root, pushNotifications: true })
    const subscriber = await fixture.register()
    await fixture.createSession()
    const socket = createInProcessOrchestrationSocket(fixture.app, TRUSTED_ORIGIN)
    socket.receive({ kind: 'presence', focused: true })
    await fixture.runTurn('turn-1')
    await fixture.settle()
    socket.disconnect()
    await fixture.runTurn('turn-2')
    await expect.poll(() => fixture.pushed.length).toBe(1)
    await fixture.settle()

    const events = (await flushedEvents(logDir)).filter(
      (event) => event.action === 'push.session_notice',
    )
    expect(events).toEqual([
      expect.objectContaining({
        deviceCount: 1,
        failed: false,
        focusedWindows: 1,
        kind: 'completion',
        suppressed: true,
      }),
      expect.objectContaining({
        deliveries: [{ failure: null, outcome: 'sent', service: 'google', status: 201 }],
        deviceCount: 1,
        focusedWindows: 0,
        kind: 'completion',
        link: 'session',
        suppressed: false,
      }),
    ])
    const serialized = JSON.stringify(events)
    const { auth, p256dh } = subscriber.subscription.keys
    for (const secret of ['fcm.googleapis.com', 'Fixture session', 'chat/t/', auth, p256dh])
      expect(serialized).not.toContain(secret)
  })

  it('records git summaries and streamed search context without persisting payload contents', async () => {
    const root = await fixtureRoot()
    const logDir = await fixtureRoot()
    const secretContent = 'needle TOP_SECRET_CONTENT'
    await writeFile(path.join(root, 'secret.txt'), secretContent)
    await initGitRepository(root)
    initializeObservability(testObservabilityEnv(logDir))
    const app = testApp(root)

    const search = await app.handle(
      new Request('http://local/fs/search/events?query=needle&includeContent=true', {
        headers: trustedOriginHeaders(),
      }),
    )
    const checkout = await app.handle(
      new Request('http://local/git/checkout', {
        body: JSON.stringify({ branch: 'missing-branch', path: '' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(search.status).toBe(200)
    expect(checkout.status).toBe(500)
    await search.text()
    await checkout.text()
    const events = await flushedEvents(logDir)
    const searchEvent = eventForPath(events, '/fs/search/events')
    const gitEvent = eventForPath(events, '/git/checkout')
    const serialized = JSON.stringify(events)

    // The summary is recorded after the last chunk, so finding it on the same event
    // is what proves the wide event stayed open for the stream it describes.
    expect(searchEvent).toMatchObject({
      fs: {
        operations: [expect.objectContaining({ operation: 'search_events', status: 'ok' })],
      },
      operation: 'search_events',
      search: {
        includeContent: true,
        queryLength: 6,
      },
    })
    expect(gitEvent.git).toMatchObject({
      commandCount: expect.any(Number),
      failedCommand: expect.objectContaining({
        action: 'checkout',
        exitCode: expect.any(Number),
      }),
    })
    expect(gitEvent).toMatchObject({ level: 'error', status: 500 })
    expect(serialized).not.toContain('TOP_SECRET_CONTENT')
    expect(serialized).not.toContain('stdout')
  })
})

function testApp(root: string, settings: TestSettingsOverrides = {}) {
  return createTestApp({
    auth: {
      allowedOrigins: [TRUSTED_ORIGIN],
    },
    settings: testSettingsOptions(root, settings),
    watch: false,
    workspaceRoot: root,
  })
}

function testObservabilityEnv(logDir: string, overrides: Record<string, string> = {}) {
  return {
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
    ...overrides,
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-observability-'))
  roots.push(root)
  return root
}

function trustedOriginHeaders(headers: HeadersInit = {}) {
  return {
    ...headers,
    origin: TRUSTED_ORIGIN,
  }
}

async function flushedEvents(logDir: string) {
  await delay(0)
  await flushObservability()
  return readEvents(logDir)
}

async function readEvents(logDir: string) {
  const events: WideEvent[] = []

  for await (const event of readFsLogs({ dir: logDir })) {
    events.push(event)
  }

  return events
}

function eventForPath(events: readonly WideEvent[], path: string) {
  const event = events.find((candidate) => candidate.path === path)
  if (!event) throw new Error(`missing observability event for ${path}`)

  return event as WideEvent & Record<string, unknown>
}

function eventForRequest(events: readonly WideEvent[], method: string, path: string) {
  const event = events.find((candidate) => candidate.method === method && candidate.path === path)
  if (!event) throw new Error(`missing observability event for ${method} ${path}`)

  return event as WideEvent & Record<string, unknown>
}

function eventForAction(events: readonly WideEvent[], action: string) {
  const event = events.find((candidate) => candidate.action === action)
  if (!event) throw new Error(`missing observability event for ${action}`)

  return event as WideEvent & Record<string, unknown>
}

async function readLogText(logDir: string) {
  const files = await readdir(logDir).catch(() => [])
  const chunks = await Promise.all(
    files
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => readFile(path.join(logDir, file), 'utf8')),
  )

  return chunks.join('\n')
}

async function initGitRepository(root: string) {
  await runGit(root, ['init'])
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type FetchRecorder = {
  requests: RecordedFetchRequest[]
  restore: () => void
}

type RecordedFetchRequest = {
  body: string
  url: string
}

function installFetchRecorder(): FetchRecorder {
  const originalFetch = globalThis.fetch
  const requests: RecordedFetchRequest[] = []

  globalThis.fetch = (async (input, init) => {
    requests.push({
      body: fetchBody(init),
      url: fetchUrl(input),
    })
    return new Response('{}', { status: 200 })
  }) as typeof fetch

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

function onlyPostHogRequest(requests: readonly RecordedFetchRequest[]) {
  expect(requests).toHaveLength(1)
  return requests[0]
}

function postHogBatchEvent(payload: PostHogPayload, eventPath: string) {
  const event = payload.batch?.find((candidate) => candidate.properties?.path === eventPath)
  if (!event) throw new Error(`missing PostHog batch event for ${eventPath}`)

  return event
}

function fetchBody(init: RequestInit | undefined) {
  return typeof init?.body === 'string' ? init.body : ''
}

function fetchUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url

  return String(input)
}

type PostHogPayload = {
  batch?: Array<{
    properties?: {
      path?: string
    }
  }>
}
