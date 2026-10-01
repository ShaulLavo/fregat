import { createConnection } from 'node:net'

export type GatewayOptions = {
  gatewayPort: number
  anthropicUrl: string
  proxyUrl: string
  apiKey: string
}

const loopbackHost = /^(?:127\.0\.0\.1\.?|localhost\.?|\[::1\])(?::[0-9]+)?$/i

const messagePaths = new Set(['/v1/messages', '/v1/messages/count_tokens'])
const hopHeaders = [
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]
const proxyHeaders = [
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'x-claude-code-session-id',
  'x-claude-code-agent-id',
  'x-claude-code-parent-agent-id',
]

function stripHopHeaders(headers: Headers) {
  for (const token of (headers.get('connection') ?? '').split(',')) {
    const name = token.trim()
    if (name) headers.delete(name)
  }
  for (const name of hopHeaders) headers.delete(name)
}

function proxyReachable(port: number, timeout: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (ready: boolean) => {
      socket.destroy()
      resolve(ready)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeout, () => finish(false))
  })
}

export async function waitForProxy(port: number, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (await proxyReachable(port, Math.max(1, Math.min(250, deadline - performance.now()))))
      return true
    const remaining = deadline - performance.now()
    if (remaining > 0) await Bun.sleep(Math.min(100, remaining))
  }
  return false
}

function reportReadiness(
  level: 'warn' | 'info',
  state: 'unavailable' | 'reachable',
  count: number,
) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      source: 'be',
      area: 'claude-gpt',
      operation: 'proxy-readiness',
      state,
      count,
      fix:
        level === 'warn'
          ? 'Check the proxy process; later requests will retry readiness.'
          : 'GPT requests can proceed.',
    })}\n`,
  )
}

function proxyUnavailable() {
  return failure(
    503,
    'api_error',
    'The local GPT proxy is starting or unavailable. Check the proxy process and retry.',
  )
}

function failure(status: number, type: string, message: string) {
  return Response.json({ type: 'error', error: { type, message } }, { status })
}

export function createGateway(options: GatewayOptions) {
  let ready = false
  let failedWaits = 0
  const proxyPort = Number(new URL(options.proxyUrl).port || 80)
  async function isReady() {
    if (ready) return true
    if (await waitForProxy(proxyPort, 250)) {
      if (!ready && failedWaits > 0) reportReadiness('info', 'reachable', failedWaits)
      ready = true
      return true
    }
    if (ready) return true
    failedWaits++
    if (failedWaits === 1) reportReadiness('warn', 'unavailable', failedWaits)
    return false
  }
  return async (request: Request) => {
    if (
      !loopbackHost.test(request.headers.get('host') ?? '') ||
      ['origin', 'sec-fetch-site'].some((name) => request.headers.has(name))
    ) {
      return failure(403, 'permission_error', 'Use the local gateway from Claude Code.')
    }
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return (await isReady()) ? Response.json({ status: 'ready' }) : proxyUnavailable()
    }
    if (request.method !== 'POST' || !messagePaths.has(url.pathname)) {
      return failure(404, 'not_found_error', 'Use the Claude Messages endpoint.')
    }
    if (!request.headers.has('authorization') && !request.headers.has('x-api-key')) {
      return failure(
        401,
        'authentication_error',
        'Sign in to Claude Code before starting this session.',
      )
    }

    const body = await request.text()
    let input: unknown
    try {
      input = JSON.parse(body)
    } catch {
      return failure(400, 'invalid_request_error', 'Send a JSON Messages request.')
    }
    if (
      typeof input !== 'object' ||
      input === null ||
      !('model' in input) ||
      typeof input.model !== 'string'
    ) {
      return failure(400, 'invalid_request_error', 'Choose a model for this request.')
    }
    const isClaude = input.model.startsWith('claude-')
    const isGpt = input.model.startsWith('gpt-')
    if (!isClaude && !isGpt) {
      return failure(400, 'invalid_request_error', 'Choose a Claude or GPT model.')
    }

    const headers = new Headers(request.headers)
    stripHopHeaders(headers)
    if (isGpt) {
      if (!(await isReady())) return proxyUnavailable()
      for (const name of Array.from(headers.keys())) {
        if (!proxyHeaders.includes(name)) headers.delete(name)
      }
      headers.set('authorization', `Bearer ${options.apiKey}`)
    }
    const upstream = new URL(
      url.pathname + url.search,
      isClaude ? options.anthropicUrl : options.proxyUrl,
    )
    const response = await fetch(upstream, {
      method: 'POST',
      headers,
      body,
      signal: request.signal,
      redirect: 'manual',
    })
    const responseHeaders = new Headers(response.headers)
    stripHopHeaders(responseHeaders)
    // fetch decompresses responses; forwarding their original encoding corrupts the stream.
    responseHeaders.delete('content-encoding')
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  }
}
