import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { ORCHESTRATION_WS_PROTOCOL_VERSION, TUI_CLIENT_ORIGIN } from '@workspace/contracts'

import { createTestSettingsSession } from '../../../test/factories/session'
import { createControlledInProcessTransport } from '../../../test/client'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'

test('creates the test workspace in the configured temporary directory', ({ server }) => {
  expect(path.dirname(server.root)).toBe(tmpdir())
})

test('machine discovery uses the stopped test command', async ({ client }) => {
  const response = await client.machines['tailnet-hosts'].get()
  expect(response.status).toBe(200)
  expect(response.data).toEqual({ status: 'unavailable', hosts: [], reason: 'not-running' })
})

test('reads real health and settings with the dedicated origin and client instance', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: TUI_CLIENT_ORIGIN, 'x-client-instance': 'tui-test-instance' }),
  })
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({
      kind: 'ready',
      descriptor: { ok: true, protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION },
      settings: { values: expect.any(Object) },
      connection: { kind: 'live' },
    })
    expect(transport.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/health',
      '/settings',
    ])
    for (const request of transport.requests) {
      expect(request.headers.get('origin')).toBe(TUI_CLIENT_ORIGIN)
      expect(request.headers.get('x-client-instance')).toBe('tui-test-instance')
    }
  } finally {
    session.dispose()
  }
})

test('keeps settings readable after a dropped connection and reconnects across a server restart', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const session = createTestSettingsSession(server, { createSocket: transport.createSocket })
  try {
    await session.refresh()
    const initial = session.getSnapshot()
    assert(initial.kind === 'ready')
    transport.sockets[0].serverClose({ code: 1006, wasClean: false })
    expect(session.getSnapshot()).toMatchObject({ kind: 'ready', connection: { kind: 'offline' } })
    const offline = session.getSnapshot()
    assert(offline.kind === 'ready')
    expect(offline.settings).toBe(initial.settings)
    expect(transport.sockets).toHaveLength(1)
    await server.restart()
    await session.refresh()
    const resumed = session.getSnapshot()
    expect(resumed).toMatchObject({
      kind: 'ready',
      connection: { kind: 'live' },
      descriptor: { environmentId: initial.descriptor.environmentId },
    })
    expect(transport.sockets).toHaveLength(2)
    expect(transport.sockets[0].closed).toBe(true)
    session.dispose()
    expect(transport.sockets[1].closed).toBe(true)
  } finally {
    session.dispose()
  }
})

test('disposing releases saved-state connections without requiring a separate flush', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  try {
    await session.refresh()
    const state = session.getSnapshot()
    assert(state.kind === 'ready')
    state.storage.setItem('last-directory', 'project')
    session.dispose()
    expect(() => state.storage.getItem('last-directory')).toThrow('Database has closed')
    await session.flush()
  } finally {
    session.dispose()
  }
})

test('refuses an RPC handshake from a different database than the HTTP settings', async ({
  server,
}) => {
  const replacement = await makeTestServer()
  const transport = createControlledInProcessTransport(replacement)
  const session = createTestSettingsSession(server, { createSocket: transport.createSocket })
  try {
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({
      kind: 'failed',
      failure: { code: 'ENVIRONMENT_IDENTITY_DRIFT' },
    })
    expect(transport.sockets[0].closed).toBe(true)
  } finally {
    session.dispose()
    await replacement.cleanup()
  }
})

test('reports a real origin denial without requesting settings', async ({ server }) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: 'https://untrusted.example' }),
  })
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({
      kind: 'failed',
      failure: { code: 'FORBIDDEN_ORIGIN' },
    })
    expect(transport.requests.map((request) => new URL(request.url).pathname)).toEqual(['/health'])
  } finally {
    session.dispose()
  }
})

test('blocks a replacement database at the same origin before reading its settings', async ({
  server,
}) => {
  const replacement = await makeTestServer()
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: TUI_CLIENT_ORIGIN }),
  })
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await session.refresh()
    expect(session.getSnapshot().kind).toBe('ready')
    const beforeReplacement = transport.requests.length
    transport.connect(replacement)
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({
      kind: 'failed',
      failure: { code: 'ENVIRONMENT_IDENTITY_DRIFT' },
    })
    expect(
      transport.requests.slice(beforeReplacement).map((request) => new URL(request.url).pathname),
    ).toEqual(['/health'])
  } finally {
    session.dispose()
    await replacement.cleanup()
  }
})

test('a superseded refresh cannot publish or record its late response', async ({ server }) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: TUI_CLIENT_ORIGIN }),
  })
  const events: Record<string, unknown>[] = []
  const publications: string[] = []
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
    record: (event) => events.push(event),
  })
  session.subscribe(() => publications.push(session.getSnapshot().kind))
  const gate = transport.pauseNextResponse('/settings')
  try {
    const first = session.refresh()
    const paused = await gate.reached
    await session.refresh()
    const current = session.getSnapshot()
    expect(current.kind).toBe('ready')
    expect(paused.signal.aborted).toBe(true)
    gate.release()
    await first
    expect(session.getSnapshot()).toBe(current)
    expect(publications).toEqual(['loading', 'loading', 'ready'])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'live' })
  } finally {
    gate.release()
    session.dispose()
  }
})

test('disposing aborts in-flight work and prevents later publication or retries', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: TUI_CLIENT_ORIGIN }),
  })
  const events: Record<string, unknown>[] = []
  const publications: string[] = []
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
    record: (event) => events.push(event),
  })
  session.subscribe(() => publications.push(session.getSnapshot().kind))
  const gate = transport.pauseNextResponse('/settings')
  try {
    const refresh = session.refresh()
    const paused = await gate.reached
    session.dispose()
    expect(paused.signal.aborted).toBe(true)
    gate.release()
    await refresh
    await session.refresh()
    expect(session.getSnapshot().kind).toBe('loading')
    expect(publications).toEqual(['loading'])
    expect(events).toEqual([])
    expect(transport.requests).toHaveLength(2)
  } finally {
    gate.release()
    session.dispose()
  }
})
