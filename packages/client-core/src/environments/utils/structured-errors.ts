import { createClientError } from '../../errors'

export function createEnvironmentProtocolMismatchError(
  origin: string,
  expected: number,
  received: number,
) {
  return createClientError({
    code: 'ENVIRONMENT_PROTOCOL_MISMATCH',
    status: 403,
    message: `The server at ${origin} speaks protocol ${received}, and this client needs protocol ${expected}.`,
    ...protocolMismatchGuidance(origin, received < expected),
    internal: { origin, expected, received },
  })
}

function protocolMismatchGuidance(origin: string, serverOlder: boolean) {
  if (serverOlder)
    return {
      why: 'That server runs an older Platform version than this client.',
      fix: `Update the Platform server at ${origin} to this client’s version, then Retry.`,
    }
  return {
    why: 'That server runs a newer Platform version than this client.',
    fix: 'Reload this page; if the mismatch remains, update the Platform that serves it.',
  }
}

export function createEnvironmentIdentityDriftError(
  origin: string,
  expected: string,
  received: string,
) {
  return createClientError({
    code: 'ENVIRONMENT_IDENTITY_DRIFT',
    status: 403,
    message: `The server at ${origin} has a different environment identity.`,
    why: 'This origin answered with a different database identity than the one already recorded.',
    fix: 'Reconnect the original server, or restart the client to trust the replacement.',
    internal: { origin, expected, received },
  })
}

export function createQueryClientOwnerMissingError() {
  return createClientError({
    code: 'QUERY_CLIENT_OWNER_MISSING',
    status: 500,
    message: 'The query client has no owning environment.',
    why: 'A server query used a QueryClient without an associated HTTP client and origin.',
    fix: 'Create the query client with queryClientFor, or register its environment before use.',
  })
}

export function createQueryClientOwnerConflictError(
  expectedOrigin: string,
  receivedOrigin: string,
) {
  return createClientError({
    code: 'QUERY_CLIENT_OWNER_CONFLICT',
    status: 500,
    message: 'The query client already belongs to an environment.',
    why: 'Replacing its HTTP client could populate an existing environment cache from another server.',
    fix: 'Use a separate QueryClient for the other environment.',
    internal: { expectedOrigin, receivedOrigin },
  })
}
