import { startPendingProviderTurn } from './pending-provider'
import { createInternalError } from '../../src/observability/structured-errors'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'

export async function pendingProviderLaunch() {
  const adapter = new MockProviderAdapter()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const originalStart = adapter.startRuntime.bind(adapter)
  adapter.startRuntime = async (input) => {
    started.resolve()
    await release.promise
    return originalStart(input)
  }
  return startPendingProviderTurn({
    adapter,
    started: started.promise,
    release: () => release.resolve(),
  })
}

export async function pendingProviderTurnFailure() {
  const started = Promise.withResolvers<void>()
  const fail = Promise.withResolvers<void>()
  const adapter = new MockProviderAdapter({
    beforeComplete: async () => {
      if (adapter.startedTurns.length !== 1) return
      started.resolve()
      await fail.promise
      throw createInternalError('Delayed old provider failure')
    },
  })
  const { fixture } = await startPendingProviderTurn({
    adapter,
    started: started.promise,
    release: () => fail.resolve(),
  })
  return { fixture, adapter, failOldTurn: () => fail.resolve() }
}
