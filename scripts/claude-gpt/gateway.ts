import * as v from 'valibot'

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

const registrySchema = v.object({ data: v.array(v.object({ id: v.string() })) })
const proxyErrorSchema = v.object({ error: v.object({ message: v.string() }) })
const startupWindowMs = 15_000

type ProxyOptions = Pick<GatewayOptions, 'proxyUrl' | 'apiKey'>

function hasGptModels(models: readonly string[] | null): models is readonly string[] {
  return models !== null && models.some((model) => model.startsWith('gpt-'))
}

async function readProxyModels(options: ProxyOptions, timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))
  try {
    const response = await fetch(new URL('/v1/models', options.proxyUrl), {
      headers: { authorization: `Bearer ${options.apiKey}` },
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return null
    const parsed = v.safeParse(registrySchema, await response.json())
    return parsed.success ? parsed.output.data.map((model) => model.id) : null
  } catch {
    return null
  }
}

export async function waitForProxy(
  options: ProxyOptions,
  timeoutMs = startupWindowMs,
  signal?: AbortSignal,
) {
  const deadline = performance.now() + timeoutMs
  while (!signal?.aborted && performance.now() < deadline) {
    const models = await readProxyModels(
      options,
      Math.min(250, deadline - performance.now()),
      signal,
    )
    if (hasGptModels(models)) return models
    const remaining = deadline - performance.now()
    if (remaining > 0 && !signal?.aborted) await Bun.sleep(Math.min(100, remaining))
  }
  return null
}

function isUnknownProvider(text: string) {
  try {
    const parsed = v.safeParse(proxyErrorSchema, JSON.parse(text))
    return parsed.success && /^unknown provider for model\b/i.test(parsed.output.error.message)
  } catch {
    return false
  }
}

function reportReadiness(
  level: 'warn' | 'info',
  state: 'unavailable' | 'reachable' | 'gave-up',
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
      timeoutMs: state === 'gave-up' ? startupWindowMs : undefined,
      fix:
        level === 'warn'
          ? 'Check the proxy process and login so its GPT model registry can load.'
          : 'GPT requests can proceed.',
    })}\n`,
  )
}

function proxyUnavailable() {
  return failure(
    503,
    'api_error',
    'The GPT proxy model registry did not become ready within the startup wait. Check the proxy process and login, then retry.',
  )
}

function missingModel() {
  return failure(
    400,
    'invalid_request_error',
    'The GPT model is absent from the loaded proxy registry. Choose a listed GPT model or check the proxy account model access.',
  )
}

function failure(status: number, type: string, message: string) {
  return Response.json({ type: 'error', error: { type, message } }, { status })
}

export function createGateway(options: GatewayOptions) {
  let models: readonly string[] | null = null
  let startupUntil = performance.now() + startupWindowMs
  let failedWaits = 0

  function unavailable() {
    if (models !== null) startupUntil = performance.now() + startupWindowMs
    models = null
    failedWaits++
    if (failedWaits === 1) reportReadiness('warn', 'unavailable', failedWaits)
  }

  async function isReady(timeoutMs: number, signal?: AbortSignal) {
    const next = await waitForProxy(options, timeoutMs, signal)
    if (next === null) {
      unavailable()
      return false
    }
    if (failedWaits > 0) reportReadiness('info', 'reachable', failedWaits)
    failedWaits = 0
    models = next
    return true
  }

  async function recoverModel(model: string, signal: AbortSignal) {
    const observed = await readProxyModels(options, 250, signal)
    if (hasGptModels(observed)) {
      models = observed
      if (!observed.includes(model)) return missingModel()
      return performance.now() < startupUntil ? 'retry' : 'forward'
    }
    unavailable()
    if (!(await isReady(Math.max(1, startupUntil - performance.now()), signal))) {
      reportReadiness('warn', 'gave-up', failedWaits)
      return proxyUnavailable()
    }
    return models?.includes(model) ? 'retry' : missingModel()
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
      return (await isReady(250, request.signal))
        ? Response.json({ status: 'ready' })
        : proxyUnavailable()
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
      if (models === null && !(await isReady(startupWindowMs, request.signal)))
        return proxyUnavailable()
      for (const name of Array.from(headers.keys())) {
        if (!proxyHeaders.includes(name)) headers.delete(name)
      }
      headers.set('authorization', `Bearer ${options.apiKey}`)
    }
    const upstream = new URL(
      url.pathname + url.search,
      isClaude ? options.anthropicUrl : options.proxyUrl,
    )
    const init = {
      method: 'POST',
      headers,
      body,
      signal: request.signal,
      redirect: 'manual',
    } as const
    let response = await fetch(upstream, init)
    if (isGpt && response.status === 400) {
      const text = await response.text()
      response = new Response(text, { status: response.status, headers: response.headers })
      if (isUnknownProvider(text)) {
        const recovered = await recoverModel(input.model, request.signal)
        if (recovered instanceof Response) return recovered
        if (recovered === 'retry') response = await fetch(upstream, init)
      }
    }
    const responseHeaders = new Headers(response.headers)
    stripHopHeaders(responseHeaders)
    // fetch decompresses responses; forwarding their original encoding corrupts the stream.
    responseHeaders.delete('content-encoding')
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  }
}
