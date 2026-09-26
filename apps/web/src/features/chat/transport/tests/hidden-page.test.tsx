import { act, renderHook, waitFor } from '@testing-library/react'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { onTestFinished, vi } from 'vitest'

import { useChatShellSubscription } from '@/features/chat/hooks/use-chat-shell-subscription'
import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { expect, test } from '../../../../../test/fixtures'

test('a hidden page opens no socket until it shows again', async () => {
  const shell = await renderShellHiddenAfterFailure()

  // The supervisor's next attempt waits on the page, not on a socket.
  await waitFor(() => expect(shell.attempts()).toBe(2))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(shell.sockets).toHaveLength(1)

  shell.visibility.mockReturnValue('visible')
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await waitFor(() => expect(shell.sockets).toHaveLength(2))
})

test('a hidden page that delivers session notifications keeps reconnecting', async () => {
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'chat.notificationMode': 'notifications' })
  onTestFinished(() => writeBootMirror(DEFAULT_SETTING_VALUES))
  const shell = await renderShellHiddenAfterFailure()

  await waitFor(() => expect(shell.sockets).toHaveLength(2))
  expect(document.visibilityState).toBe('hidden')
})

async function renderShellHiddenAfterFailure() {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const sockets: FakeOrchestrationSocket[] = []
  const rpc = createOrchestrationRpcClient({
    origin: 'http://hidden-page.test',
    createSocket: () => {
      const socket = new FakeOrchestrationSocket()
      sockets.push(socket)
      return socket
    },
  })
  let attempts = 0
  const transport = unsupportedChatTransport({
    shellStream: (input) => {
      attempts += 1
      return rpc.shellStream(input)
    },
  })
  const view = renderHook(() => useChatShellSubscription(transport))
  onTestFinished(() => {
    view.unmount()
    rpc.close()
    visibility.mockRestore()
  })
  await waitFor(() => expect(sockets).toHaveLength(1))
  act(() => sockets[0]!.open())

  visibility.mockReturnValue('hidden')
  act(() => sockets[0]!.transportFailure())
  return { attempts: () => attempts, sockets, visibility }
}
