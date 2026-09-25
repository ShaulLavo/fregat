import { createPublicKey } from 'node:crypto'
import {
  pushDeviceRegistrationSchema,
  type PushService,
  type PushSubscriptionInput,
} from '@workspace/contracts'
import * as v from 'valibot'
import { pushErrors } from './structured-errors'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

type ParsedSubscription = {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly service: PushService
}

export type ParsedRegistration = {
  readonly label: string
  readonly subscription: ParsedSubscription
}

/** Validates a registration body. A refusal names the field and the rule, never the value. */
export function parseRegistration(input: unknown): ParsedRegistration {
  const parsed = v.safeParse(pushDeviceRegistrationSchema, input)
  if (!parsed.success) {
    const [issue] = parsed.issues
    invalid(v.getDotPath(issue) ?? 'body', { issue: issue.type })
  }

  return { label: parsed.output.label, subscription: parseSubscription(parsed.output.subscription) }
}

/** Checks what the browser sent before any push depends on it. */
function parseSubscription(input: PushSubscriptionInput): ParsedSubscription {
  const endpoint = new URL(input.endpoint)
  if (!acceptedEndpoint(endpoint)) invalid('endpoint-protocol', { protocol: endpoint.protocol })

  const p256dh = Buffer.from(input.keys.p256dh, 'base64url')
  if (!isP256Point(p256dh)) invalid('p256dh', { bytes: p256dh.length })

  const auth = Buffer.from(input.keys.auth, 'base64url')
  if (auth.length !== 16) invalid('auth', { bytes: auth.length })

  // Kept verbatim: the browser derives its device id from the exact string it holds.
  return {
    endpoint: input.endpoint,
    p256dh: p256dh.toString('base64url'),
    auth: auth.toString('base64url'),
    service: pushServiceFor(endpoint.hostname),
  }
}

// Every push service is https. A loopback http endpoint is a local stand-in, as the agent scenario runs.
function acceptedEndpoint(endpoint: URL) {
  if (endpoint.protocol === 'https:') return true

  return endpoint.protocol === 'http:' && LOOPBACK_HOSTS.has(endpoint.hostname)
}

function isP256Point(bytes: Buffer) {
  if (bytes.length !== 65 || bytes[0] !== 4) return false

  try {
    createPublicKey({
      format: 'jwk',
      key: {
        crv: 'P-256',
        kty: 'EC',
        x: bytes.subarray(1, 33).toString('base64url'),
        y: bytes.subarray(33).toString('base64url'),
      },
    })
    return true
  } catch {
    return false
  }
}

function invalid(field: string, facts: Record<string, unknown>): never {
  throw pushErrors.SUBSCRIPTION_INVALID({ internal: { field, ...facts } })
}

function pushServiceFor(hostname: string): PushService {
  if (hostname.endsWith('.push.apple.com')) return 'apple'
  if (hostname.endsWith('.googleapis.com')) return 'google'
  if (hostname.endsWith('.mozilla.com')) return 'mozilla'
  if (hostname.endsWith('.notify.windows.com')) return 'microsoft'

  return 'other'
}
