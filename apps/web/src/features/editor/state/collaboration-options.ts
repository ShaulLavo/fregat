import {
  COLLABORATION_ADMISSION_TOKEN_REF,
  COLLABORATION_TURN_CREDENTIALS_REF,
  type CollaborationSecretRef,
} from '@workspace/contracts'
import type { CollaborationPluginOptions, EditEnvelope } from '@singapore-editor/collaboration'
import type {
  WebRTCTransportOptions,
  WebSocketSignalingOptions,
} from '@singapore-editor/collaboration/transports'
import * as v from 'valibot'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { collaborationConfigurationError } from '@/features/editor/utils/structured-errors'

export interface CollaborationSecretReader {
  readSecret(ref: CollaborationSecretRef): Promise<string | null>
}

export interface ResolvedCollaborationOptions {
  readonly signaling: Pick<WebSocketSignalingOptions, 'urls' | 'credentials'>
  readonly transport: Pick<
    WebRTCTransportOptions<EditEnvelope>,
    'iceServers' | 'transportPolicy' | 'credentials'
  >
  readonly presence: NonNullable<CollaborationPluginOptions['presence']>
}

const turnCredentialsSchema = v.record(
  v.string(),
  v.strictObject({
    username: v.pipe(v.string(), v.minLength(1)),
    credential: v.pipe(v.string(), v.minLength(1)),
  }),
)

/** Resolves configuration only; the session owner supplies room identity and transport lifecycle. */
export async function resolveCollaborationOptions(
  secrets: CollaborationSecretReader,
): Promise<ResolvedCollaborationOptions> {
  const values = readSettingsMirror()
  const urls = values['editor.collaboration.signalingUrls']
  if (urls.length === 0) throw collaborationConfigurationError('signaling')

  const iceServers = values['editor.collaboration.iceServers']
  if (iceServers.length === 0) throw collaborationConfigurationError('ice')

  const iceUrls = iceServers.flatMap((server) => server.urls)
  const turnUrls = [...new Set(iceUrls.filter((url) => /^turns?:/i.test(url)))]
  const transportPolicy = values['editor.collaboration.transportPolicy']
  if (transportPolicy === 'relay-only' && turnUrls.length === 0)
    throw collaborationConfigurationError('relay')

  const displayName = values['editor.collaboration.displayName']
  const colour = values['editor.collaboration.colour']
  if (!displayName.trim() || !colour) throw collaborationConfigurationError('presence')

  const admission: WebSocketSignalingOptions['credentials']['protocols'] = async (signal) => {
    signal.throwIfAborted()
    const token = await readSecret(secrets, COLLABORATION_ADMISSION_TOKEN_REF)
    signal.throwIfAborted()
    if (!token || !/^[a-z\d_-]{43,128}$/i.test(token))
      throw collaborationConfigurationError('admission')
    return [token]
  }
  await admission(new AbortController().signal)

  const turn = async (_peer: string, signal: AbortSignal): Promise<readonly RTCIceServer[]> => {
    signal.throwIfAborted()
    const stored = await readSecret(secrets, COLLABORATION_TURN_CREDENTIALS_REF)
    signal.throwIfAborted()
    const credentials = parseTurnCredentials(stored)
    return turnUrls.map((url) => {
      const credential = credentials[url]
      if (!credential) throw collaborationConfigurationError('turn')
      return { urls: url, ...credential }
    })
  }
  // Read again per connection so a renewed TURN password takes effect on the next handshake.
  if (turnUrls.length > 0) await turn('', new AbortController().signal)

  const resolved: ResolvedCollaborationOptions = {
    signaling: { urls, credentials: { protocols: admission } },
    transport: {
      iceServers: iceUrls.filter((url) => /^stuns?:/i.test(url)).map((url) => ({ urls: url })),
      transportPolicy: transportPolicy === 'relay-only' ? 'relay' : 'all',
      credentials: turnUrls.length > 0 ? { turn } : {},
    },
    presence: { displayName, colour },
  }
  // Credential capabilities stay local: snapshots and log serializers see configuration only.
  Object.defineProperty(resolved.signaling.credentials, 'protocols', { enumerable: false })
  if (turnUrls.length > 0)
    Object.defineProperty(resolved.transport.credentials, 'turn', { enumerable: false })
  return resolved
}

async function readSecret(secrets: CollaborationSecretReader, ref: CollaborationSecretRef) {
  try {
    return await secrets.readSecret(ref)
  } catch {
    // Storage errors may carry private paths or values; expose only the failed boundary.
    throw collaborationConfigurationError('secrets')
  }
}

function parseTurnCredentials(stored: string | null) {
  if (!stored) throw collaborationConfigurationError('turn')
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    throw collaborationConfigurationError('turn')
  }
  const parsed = v.safeParse(turnCredentialsSchema, value)
  if (!parsed.success) throw collaborationConfigurationError('turn')
  return parsed.output
}
