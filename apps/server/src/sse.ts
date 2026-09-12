import { sse } from 'elysia'

import { captureRequestLogger, runWithRequestLogger } from './observability/logging'
import { createInternalError } from './observability/structured-errors'

export const SSE_HEARTBEAT_EVENT = 'heartbeat'
const SSE_HEARTBEAT_MS = 15_000

// Elysia's own set, kept whole: `transfer-encoding` is what selects its streaming
// path for a handler-returned Response, and there is no reason to take the other one.
const SSE_HEADERS = {
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'content-type': 'text/event-stream',
  'transfer-encoding': 'chunked',
} as const

// `sse()` attaches the serializer Elysia's own writer calls but does not declare it.
type SseFrame = { toSSE?: () => string }

function frameText(frame: unknown): string {
  const serialize = (frame as SseFrame | null)?.toSSE
  if (typeof serialize !== 'function') {
    throw createInternalError('SSE stream yielded a value that was not wrapped with sse()')
  }

  return serialize.call(frame)
}

export type SseEventOptions<T> = {
  data?: (event: T) => unknown
  event: (event: T) => string
  heartbeatMs?: number
}

export type ErrorSseEventOptions<T> = SseEventOptions<T> & {
  errorData: (error: unknown) => unknown
}

/**
 * Builds the response Elysia would have built from the generator, one lifecycle step
 * earlier. Returning the generator instead means the observability plugin inspects the
 * response before Elysia has made one, reads a non-stream, and closes the wide event
 * at the headers — before the stream it is supposed to describe has produced a chunk.
 *
 * Each step runs under the logger captured here, because the pulls driving them happen
 * after the request hooks that bind the ambient one.
 */
export function sseResponse(events: AsyncGenerator<unknown>, signal?: AbortSignal): Response {
  const logger = captureRequestLogger()
  const encoder = new TextEncoder()
  let ended = false

  // Never awaited. A generator parked on its next event settles `return()` only once
  // that event arrives, so awaiting it here would hang the cancel — and a cancel that
  // never resolves hangs whoever is closing the stream.
  const end = () => {
    if (ended) return
    ended = true
    void runWithRequestLogger(logger, () => events.return?.(undefined))
  }

  signal?.addEventListener('abort', end, { once: true })

  return new Response(
    new ReadableStream<Uint8Array>({
      cancel: end,
      async pull(controller) {
        const result = await runWithRequestLogger(logger, () => events.next())
        if (result.done) {
          ended = true
          controller.close()
          return
        }

        controller.enqueue(encoder.encode(frameText(result.value)))
      },
    }),
    { headers: SSE_HEADERS },
  )
}

export async function* toSse<T>(events: AsyncIterable<T>, options: SseEventOptions<T>) {
  const iterator = events[Symbol.asyncIterator]()
  let nextEvent = iterator.next().then(nextSseEventResult)

  try {
    while (true) {
      const result = await nextSseResult(nextEvent, options.heartbeatMs)
      if (result.kind === 'heartbeat') {
        yield sse({ data: null, event: SSE_HEARTBEAT_EVENT })
        continue
      }

      if (result.event.done) return

      yield sse({
        data: options.data?.(result.event.value) ?? result.event.value,
        event: options.event(result.event.value),
      })
      nextEvent = iterator.next().then(nextSseEventResult)
    }
  } finally {
    await iterator.return?.()
  }
}

export async function* toErrorYieldingSse<T>(
  events: AsyncIterable<T>,
  options: ErrorSseEventOptions<T>,
) {
  try {
    yield* toSse(events, options)
  } catch (error) {
    yield sse({
      data: options.errorData(error),
      event: 'error',
    })
  }
}

type NextSseResult<T> =
  | NextSseEventResult<T>
  | {
      kind: 'heartbeat'
    }

type NextSseEventResult<T> = {
  event: IteratorResult<T>
  kind: 'event'
}

async function nextSseResult<T>(
  nextEvent: Promise<NextSseEventResult<T>>,
  heartbeatMs?: number,
): Promise<NextSseResult<T>> {
  const normalizedHeartbeatMs = normalizeHeartbeatMs(heartbeatMs)
  if (normalizedHeartbeatMs === undefined) return nextEvent

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      nextEvent,
      new Promise<NextSseResult<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: 'heartbeat' }), normalizedHeartbeatMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function nextSseEventResult<T>(event: IteratorResult<T>): NextSseEventResult<T> {
  return { event, kind: 'event' }
}

function normalizeHeartbeatMs(heartbeatMs: number | undefined) {
  if (heartbeatMs === undefined) return SSE_HEARTBEAT_MS
  if (!Number.isFinite(heartbeatMs)) return undefined
  if (heartbeatMs <= 0) return undefined

  return heartbeatMs
}
