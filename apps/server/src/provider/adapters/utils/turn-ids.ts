import type { TurnId } from '@workspace/contracts'

export function canonicalTurnId(
  turnIds: Map<string, TurnId>,
  providerTurnId: string | undefined,
): TurnId | undefined {
  if (!providerTurnId) return undefined

  return turnIds.get(providerTurnId)
}
