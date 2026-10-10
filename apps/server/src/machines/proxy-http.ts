import { createMachineProxyError } from './proxy-errors'

export type MachineProxyFetcher = (input: URL, init: RequestInit) => Promise<Response>

const hopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

export function machineProxyTarget(origin: string, request: Request, path: string) {
  const target = new URL(origin)
  target.pathname = `/${path}`
  target.search = new URL(request.url).search
  return target
}

/**
 * The destination receives this relay's own paired credential; caller credentials and forwarded
 * addresses belong to the source machine and never cross that boundary.
 */
export function machineProxyHeaders(request: Request, webOrigin: string, cookie: string) {
  const headers = endToEndHeaders(request.headers)
  for (const name of ['host', 'cookie', 'authorization', 'referer', 'content-length']) {
    headers.delete(name)
  }
  // Deleting a header shifts its live iterator, so consume a snapshot of the names.
  for (const name of Array.from(headers.keys())) {
    if (
      name === 'forwarded' ||
      name === 'x-real-ip' ||
      name.startsWith('x-forwarded-') ||
      name.startsWith('sec-websocket-')
    )
      headers.delete(name)
  }
  headers.set('origin', webOrigin)
  headers.set('cookie', cookie)
  // The hop marker the target's locality check reads: a loopback tunnel must not look local.
  headers.set('via', '1.1 fregat')
  return headers
}

export async function forwardMachineRequest(
  request: Request,
  target: URL,
  headers: Headers,
  fetcher: MachineProxyFetcher,
) {
  try {
    const response = await fetcher(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'error',
      signal: request.signal,
    })
    const responseHeaders = endToEndHeaders(response.headers)
    // Fetch decodes compressed bodies; the original length and encoding no longer apply.
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    for (const name of Array.from(responseHeaders.keys())) {
      if (name.startsWith('access-control-')) responseHeaders.delete(name)
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (cause) {
    throw createMachineProxyError(cause)
  }
}

function endToEndHeaders(source: Headers) {
  const headers = new Headers(source)
  for (const name of source.get('connection')?.split(',') ?? []) {
    headers.delete(name.trim())
  }
  for (const name of hopHeaders) headers.delete(name)
  return headers
}
