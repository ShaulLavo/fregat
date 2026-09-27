import type { Machines } from '@workspace/contracts'
import { createEnvironmentConnections } from '@/state/environment-connections'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'

export function createTestEnvironmentConnections(
  machines: Machines = {},
  createTransport?: (origin: string) => ChatTransport,
) {
  const connections = createEnvironmentConnections(
    createTransport ? { createTransport } : undefined,
  )
  connections.configureMachines(machines)
  return connections
}
