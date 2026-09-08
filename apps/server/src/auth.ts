import { isRecord } from '@workspace/contracts'

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
}

const DEFAULT_ALLOWED_ORIGINS = [
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

export function createAuthConfig(options: AuthOptions = {}): AuthConfig {
  return {
    allowedOrigins: options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    principal: localAuthPrincipal,
  }
}

export function authGuard(auth: AuthConfig) {
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    const origin = browserRequestOrigin(request)
    const error = localBrowserOriginError(auth, origin)
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
  return localBrowserOriginError(auth, originFromWebSocketData(data))
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

function browserRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin')
  if (origin !== null) return origin

  // Browsers omit Origin on same-origin GETs. The referrer must still
  // resolve to an exact allowlisted origin, including behind a mesh proxy.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return null

  const referer = request.headers.get('referer')
  return referer ? (URL.parse(referer)?.origin ?? null) : null
}

function originFromWebSocketData(data: unknown) {
  if (!isRecord(data)) return null
  if (!isRecord(data.headers)) return null

  const origin = data.headers.origin ?? data.headers.Origin
  return typeof origin === 'string' ? origin : null
}

// This guard is the origin allowlist and nothing else, and it is exact. The
// launcher owes the server every origin the app can be reached at
// (`allowedOriginsForWebPort` in scripts/runtime-network.ts), and
// `assertLoopbackHost` (index.ts) keeps the socket on loopback — those two
// facts are what make an origin-only guard adequate for a local dev tool.
// There is no token mode: the previous env-var one could not be satisfied by
// any shipping client and was deleted. Real, revocable sessions are milestone
// M4 in docs/environments-and-remote-plan.md.
