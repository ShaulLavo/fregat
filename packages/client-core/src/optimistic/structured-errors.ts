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
    message: 'Your change was sent but never showed up',
    why: 'The server accepted the change, but the app did not see it arrive in time, so it shows the old value again.',
    fix: 'Check whether the change took effect. If it did not, make it again.',
    internal: { intentId, resources, timeoutMs },
  })
}
