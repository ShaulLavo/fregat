import { isRecord } from '@workspace/utils/objects'

import type { DevicePairing } from './devices/service'
import { headersReader, type HeaderReader } from './devices/trust'
import { errorPayload, FsError } from './fs/errors'
import { recordRequestContext, recordRequestWarning } from './observability'

type AuthCapability = 'filesystem:read' | 'filesystem:write'

type AuthPrincipal = {
  kind: 'local'
  capabilities: readonly AuthCapability[]
}

export type AuthOptions = {
  allowedOrigins?: readonly string[]
}

export type AuthConfig = {
  allowedOrigins: readonly string[]
  principal: AuthPrincipal
  /** Which other devices may reach this machine; null lets every allowed origin in. */
  devices: DevicePairing | null
}

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const

const localAuthPrincipal: AuthPrincipal = {
  kind: 'local',
  capabilities: ['filesystem:read', 'filesystem:write'],
}

export function createAuthConfig(
  options: AuthOptions = {},
  devices: DevicePairing | null = null,
): AuthConfig {
  return {
    allowedOrigins: options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    principal: localAuthPrincipal,
    devices,
  }
}

/** The origin allowlist alone: for the routes an unpaired device must reach to pair. */
export function originGuard(auth: AuthConfig) {
  return guard(auth, false)
}

/** The origin allowlist, then pairing for any device other than this machine. */
export function authGuard(auth: AuthConfig) {
  return guard(auth, true)
}

function guard(auth: AuthConfig, pairing: boolean) {
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    const origin = browserRequestOrigin(request, auth)
    const error =
      localBrowserOriginError(auth, origin) ??
      (pairing ? unpairedDeviceError(auth, headersReader(request.headers)) : null)
    if (!error) {
      recordRequestContext({ auth: { outcome: 'success' } })
      return undefined
    }

    set.status = error.statusCode
    recordRequestWarning('auth rejected request', {
      area: 'auth',
      auth: {
        errorCode: error.code,
        fetchSite: request.headers.get('sec-fetch-site'),
        origin,
        outcome: 'denied',
      },
      operation: 'authenticate',
      status: error.statusCode,
    })
    return errorPayload(error)
  }
}

export function authenticateWebSocketData(data: unknown, auth: AuthConfig): FsError | null {
  const headers = isRecord(data) && isRecord(data.headers) ? headersReader(data.headers) : null
  return (
    localBrowserOriginError(auth, originFromWebSocketData(data)) ??
    (headers ? unpairedDeviceError(auth, headers) : null)
  )
}

function unpairedDeviceError(auth: AuthConfig, header: HeaderReader) {
  if (!auth.devices || auth.devices.allows(header)) return null

  return new FsError('DEVICE_NOT_PAIRED', undefined, undefined, {
    why: 'This machine lets another device in once a pairing link from this machine has paired it.',
    fix: 'On this machine, open Settings › Machines, make a pairing link, and open it on this device.',
  })
}

export function isCorsOriginAllowed(auth: AuthConfig, origin: string | null) {
  return hasTrustedOrigin(auth, origin)
}

function localBrowserOriginError(auth: AuthConfig, origin: string | null) {
  if (!origin) return new FsError('UNAUTHORIZED')
  if (hasTrustedOrigin(auth, origin)) return null

  return new FsError('FORBIDDEN_ORIGIN')
}

function hasTrustedOrigin(auth: AuthConfig, origin: string | null) {
  if (!origin) return false

  return auth.allowedOrigins.includes(origin)
}

function browserRequestOrigin(request: Request, auth: AuthConfig): string | null {
  const origin = request.headers.get('origin')
  if (origin !== null) return origin

  // Cross-port download navigations omit Origin. Accept their referrer only
  // when the browser reports same-site and its origin exactly matches the allowlist.
  const site = request.headers.get('sec-fetch-site')
  if (site !== 'same-origin' && site !== 'same-site') return null

  const referer = request.headers.get('referer')
  const refererOrigin = referer ? (URL.parse(referer)?.origin ?? null) : null
  if (site === 'same-site' && !hasTrustedOrigin(auth, refererOrigin)) return null
  return refererOrigin
}

function originFromWebSocketData(data: unknown) {
  if (!isRecord(data)) return null
  if (!isRecord(data.headers)) return null

  const origin = data.headers.origin ?? data.headers.Origin
  return typeof origin === 'string' ? origin : null
}

// Two checks. The origin allowlist is exact: the launcher owes the server every origin the app can
// be reached at (`allowedOriginsForWebPort` in scripts/runtime-network.ts), and `assertLoopbackHost`
// (index.ts) keeps the socket on loopback. A request a proxy forwarded from another device then
// needs that device's pairing cookie (devices/service.ts): the proxy's origin is allowed for
// every device behind it, so the origin alone says nothing about who is asking.
