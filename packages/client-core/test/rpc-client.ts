import { onTestFinished } from 'vitest'
import { createEnvironmentsStore } from '../src/environments/state/store'
import {
  OrchestrationRpcClient,
  type OrchestrationRpcClientOptions,
} from '../src/transport/orchestration-rpc-client'
import type { RpcEvent, RpcEventScope, RpcObservation } from '../src/transport/rpc-host'
import { FakeOrchestrationSocket } from './orchestration-socket'

export function rpcClientFixture(options: Partial<OrchestrationRpcClientOptions> = {}) {
  const origin = options.origin ?? 'http://core-rpc.test'
  const socket = new FakeOrchestrationSocket()
  const environments = createEnvironmentsStore({ primaryOrigin: origin })
  const events: Array<Record<string, unknown>> = []
  const observation: RpcObservation = {
    createScope: (event) => recordScope(event, events),
    async observeOperation(event, operation, summarize) {
      const result = await operation()
      events.push({ ...event, ...summarize?.(result) })
      return result
    },
  }
  const client = new OrchestrationRpcClient({
    origin,
    environments,
    observation,
    createSocket: () => socket,
    ...options,
  })
  onTestFinished(() => client.close())
  return { client, socket, environments, origin, events }
}

/** Records each ended scope with the level the web logger would give it. */
function recordScope(base: RpcEvent, events: Array<Record<string, unknown>>): RpcEventScope {
  const event: Record<string, unknown> = { ...base }
  let level = 'info'
  return {
    set: (context) => Object.assign(event, context),
    increment(path, by = 1) {
      const previous = event[path]
      event[path] = (typeof previous === 'number' ? previous : 0) + by
    },
    warn(message, context) {
      if (level === 'info') level = 'warn'
      Object.assign(event, { warning: message }, context)
    },
    error(error, context) {
      level = 'error'
      Object.assign(event, { error }, context)
    },
    end: (overrides) => events.push({ ...event, ...overrides, level }),
  }
}
