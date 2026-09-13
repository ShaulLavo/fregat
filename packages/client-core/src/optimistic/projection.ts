import { pendingIntents, type Intent } from './queue'

/**
 * The confirmed value with every pending intent replayed over it, in order.
 * Returns `confirmed` itself when nothing is pending so identity-based
 * selectors and `useSyncExternalStore` do not see a change.
 */
export function projectIntents<TConfirmed, TPatch>(
  confirmed: TConfirmed,
  active: readonly Intent<TPatch>[],
  apply: (value: TConfirmed, patch: TPatch) => TConfirmed,
): TConfirmed {
  const pending = pendingIntents(active)
  if (pending.length === 0) return confirmed

  let value = confirmed
  for (const intent of pending) value = apply(value, intent.patch)
  return value
}
