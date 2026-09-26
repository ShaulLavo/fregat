import type { PushNotice, PushService } from '@workspace/contracts'
import { generateRequestDetails, type RequestDetails, type Urgency } from 'web-push'
import type { PushDeviceRow } from './device-store'
import type { VapidKeys } from './vapid'

/** The push-service boundary. Production passes `fetch`; tests answer as the push service. */
export type PushFetcher = (url: string, init: RequestInit) => Promise<Response>

type PushOutcome = 'sent' | 'expired' | 'rejected' | 'unreachable' | 'removed'

export type PushDelivery = {
  readonly outcome: PushOutcome
  readonly service: PushService
  /** The push service's HTTP status, null when no answer arrived. */
  readonly status: number | null
  /** The transport error's name when no answer arrived. Never its message, which can hold the endpoint. */
  readonly failure: string | null
}

export type PushMessageOptions = {
  readonly ttlSeconds: number
  readonly topic?: string
  readonly urgency?: Urgency
}

const SEND_TIMEOUT_MS = 15_000

/** Encrypts `notice` for one device (RFC 8291), signs it (RFC 8292) and posts it to its push service. */
export async function deliverPush(
  fetcher: PushFetcher,
  device: PushDeviceRow,
  keys: VapidKeys,
  notice: PushNotice,
  options: PushMessageOptions,
): Promise<PushDelivery> {
  const request = generateRequestDetails(
    { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
    JSON.stringify(notice),
    {
      TTL: options.ttlSeconds,
      topic: options.topic,
      urgency: options.urgency,
      vapidDetails: {
        subject: vapidSubject(device.origin),
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
    },
  )
  const answer = await post(fetcher, request)

  return { ...answer, outcome: outcomeFor(answer.status), service: device.service }
}

async function post(fetcher: PushFetcher, request: RequestDetails) {
  try {
    const response = await fetcher(request.endpoint, {
      method: request.method,
      redirect: 'error',
      headers: requestHeaders(request.headers),
      body: request.body ? new Uint8Array(request.body) : null,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    await response.body?.cancel()
    return { status: response.status, failure: null }
  } catch (error) {
    return { status: null, failure: error instanceof Error ? error.name : 'unknown' }
  }
}

// `fetch` sets Content-Length from the body itself.
function requestHeaders(headers: RequestDetails['headers']) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => name.toLowerCase() !== 'content-length')
      .map(([name, value]) => [name, String(value)]),
  )
}

function outcomeFor(status: number | null): PushOutcome {
  if (status === null) return 'unreachable'
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'expired'

  return 'rejected'
}

// Apple refuses a localhost subject, and an iPhone only receives push from an https page.
function vapidSubject(origin: string | null) {
  if (origin?.startsWith('https://')) return origin

  return 'mailto:platform@localhost'
}
