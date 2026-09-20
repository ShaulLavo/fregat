import { nowMs, roundMs } from '@workspace/utils/timing'
import type { Intent, IntentQueue, SubmitIntentOptions } from './queue'
import { acknowledgementTimeoutError } from './structured-errors'

/**
 * Where the acknowledgement comes from when the response alone does not prove
 * the change landed: a stream, a projection store, a query cache. `satisfied`
 * is polled once synchronously and again on every notification.
 */
export type AcknowledgementSource = {
  readonly subscribe: (listener: () => void) => () => void
  readonly satisfied: () => boolean
  readonly timeoutMs?: number
}

export type IntentRetryPolicy = {
  readonly shouldRetry: (failureCount: number, error: unknown) => boolean
  readonly delayMs: (attempt: number) => number
}

export type RunIntentOptions<TPatch, TResult> = SubmitIntentOptions & {
  readonly perform: (intent: Intent<TPatch>, signal: AbortSignal) => Promise<TResult>
  readonly until?: AcknowledgementSource
  readonly retry?: IntentRetryPolicy
  readonly signal?: AbortSignal
  /** One wide event per run. Runtime-neutral: the host decides where it goes. */
  readonly record?: (event: IntentRunEvent) => void
}

export type IntentRunEvent = {
  readonly intentId: string
  readonly resources: readonly string[]
  readonly outcome: 'acknowledged' | 'aborted' | 'failed' | 'timed-out'
  readonly transportMs: number
  readonly acknowledgementMs: number
  readonly attempts: number
  readonly error?: unknown
}

export type IntentOutcome<TResult> =
  | { readonly ok: true; readonly intentId: string; readonly result: TResult }
  | {
      readonly ok: false
      readonly intentId: string
      readonly reason: 'aborted' | 'timed-out' | 'transport'
      readonly error: unknown
    }

/**
 * The whole optimistic lifecycle in one place: submit, perform with the
 * domain's retry policy, settle the transport, wait for the acknowledgement
 * if the response does not carry it, then acknowledge or fail. Never rejects.
 */
export async function runIntent<TPatch, TResult>(
  queue: IntentQueue<TPatch>,
  patch: TPatch,
  options: RunIntentOptions<TPatch, TResult>,
): Promise<IntentOutcome<TResult>> {
  const { intent } = queue.submit(patch, options)
  const { intentId, resources } = intent
  const startedAt = nowMs()
  let attempts = 0

  const record = (
    outcome: IntentRunEvent['outcome'],
    transportEndedAt: number,
    error?: unknown,
  ) => {
    options.record?.({
      intentId,
      resources,
      outcome,
      transportMs: roundMs(transportEndedAt - startedAt),
      acknowledgementMs: roundMs(nowMs() - transportEndedAt),
      attempts,
      error,
    })
  }

  let result: TResult
  try {
    const performed = await performWithRetry(intent, options, (count) => {
      attempts = count
    })
    result = performed
  } catch (error) {
    const transportEndedAt = nowMs()
    if (options.signal?.aborted) {
      queue.discard(intentId)
      record('aborted', transportEndedAt, error)
      return { ok: false, intentId, reason: 'aborted', error }
    }
    // A stream can acknowledge before the response fails; the intent is then
    // already confirmed and only needs its transport phase closed.
    if (!queue.fail(intentId, error)) queue.settleTransport(intentId)
    record('failed', transportEndedAt, error)
    return { ok: false, intentId, reason: 'transport', error }
  }

  const transportEndedAt = nowMs()
  queue.settleTransport(intentId)

  if (options.until) {
    const acknowledgement = await waitUntil(options.until, options.signal)
    if (acknowledgement === 'aborted') {
      queue.discard(intentId)
      record('aborted', transportEndedAt)
      return { ok: false, intentId, reason: 'aborted', error: options.signal?.reason }
    }
    if (acknowledgement === 'timed-out') {
      const error = acknowledgementTimeoutError({
        intentId,
        resources,
        timeoutMs: options.until.timeoutMs ?? DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
      })
      queue.fail(intentId, error)
      record('timed-out', transportEndedAt, error)
      return { ok: false, intentId, reason: 'timed-out', error }
    }
  }

  queue.acknowledge(intentId)
  record('acknowledged', transportEndedAt)
  return { ok: true, intentId, result }
}

export const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 10_000

/**
 * Resolves as soon as `satisfied()` is true, checking once up front and again
 * on every notification, or gives up after the timeout.
 */
export function waitUntil(
  source: AcknowledgementSource,
  signal?: AbortSignal,
): Promise<'aborted' | 'satisfied' | 'timed-out'> {
  if (signal?.aborted) return Promise.resolve('aborted')
  if (source.satisfied()) return Promise.resolve('satisfied')

  return new Promise((resolve) => {
    const timeoutMs = source.timeoutMs ?? DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS
    let unsubscribe = () => undefined as void
    const timer = globalThis.setTimeout(() => finish('timed-out'), timeoutMs)

    function finish(outcome: 'aborted' | 'satisfied' | 'timed-out') {
      globalThis.clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    function onAbort() {
      finish('aborted')
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    unsubscribe = source.subscribe(() => {
      if (source.satisfied()) finish('satisfied')
    })
    // The notification that satisfies us may have fired between the sync check
    // and the subscription.
    if (source.satisfied()) finish('satisfied')
  })
}

async function performWithRetry<TPatch, TResult>(
  intent: Intent<TPatch>,
  options: RunIntentOptions<TPatch, TResult>,
  onAttempt: (count: number) => void,
): Promise<TResult> {
  const signal = options.signal ?? new AbortController().signal
  let failureCount = 0
  for (;;) {
    onAttempt(failureCount + 1)
    try {
      signal.throwIfAborted()
      return await options.perform(intent, signal)
    } catch (error) {
      if (signal.aborted) throw error
      if (!options.retry?.shouldRetry(failureCount, error)) throw error
      await delay(options.retry.delayMs(failureCount), signal)
      failureCount += 1
    }
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      globalThis.clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
