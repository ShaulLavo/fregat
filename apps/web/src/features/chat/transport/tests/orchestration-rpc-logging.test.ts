import { initLogger, type WideEvent } from 'evlog'
import { vi } from 'vitest'

import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { createRpcEventScope } from '@/features/chat/transport/rpc-event-scope'
import { replaceEnvironmentEndpoint } from '@/lib/client'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { expect, test } from '../../../../../test/fixtures'

test('connection diagnostics capture browser state when the connection ends', async () => {
  const events: WideEvent[] = []
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true })
  vi.stubGlobal('navigator', { onLine: true })
  initLogger({
    enabled: true,
    silent: true,
    drain: ({ event }) => {
      events.push(event)
    },
  })

  try {
    const scope = createRpcEventScope({
      action: 'orchestration.ws.connection.summary',
      area: 'orchestration',
    })
    vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => false })
    vi.stubGlobal('navigator', { onLine: false })
    scope.end({ transportError: true })

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toMatchObject({
      transportError: true,
      browserAtStart: { visibility: 'visible', focused: true, online: true },
      browserAtEnd: { visibility: 'hidden', focused: false, online: false },
    })
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    initLogger({ enabled: false, silent: true, _suppressDrainWarning: true })
  }
})

test('the connection summary names the proxied endpoint a remote machine opens', async () => {
  const events: WideEvent[] = []
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  initLogger({
    enabled: true,
    silent: true,
    drain: ({ event }) => {
      events.push(event)
    },
  })

  try {
    const origin = 'http://remote.rpc-logging.test'
    replaceEnvironmentEndpoint(origin, 'https://host.test/platform/machines/mac/proxy')
    const opened: string[] = []
    const socket = new FakeOrchestrationSocket()
    const client = createOrchestrationRpcClient({
      origin,
      createSocket: (url) => {
        opened.push(url)
        return socket
      },
    })
    const controller = new AbortController()
    const next = client.shellStream({ signal: controller.signal })[Symbol.asyncIterator]().next()
    const settled = next.catch(() => null)
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    socket.serverClose({ code: 1006, wasClean: false })
    controller.abort()
    await settled
    client.close()

    const url = 'wss://host.test/platform/machines/mac/proxy/orchestration/rpc'
    expect(opened).toEqual([url])
    await vi.waitFor(() => {
      const summary = events.find((event) => event.action === 'orchestration.ws.connection.summary')
      expect(summary).toMatchObject({ origin, url })
    })
  } finally {
    vi.unstubAllEnvs()
    initLogger({ enabled: false, silent: true, _suppressDrainWarning: true })
  }
})

test('owner closure and a dropped socket keep subscription summaries at info', async () => {
  const events: WideEvent[] = []
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  initLogger({
    enabled: true,
    silent: true,
    drain: ({ event }) => {
      events.push(event)
    },
  })

  try {
    for (const explicitlyClosed of [true, false]) {
      const socket = new FakeOrchestrationSocket()
      const client = createOrchestrationRpcClient({
        origin: 'http://rpc-logging.test',
        createSocket: () => socket,
      })
      const controller = new AbortController()
      const next = client.shellStream({ signal: controller.signal })[Symbol.asyncIterator]().next()
      const settled = next.catch(() => null)
      await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CONNECTING))
      if (explicitlyClosed) client.close()
      if (!explicitlyClosed) socket.serverClose({ code: 1006, wasClean: false })
      controller.abort()
      await settled
      client.close()
    }

    await vi.waitFor(() => {
      expect(
        events.filter(
          (event) => event.action === 'orchestration.ws.subscription.summary' && !event.checkpoint,
        ),
      ).toHaveLength(2)
    })
    const summaries = events.filter(
      (event) => event.action === 'orchestration.ws.subscription.summary' && !event.checkpoint,
    )
    expect(summaries[0]).toMatchObject({ aborted: true, explicitlyClosed: true, level: 'info' })
    expect(summaries[0]?.error).toBeUndefined()
    // The dropped socket warns once, on its connection summary.
    expect(summaries[1]).toMatchObject({
      aborted: true,
      explicitlyClosed: false,
      failure: { code: 'ORCHESTRATION_WS_CLOSED', status: 502 },
      level: 'info',
    })
    expect(summaries[1]?.error).toBeUndefined()
    const connections = events.filter(
      (event) => event.action === 'orchestration.ws.connection.summary' && !event.checkpoint,
    )
    expect(connections.map((event) => event.level)).toEqual(['info', 'warn'])
  } finally {
    vi.unstubAllEnvs()
    initLogger({ enabled: false, silent: true, _suppressDrainWarning: true })
  }
})
