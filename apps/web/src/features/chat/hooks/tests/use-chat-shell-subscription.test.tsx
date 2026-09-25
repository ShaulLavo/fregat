import type {
  ClientOrchestrationCommand,
  OrchestrationReplayEventsInput,
  OrchestrationReplayEventsResult,
  OrchestrationShellStreamItem,
  OrchestrationSessionStreamItem,
} from '@workspace/contracts'
import { act, renderHook, waitFor } from '@testing-library/react'

import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { useChatShellSubscription } from '@/features/chat/hooks/use-chat-shell-subscription'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createClientError } from '@workspace/client-core/errors'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { expect, test } from '../../../../../test/fixtures'

test('a dropped shell stream reconnects instead of dying', async () => {
  useChatProjectionStore.getState().resetChatProjection()
  const transport = createShellTransport([{ fail: dropped() }])

  const { result } = renderHook(() => useChatShellSubscription(transport))

  await waitFor(() => expect(result.current.phase).toBe('reconnecting'))
  expect(result.current.attempt).toBe(1)
  expect(result.current.error).toBe('Shell stream dropped.')

  // Returning to the app probes immediately rather than serving the rest of the
  // rung: the deadline here is below the 250ms first rung on purpose.
  act(() => window.dispatchEvent(new Event('focus')))

  await waitFor(() => expect(transport.attempts()).toBe(2), { interval: 5, timeout: 120 })
})

test('a rejected shell socket parks instead of retrying forever', async () => {
  useChatProjectionStore.getState().resetChatProjection()
  const transport = createShellTransport([{ fail: rejected() }])

  const { result } = renderHook(() => useChatShellSubscription(transport))

  await waitFor(() => expect(result.current.phase).toBe('blocked'))
  await new Promise((resolve) => setTimeout(resolve, 400))

  expect(transport.attempts()).toBe(1)
  expect(result.current.error).toBe('Shell socket rejected.')
})

test('an offline browser parks until the network comes back', async () => {
  useChatProjectionStore.getState().resetChatProjection()
  const transport = createShellTransport()
  setOnline(false)

  const { result } = renderHook(() => useChatShellSubscription(transport))

  await waitFor(() => expect(result.current.phase).toBe('offline'))
  expect(transport.attempts()).toBe(0)

  setOnline(true)
  act(() => window.dispatchEvent(new Event('online')))

  await waitFor(() => expect(transport.attempts()).toBe(1))
})

type ScriptedAttempt = {
  fail?: unknown
}

function createShellTransport(script: ScriptedAttempt[] = []) {
  let attempts = 0

  const transport = {
    ...unsupportedChatTransport({
      dispatchCommand: async (_command: ClientOrchestrationCommand) => ({
        result: null,
        deduped: false,
        sequence: 0,
      }),
      replayEvents: async (
        _input: OrchestrationReplayEventsInput,
      ): Promise<OrchestrationReplayEventsResult> => ({ events: [] }),
      shellStream: async function* (): AsyncGenerator<OrchestrationShellStreamItem> {
        const attempt = script[attempts] ?? {}
        attempts += 1
        if (attempt.fail) throw attempt.fail

        yield await new Promise<OrchestrationShellStreamItem>(() => undefined)
      },
      sessionDetailStream: async function* (): AsyncGenerator<OrchestrationSessionStreamItem> {
        yield await new Promise<OrchestrationSessionStreamItem>(() => undefined)
      },
    }),
    attempts: () => attempts,
  }

  return transport
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

function dropped() {
  return createClientError({
    code: 'ORCHESTRATION_WS_CLOSED',
    message: 'Shell stream dropped.',
    status: 502,
    why: 'The test shell stream dropped mid-flight.',
    fix: 'Reconnect.',
  })
}

function rejected() {
  return createClientError({
    code: 'ORCHESTRATION_WS_UNAUTHORIZED',
    message: 'Shell socket rejected.',
    status: 401,
    why: 'The test server refused the socket.',
    fix: 'Sign in again.',
  })
}

test.each([
  { code: 1000, phase: 'reconnecting' },
  { code: 1008, phase: 'blocked' },
])('a silent socket close $code enters $phase', async ({ code, phase }) => {
  const socket = new FakeOrchestrationSocket()
  const rpc = createOrchestrationRpcClient({
    origin: 'http://shell-close.test',
    createSocket: () => socket,
  })
  const transport = unsupportedChatTransport({ shellStream: rpc.shellStream.bind(rpc) })
  const view = renderHook(() => useChatShellSubscription(transport))
  act(() => {
    socket.open(false)
    socket.serverClose({ code, wasClean: true })
  })
  await waitFor(() => expect(view.result.current.phase).toBe(phase))
  view.unmount()
  rpc.close()
})
