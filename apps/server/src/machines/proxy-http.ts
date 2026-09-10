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

export function machineProxyHeaders(request: Request, webOrigin: string) {
  const headers = endToEndHeaders(request.headers)
  for (const name of ['host', 'cookie', 'authorization', 'referer', 'content-length']) {
    headers.delete(name)
  }
  for (const name of headers.keys()) {
    if (name.startsWith('sec-websocket-')) headers.delete(name)
  }
  headers.set('origin', webOrigin)
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
    for (const name of responseHeaders.keys()) {
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
