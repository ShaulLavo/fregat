import { createClientError } from '../errors'

export function acknowledgementTimeoutError({
  intentId,
  resources,
  timeoutMs,
}: {
  readonly intentId: string
  readonly resources: readonly string[]
  readonly timeoutMs: number
}) {
  return createClientError({
    code: 'client.OPTIMISTIC_ACK_TIMEOUT',
    status: 504,
    message: `Intent ${intentId} was not acknowledged within ${timeoutMs}ms`,
    why: 'The request succeeded but the confirmed data never reflected it, so the optimistic value was withdrawn.',
    fix: 'Check that the server publishes the change on the stream the acknowledgement predicate reads, or raise the timeout for this intent.',
    internal: { intentId, resources, timeoutMs },
  })
}
