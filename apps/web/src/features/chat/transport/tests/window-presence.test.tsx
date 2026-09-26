import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import type { OrchestrationWsClientMessage } from '@workspace/contracts'
import { onTestFinished, vi } from 'vitest'

import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { activeServerOrigin } from '@/lib/client'
import { expect, test } from '../../../../../test/fixtures'

test('tells the server whenever this window gains or loses the owner’s eyes', async ({
  server,
  client,
}) => {
  void client
  const sent: OrchestrationWsClientMessage[] = []
  const connect = inProcessOrchestrationSocketFactory({
    app: server.app,
    clientOrigin: server.origin,
  })
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const rpc = createOrchestrationRpcClient({
    origin: activeServerOrigin(),
    createSocket: (url) => {
      const socket = connect(url)
      const send = socket.send.bind(socket)
      socket.send = (raw: string) => {
        sent.push(JSON.parse(raw))
        send(raw)
      }
      return socket
    },
  })
  onTestFinished(() => {
    rpc.close()
    hasFocus.mockRestore()
    visibility.mockRestore()
  })

  await rpc.ready()
  hasFocus.mockReturnValue(false)
  window.dispatchEvent(new Event('blur'))
  hasFocus.mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  rpc.close()
  visibility.mockReturnValue('visible')
  window.dispatchEvent(new Event('focus'))

  expect(sent.filter((message) => message.kind === 'presence')).toEqual([
    { kind: 'presence', focused: true },
    { kind: 'presence', focused: false },
    { kind: 'presence', focused: true },
    { kind: 'presence', focused: false },
  ])
})
