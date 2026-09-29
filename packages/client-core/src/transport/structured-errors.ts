import { defineErrorCatalog } from 'evlog'
import { createClientError } from '../errors'

// Namespace `client`: search, file watching and the log stream all throw it, so no feature owns it.
export const transportErrors = defineErrorCatalog('client', {
  EDEN_STREAM_MISSING: {
    status: 502,
    message: ({ label }: { label: string }) => `${label} got an empty answer from the server.`,
    why: 'The server answered without the live results this view reads.',
    fix: 'Reload the app and try again.',
  },
})

export function createOrchestrationRpcClosedError() {
  return createClientError({
    code: 'ORCHESTRATION_RPC_CLOSED',
    message: 'The chat connection is closed.',
    status: 499,
    why: 'The connection to this machine was closed while the request was running.',
    fix: 'Try again.',
  })
}

export function createLiveStreamOverflowError() {
  return createClientError({
    code: 'orchestration.LIVE_STREAM_OVERFLOW',
    message: 'Live updates came in faster than the app could show them.',
    status: 409,
    why: 'Too many updates arrived at once, so some were dropped.',
    fix: 'The app catches up on its own. Reload if the view looks out of date.',
  })
}
