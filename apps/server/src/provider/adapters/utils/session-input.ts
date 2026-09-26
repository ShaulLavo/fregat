import type { SessionId } from '@workspace/contracts'

import type { ProviderRuntimeStartInput, ProviderTurnInput } from '../../types'

export function sessionInputFromTurn(input: ProviderTurnInput): ProviderRuntimeStartInput {
  return {
    cwd: input.cwd,
    ephemeral: input.ephemeral,
    resumeExisting: input.resumeExisting,
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
    ...(input.mcpOff?.length ? { mcpOff: input.mcpOff } : {}),
    ...(input.platformMcp ? { platformMcp: input.platformMcp } : {}),
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    providerInstanceId: input.providerInstanceId,
    providerResumeCursor: input.providerResumeCursor ?? null,
    runtimeMode: input.runtimeMode,
    sessionId: input.sessionId,
    runtimeEpoch: input.runtimeEpoch,
  }
}

/**
 * Records a session's new off list and reopens it on its conversation when idle. A busy session
 * picks the list up at its next turn, because the list is part of the adapter's reuse check.
 */
export async function reopenWithMcpOff<Session extends { isBusy(): boolean }>(input: {
  off: readonly string[]
  reopen: (start: ProviderRuntimeStartInput, session: Session) => Promise<unknown>
  session: Session | null | undefined
  sessionId: SessionId
  startInputs: Map<SessionId, ProviderRuntimeStartInput>
}) {
  const start = input.startInputs.get(input.sessionId)
  if (!start) return

  const next = { ...start, mcpOff: input.off }
  input.startInputs.set(input.sessionId, next)
  if (!input.session || input.session.isBusy()) return
  await input.reopen(next, input.session)
}
