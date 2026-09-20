export function isProviderTurnFailureActivity(kind: string) {
  return kind === 'provider.turn.start.failed' || kind === 'provider.turn.failed'
}
