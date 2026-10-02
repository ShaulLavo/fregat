/** What decides whether a request came from this machine's own installed app. */
export type LocalityFacts = { loopback: boolean; proxyHop: boolean; installOrigin: boolean }

/**
 * A request is local when it reached this server over a loopback socket, from this machine's own
 * install origin, with no proxy hop. mesh serve always sets X-Forwarded-For, and the machine proxy
 * stamps Via, so a request tunneled from another device to loopback still reads as remote.
 */
export function localityFacts(
  request: Request,
  peerAddress: string | null,
  localOrigins: readonly string[],
): LocalityFacts {
  const origin = request.headers.get('origin')
  return {
    loopback: peerAddress !== null && isLoopbackAddress(peerAddress),
    proxyHop: hasProxyHop(request.headers),
    installOrigin: origin !== null && localOrigins.includes(origin),
  }
}

export function isLocal(facts: LocalityFacts) {
  return facts.loopback && !facts.proxyHop && facts.installOrigin
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
