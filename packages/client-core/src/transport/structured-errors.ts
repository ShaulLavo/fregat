import { createClientError } from '../errors'

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
