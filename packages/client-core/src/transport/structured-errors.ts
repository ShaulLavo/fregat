import { defineErrorCatalog } from 'evlog'
import { createClientError } from '../errors'

// Namespace `client`: search, file watching and the log stream all throw it, so no feature owns it.
export const transportErrors = defineErrorCatalog('client', {
  EDEN_STREAM_MISSING: {
    status: 502,
    message: ({ label }: { label: string }) => `${label} response did not include a stream.`,
    why: 'The RPC call succeeded without the SSE body required by the caller.',
    fix: 'Verify the server route returns an event stream for this request.',
  },
})

export function createOrchestrationRpcClosedError() {
  return createClientError({
    code: 'ORCHESTRATION_RPC_CLOSED',
    message: 'The chat transport is closed.',
    status: 499,
    why: 'The owner released this environment connection.',
    fix: 'Use the current chat transport to start another operation.',
  })
}

export function createLiveStreamOverflowError() {
  return createClientError({
    code: 'orchestration.LIVE_STREAM_OVERFLOW',
    message: 'Live updates exceeded the subscription buffer.',
    status: 409,
    why: 'Updates arrived faster than the subscription consumer could apply them.',
    fix: 'Resume from the last applied sequence.',
  })
}
