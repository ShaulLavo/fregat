import { initLogger, type WideEvent } from 'evlog'
import { vi } from 'vitest'

import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { replaceEnvironmentEndpoint } from '@/lib/client'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { expect, test } from '../../../../../test/fixtures'

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

test('owner closure stays informational while a transport failure remains an error', async () => {
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
        events.filter((event) => event.action === 'orchestration.ws.subscription.summary'),
      ).toHaveLength(2)
    })
    const summaries = events.filter(
      (event) => event.action === 'orchestration.ws.subscription.summary',
    )
    expect(summaries[0]).toMatchObject({ aborted: true, explicitlyClosed: true, level: 'info' })
    expect(summaries[0]?.error).toBeUndefined()
    expect(summaries[1]).toMatchObject({ aborted: true, explicitlyClosed: false, level: 'error' })
    expect(summaries[1]?.error).toMatchObject({
      message: 'The orchestration WebSocket closed before the request completed.',
    })
  } finally {
    vi.unstubAllEnvs()
    initLogger({ enabled: false, silent: true, _suppressDrainWarning: true })
  }
})
