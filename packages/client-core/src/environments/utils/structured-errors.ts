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
      why: 'That server runs an older version of Platform than this page.',
      fix: `Update the Platform server at ${origin} to this page’s version, then press Retry.`,
    }
  return {
    why: 'That server runs a newer version of Platform than this page.',
    fix: 'Reload this page. If the message stays, update Platform on the machine that serves this page.',
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
    message: `The server at ${origin} is a different installation than before.`,
    why: 'The same address now answers with different app data, for example after Platform was reinstalled there.',
    fix: 'If you replaced that server on purpose, trust the new one to connect. This browser then forgets what it saved from the old one.',
    internal: { origin, expected, received },
  })
}

export function createQueryClientOwnerMissingError() {
  return createClientError({
    code: 'QUERY_CLIENT_OWNER_MISSING',
    status: 500,
    message: 'The app does not know which machine to ask for this data.',
    why: 'A request ran before its machine connection was set up.',
    fix: 'Reload the app and try again.',
  })
}

export function createQueryClientOwnerConflictError(
  expectedOrigin: string,
  receivedOrigin: string,
) {
  return createClientError({
    code: 'QUERY_CLIENT_OWNER_CONFLICT',
    status: 500,
    message: 'This data already belongs to another machine.',
    why: "Mixing two machines in one place would show one machine's data as the other's.",
    fix: 'Reload the app and try again.',
    internal: { expectedOrigin, receivedOrigin },
  })
}
