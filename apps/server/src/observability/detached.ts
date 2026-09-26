import { operatorErrorSummary } from './logging'
import { recordProcessWarning } from './runtime'

type DetachedContext = {
  readonly area: string
  readonly operation: string
  readonly [key: string]: unknown
}

/**
 * The rejection boundary `void` does not give you.
 *
 * Bun kills the process on an unhandled rejection, and every detached caller
 * here is driven by something external — a file watcher firing, a settings file
 * changing on disk — so one unexpected throw off the filesystem took the whole
 * server down with nothing in `logs/*.jsonl` to explain it. Catching turns that
 * into one wide warn event and a server that is still running.
 *
 * Takes a thunk rather than a promise so a synchronous throw on the way to the
 * promise lands on the same boundary.
 */
export function runDetached(operation: () => Promise<unknown>, context: DetachedContext) {
  try {
    void operation().catch((error: unknown) => recordDetachedFailure(error, context))
  } catch (error) {
    recordDetachedFailure(error, context)
  }
}

function recordDetachedFailure(error: unknown, context: DetachedContext) {
  recordProcessWarning('detached.failed', { ...context, error: operatorErrorSummary(error) })
}
