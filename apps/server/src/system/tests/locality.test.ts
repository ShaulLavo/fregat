import { describe, expect, it } from 'vitest'
import { machineProxyHeaders } from '../../machines/proxy-http'
import { isLocal, localityFacts } from '../locality'

const INSTALL_ORIGIN = 'http://127.0.0.1:3301'
const origins = INSTALL_ORIGIN

function isLocalRequest(
  request: Request,
  peer: string | null,
  address: string,
  method: 'read' | 'write' = 'write',
) {
  return isLocal(localityFacts(request, peer, address), method)
}

function request(headers: Record<string, string>) {
  return new Request(`${INSTALL_ORIGIN}/system/capabilities`, {
    headers: { host: '127.0.0.1:3301', ...headers },
  })
}

describe('request locality', () => {
  it('counts a loopback request from the install origin with no hop as local', () => {
    expect(isLocalRequest(request({ origin: INSTALL_ORIGIN }), '127.0.0.1', origins)).toBe(true)
    expect(isLocalRequest(request({ origin: INSTALL_ORIGIN }), '::ffff:127.0.0.1', origins)).toBe(
      true,
    )
  })

  it('judges the socket address, not a header', () => {
    const local = request({ origin: INSTALL_ORIGIN })
    expect(isLocalRequest(local, '100.64.0.7', origins)).toBe(false)
    expect(isLocalRequest(local, null, origins)).toBe(false)
  })

  it('counts a mesh-forwarded request as remote', () => {
    const forwarded = request({ origin: INSTALL_ORIGIN, 'x-forwarded-for': '127.0.0.1' })
    expect(isLocalRequest(forwarded, '127.0.0.1', origins)).toBe(false)
    const prefixed = request({ origin: INSTALL_ORIGIN, 'x-forwarded-prefix': '/platform' })
    expect(isLocalRequest(prefixed, '127.0.0.1', origins)).toBe(false)
  })

  it('counts another origin as remote even over loopback', () => {
    const dev = request({ origin: 'http://127.0.0.1:5173' })
    expect(isLocalRequest(dev, '127.0.0.1', origins)).toBe(false)
    expect(isLocalRequest(request({}), '127.0.0.1', origins)).toBe(false)
  })

  it('counts a request the machine proxy relayed as remote', () => {
    const inbound = new Request('http://127.0.0.1:3301/machines/x/system/capabilities', {
      headers: { origin: INSTALL_ORIGIN, connection: 'via', via: '1.0 attacker' },
    })
    const relayed = new Request(`${INSTALL_ORIGIN}/system/capabilities`, {
      headers: machineProxyHeaders(inbound, INSTALL_ORIGIN),
    })
    expect(relayed.headers.get('origin')).toBe(INSTALL_ORIGIN)
    expect(isLocalRequest(relayed, '127.0.0.1', origins)).toBe(false)
  })
  // Browsers omit Origin on a same-origin GET; Sec-Fetch-Site still names the initiator.
  it('counts a same-origin browser read without Origin as local', () => {
    const read = request({ 'sec-fetch-site': 'same-origin' })
    expect(isLocalRequest(read, '127.0.0.1', origins, 'read')).toBe(true)
    expect(
      isLocalRequest(request({ 'sec-fetch-site': 'none' }), '127.0.0.1', origins, 'read'),
    ).toBe(true)
    expect(isLocalRequest(read, '127.0.0.1', origins, 'write')).toBe(false)
  })

  it('counts a cross-site read or a foreign Host as remote', () => {
    for (const site of ['cross-site', 'same-site'])
      expect(
        isLocalRequest(request({ 'sec-fetch-site': site }), '127.0.0.1', origins, 'read'),
      ).toBe(false)
    const rebound = request({ origin: INSTALL_ORIGIN, host: 'attacker.example:3301' })
    expect(isLocalRequest(rebound, '127.0.0.1', origins, 'read')).toBe(false)
    expect(isLocalRequest(rebound, '127.0.0.1', origins, 'write')).toBe(false)
  })
})
