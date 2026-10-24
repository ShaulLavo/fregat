declare const console: { error(...values: unknown[]): void }

export class CollabFailure extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CollabFailure'
  }
}

export function rethrowObserverErrors(
  operation: 'host.broadcast' | 'participant.publish',
  errors: readonly unknown[],
): void {
  if (errors.length === 0) return
  // Callback failures can carry document text; report counts without serializing them.
  if (errors.length > 1)
    console.error('[collab]', 'collab.observers.failed', {
      level: 'error',
      operation,
      internal: { failureCount: errors.length },
    })
  throw errors[0]
}
