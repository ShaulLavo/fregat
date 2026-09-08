import { normalizeEdenDates } from './normalize-dates'
import { createClientError } from '../errors'
import { createRpcError } from './rpc-error'

export type EdenSseEvent = { event: string; data: unknown }

export function requireEdenData<T>(response: { data?: T | null; error?: unknown }): T {
  if (response.error) throw createRpcError(response.error)
  if (response.data == null) throw transportError('The server returned an empty response.')
  return response.data
}

function transportError(message: string, cause?: unknown) {
  return createClientError({
    code: 'CLIENT_TRANSPORT_FAILED',
    status: 502,
    message,
    cause,
    why: 'A server response could not be consumed.',
    fix: 'Inspect server logs and retry the request.',
  })
}

export async function* parseEdenSseStream(stream: unknown): AsyncGenerator<EdenSseEvent> {
  if (!isAsyncIterable(stream)) {
    throw transportError('Server response did not include an event stream.')
  }

  for await (const chunk of stream) {
    const event = edenSseEvent(chunk)
    if (event) yield event
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  )
}

function edenSseEvent(chunk: unknown): EdenSseEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  if (!('event' in chunk) || typeof chunk.event !== 'string') return null

  return {
    event: chunk.event,
    data: 'data' in chunk ? normalizeEdenDates(chunk.data) : null,
  }
}
