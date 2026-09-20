import { expect, onTestFinished } from 'vitest'
import { createOrchestrationFixture, mockRuntime } from './orchestration'
import type { MockProviderAdapter } from '../../src/provider/adapters/mock'

export async function startPendingProviderTurn<Adapter extends MockProviderAdapter>(input: {
  adapter: Adapter
  started: Promise<void>
  release: () => void
}) {
  const fixture = await createOrchestrationFixture()
  onTestFinished(async () => {
    input.release()
    await fixture.engine.providerRuntimeIdle()
    await fixture.close()
  })
  const registration = await fixture.register()
  expect(registration.result).not.toBeNull()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.restart(mockRuntime(input.adapter))
  await fixture.startTurn()
  await input.started
  return { fixture, adapter: input.adapter, release: input.release }
}
