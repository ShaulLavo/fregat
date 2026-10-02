/** What decides whether a request came from this machine's own installed app. */
export type LocalityFacts = {
  loopback: boolean
  proxyHop: boolean
  ownHost: boolean
  /** `own`: Origin is this server's address. `same-origin`: no Origin, and no cross-site initiator. */
  origin: 'own' | 'same-origin' | 'other'
}

/**
 * A request is local when it reached this server over a loopback socket, names this server's own
 * address as Host, and carries no proxy hop. mesh serve always sets X-Forwarded-For, and the
 * machine proxy stamps Via, so a request tunneled from another device to loopback reads as remote.
 */
export function localityFacts(
  request: Request,
  peerAddress: string | null,
  address: string,
): LocalityFacts {
  return {
    loopback: peerAddress !== null && isLoopbackAddress(peerAddress),
    proxyHop: hasProxyHop(request.headers),
    ownHost: request.headers.get('host') === new URL(address).host,
    origin: originKind(request.headers, address),
  }
}

/**
 * Browsers omit Origin on a same-origin GET but always send it on POST, so a read may also prove
 * itself through Sec-Fetch-Site; a write needs the Origin.
 */
export function isLocal(facts: LocalityFacts, access: 'read' | 'write') {
  if (!facts.loopback || facts.proxyHop || !facts.ownHost) return false
  return facts.origin === 'own' || (access === 'read' && facts.origin === 'same-origin')
}

function originKind(headers: Headers, address: string): LocalityFacts['origin'] {
  const origin = headers.get('origin')
  if (origin !== null) return origin === address ? 'own' : 'other'
  const site = headers.get('sec-fetch-site')
  return site === null || site === 'same-origin' || site === 'none' ? 'same-origin' : 'other'
}

function hasProxyHop(headers: Headers): boolean {
  for (const name of headers.keys()) {
    if (name === 'forwarded' || name === 'via' || name === 'x-real-ip') return true
    if (name.startsWith('x-forwarded-')) return true
  }
  return false
}

export function isLoopbackAddress(address: string): boolean {
  const plain = address.replace(/^::ffff:/, '')
  return plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain)
}
