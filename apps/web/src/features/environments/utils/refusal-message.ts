import type { ServerConnectionState } from '@workspace/client-core/environments/utils/connection'
import {
  createEnvironmentIdentityDriftError,
  createEnvironmentProtocolMismatchError,
} from '@workspace/client-core/environments/utils/structured-errors'

export function refusalMessage(connection: ServerConnectionState, origin: string) {
  if (connection.phase === 'protocol-mismatch') {
    const error = createEnvironmentProtocolMismatchError(
      origin,
      connection.expected,
      connection.received,
    )
    return `${error.message} ${error.fix}`
  }
  if (connection.phase === 'identity-drift') {
    const error = createEnvironmentIdentityDriftError(
      origin,
      connection.expected,
      connection.received,
    )
    return `${error.message} ${error.fix}`
  }
  return 'The server connection was refused.'
}
