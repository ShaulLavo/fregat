import type { Machines } from '@workspace/contracts'
import { createEnvironmentConnections } from '@/state/environment-connections'

export function createTestEnvironmentConnections(machines: Machines = {}) {
  const connections = createEnvironmentConnections({ activateEnvironment: () => {} })
  connections.configureMachines(machines)
  return connections
}
