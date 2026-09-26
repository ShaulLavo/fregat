import { vi } from 'vitest'

import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { clientInstanceId } from '@/lib/instance-id'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { expect, test } from '../../../../../test/fixtures'

test('the browser socket carries the tab instance id', async () => {
  const addresses: string[] = []
  // Stands in for the browser socket, so nothing connects.
  class RecordingSocket extends FakeOrchestrationSocket {
    constructor(address: URL | string) {
      super()
      addresses.push(address.toString())
    }
  }
  vi.stubGlobal('WebSocket', RecordingSocket)
  const client = createOrchestrationRpcClient({ origin: 'https://host.test/platform' })
  try {
    const next = client.shellStream()[Symbol.asyncIterator]().next()
    void next.catch(() => null)
    await vi.waitFor(() => expect(addresses).toHaveLength(1))

    const url = new URL(addresses[0]!)
    expect(url.pathname).toBe('/platform/orchestration/rpc')
    expect(url.searchParams.get('instance')).toBe(clientInstanceId())
  } finally {
    client.close()
    vi.unstubAllGlobals()
  }
})
