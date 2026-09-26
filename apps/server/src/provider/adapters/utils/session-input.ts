import type { ProviderRuntimeStartInput, ProviderTurnInput } from '../../types'

export function sessionInputFromTurn(input: ProviderTurnInput): ProviderRuntimeStartInput {
  return {
    cwd: input.cwd,
    ephemeral: input.ephemeral,
    resumeExisting: input.resumeExisting,
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
    ...(input.platformMcp ? { platformMcp: input.platformMcp } : {}),
    providerInstanceId: input.providerInstanceId,
    providerResumeCursor: input.providerResumeCursor ?? null,
    runtimeMode: input.runtimeMode,
    sessionId: input.sessionId,
    runtimeEpoch: input.runtimeEpoch,
  }
}
