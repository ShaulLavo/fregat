import { captureRequestHeaders } from '../devices/trust'
import { isLoopbackAddress } from '../system/locality'
import type { PeerAddress } from '../system/service'

/** In-process fixtures simulate loopback transport; explicit Host headers preserve proxy cases. */
export const testLoopbackPeer: PeerAddress = (request) => {
  if (!request.headers.has('host')) {
    const url = new URL(request.url)
    const local =
      url.hostname === 'localhost' || isLoopbackAddress(url.hostname.replace(/^\[|\]$/g, ''))
    request.headers.set('host', local ? url.host : '127.0.0.1:3001')
  }
  return '127.0.0.1'
}

/** Route-hook socket fixtures bypass onRequest and capture their simulated transport explicitly. */
export function testLoopbackRequest(request: Request) {
  captureRequestHeaders(request, testLoopbackPeer(request, null))
  return request
}
