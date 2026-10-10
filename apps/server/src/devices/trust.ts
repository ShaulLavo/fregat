import { isIP } from 'node:net'
import { isLoopbackAddress } from '../system/locality'

/** Reads one request header, from a `Headers` or a WebSocket's plain header record. */
export type HeaderReader = ((name: string) => string | null) & {
  readonly peerAddress?: string | null
  readonly proxyHop?: boolean
}

export function headersReader(headers: Headers | Readonly<Record<string, unknown>>): HeaderReader {
  if (headers instanceof Headers) return (name) => headers.get(name)
  return (name) => {
    const value = headers[name] ?? headers[name.toLowerCase()]
    return typeof value === 'string' ? value : null
  }
}

const requestHeaders = new WeakMap<Request, HeaderReader>()

/** Capture socket provenance before admission, including WebSocket upgrades. */
export function captureRequestHeaders(request: Request, peerAddress: string | null) {
  const header: HeaderReader = Object.assign(headersReader(request.headers), {
    peerAddress,
    proxyHop: Array.from(request.headers.keys()).some(
      (name) => ['forwarded', 'via', 'x-real-ip'].includes(name) || name.startsWith('x-forwarded-'),
    ),
  })
  requestHeaders.set(request, header)
  return header
}

/** Missing socket provenance fails closed, including in socket callbacks. */
export function requestHeaderReader(request: Request): HeaderReader {
  return requestHeaders.get(request) ?? headersReader(request.headers)
}

/** A direct loopback socket naming a loopback host and carrying no proxy markers. */
export function isDirectLocal(header: HeaderReader): boolean {
  if (!header.peerAddress || !isLoopbackAddress(header.peerAddress) || header.proxyHop) return false
  const host = header('host')
  const authority = host ? URL.parse(`http://${host}`) : null
  if (!authority || authority.host !== host?.toLowerCase()) return false
  const hostname = authority.hostname
  if (
    !hostname ||
    (hostname !== 'localhost' && !isLoopbackAddress(hostname.replace(/^\[|\]$/g, '')))
  )
    return false
  return ![
    'forwarded',
    'via',
    'x-real-ip',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-prefix',
    'x-forwarded-port',
  ].some((name) => header(name) !== null)
}

/** Only an explicitly trusted loopback proxy may name one client IP. */
export function forwardedPeer(
  header: HeaderReader,
  trustedHosts: readonly string[],
): string | null {
  if (!header.peerAddress || !isLoopbackAddress(header.peerAddress)) return null
  const host = header('host')?.toLowerCase()
  if (!host || !trustedHosts.some((trusted) => trusted.toLowerCase() === host)) return null
  const value = header('x-forwarded-for')?.trim()
  return value && isIP(value) !== 0 ? value : null
}

/** The device credential from the `Cookie` header, split into its id and secret. */
export function deviceCredential(header: HeaderReader, cookieName: string) {
  const cookie = header('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=')
    if (name !== cookieName || !value) continue
    const [id, secret] = value.split('.')
    if (id && secret) return { id, secret }
  }
  return null
}
