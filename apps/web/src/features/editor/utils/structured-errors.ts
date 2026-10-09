import { defineErrorCatalog } from 'evlog'
import { createClientError } from '@workspace/client-core/errors'

const errors = defineErrorCatalog('collaboration', {
  CONFIGURATION_UNAVAILABLE: {
    status: 503,
    message: 'Collaboration is unavailable',
    why: 'The collaboration connection configuration is incomplete.',
    fix: 'Configure collaboration servers, presence and credentials before joining a session.',
  },
})

const requirements = {
  signaling: {
    why: 'Collaboration needs a configured signaling broker.',
    fix: 'Add a WebSocket URL to the collaboration signaling servers setting.',
  },
  ice: {
    why: 'Collaboration needs configured ICE servers to connect editing peers.',
    fix: 'Add a STUN or TURN server to the collaboration ICE servers setting.',
  },
  relay: {
    why: 'Relay connections need a configured TURN server.',
    fix: 'Add a TURN server or choose direct and relay connections.',
  },
  presence: {
    why: 'Collaboration needs your display name and presence colour.',
    fix: 'Set a collaboration display name and a six-digit hex presence colour.',
  },
  admission: {
    why: 'The signaling broker admission token is missing or has an invalid format.',
    fix: 'Store the broker admission token in the collaboration secret store entry.',
  },
  turn: {
    why: 'A configured TURN server needs a username and password from the secret store.',
    fix: 'Store TURN credentials keyed by each configured TURN URI in the collaboration secret store entry.',
  },
  secrets: {
    why: 'The collaboration secret store could not be read.',
    fix: 'Check access to the secret store and try joining again.',
  },
} as const

export function collaborationConfigurationError(requirement: keyof typeof requirements) {
  const { code, status, message } = errors.CONFIGURATION_UNAVAILABLE
  return createClientError({
    code,
    status,
    message,
    ...requirements[requirement],
    internal: { requirement },
  })
}

const recordingErrors = defineErrorCatalog('editorDiagnostics', {
  RECORDING_LOAD_FAILED: {
    status: 503,
    message: 'Editor recording is unavailable',
    why: 'The recording module could not be loaded.',
    fix: 'Reload the app to try recording again. You can keep working.',
  },
})

export function performanceRecordingLoadError(cause: unknown) {
  const { code, status, message, why, fix } = recordingErrors.RECORDING_LOAD_FAILED
  return createClientError({
    code,
    status,
    message,
    why,
    fix,
    cause,
    internal: { phase: 'module-load' },
  })
}
