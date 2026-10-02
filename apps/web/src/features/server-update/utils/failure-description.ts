import type { UpdateIntent } from '@/features/server-update/state/intent'

export function updateFailureDescription(
  reason: Extract<UpdateIntent, { kind: 'failed' }>['reason'],
): string {
  if (reason === 'health-check')
    return 'The release failed its deployment check. Retry update checks this release again.'
  if (reason === 'unreachable')
    return 'The server could not be reached within the update time limit. Retry update checks the connection and release again.'
  if (reason === 'timeout')
    return 'The release did not become ready within the update time limit. Retry update checks this release again.'
  return 'The restart request failed. Retry update sends a new request for this release.'
}
