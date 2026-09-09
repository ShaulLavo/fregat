import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'

import { createSettingsSession } from '@/connection/state/session'
import { createRpcObservation } from '@/host/observation'
import { createInProcessClient } from '../client'
import type { TestServer } from '../server'

export function createTestSettingsSession(
  server: TestServer,
  options: Partial<Parameters<typeof createSettingsSession>[0]> = {},
) {
  const ServiceSocket = inProcessServerSocketConstructor(server)
  return createSettingsSession({
    origin: server.origin,
    storageDirectory: `${server.root}/tui`,
    client: createInProcessClient(server),
    createSocket: inProcessOrchestrationSocketFactory(server),
    createServiceSocket: (url) => new ServiceSocket(url),
    observation: createRpcObservation('tui-session-test'),
    ...options,
  })
}
