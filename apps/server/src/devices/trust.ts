import { networkInterfaces } from 'node:os'

/** Reads one request header, from a `Headers` or a WebSocket's plain header record. */
export type HeaderReader = (name: string) => string | null

export function headersReader(headers: Headers | Readonly<Record<string, unknown>>): HeaderReader {
  if (headers instanceof Headers) return (name) => headers.get(name)
  return (name) => {
    const value = headers[name] ?? headers[name.toLowerCase()]
    return typeof value === 'string' ? value : null
  }
}

/**
 * The client a forwarding proxy names, or null when the request reached this server directly. The
 * mesh proxy always sets `X-Forwarded-For` and drops any a client sent, so a direct request is one
 * from this machine.
 */
export function forwardedClient(header: HeaderReader): string | null {
  const value = header('x-forwarded-for')
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

/** Loopback, or an address one of this machine's own interfaces holds (its tailnet address). */
export function isThisMachine(address: string, own: ReadonlySet<string>): boolean {
  const plain = address.replace(/^::ffff:/, '')
  if (plain === '::1' || plain.startsWith('127.')) return true
  return own.has(plain)
}

export function ownAddresses(): ReadonlySet<string> {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) addresses.add(entry.address.replace(/%.*$/, ''))
  return addresses
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
