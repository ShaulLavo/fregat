import * as v from 'valibot'

export type GatewayOptions = {
  gatewayPort: number
  anthropicUrl: string
  proxyUrl: string
  apiKey: string
  // A separate loopback-only proxy that owns the Claude logins; without it Claude pools through proxyUrl.
  claudeProxy?: { proxyUrl: string; apiKey: string }
  // User-Agent entrypoints that may use the pool; defaults to the ones the proxy confirms as native.
  claudePoolEntrypoints?: readonly string[]
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

// CLIProxyAPI v8.0.4 reads exactly these caller headers to confirm native Claude Code and keep
// cloaking off (copyClaudeCallerFingerprintHeaders, DetectClaudeCodeRequest).
const claudePoolHeaders = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'user-agent',
  'x-app',
  'x-client-request-id',
  'x-client-app',
  'x-anthropic-additional-protection',
])
const claudePoolPrefixes = ['anthropic-', 'x-stainless-', 'x-claude-code-', 'x-claude-remote-']

// The proxy passes a request through untouched only when it confirms native Claude Code
// (v8.0.4 helps/claude_client_detection.go). Other entrypoints, Agent SDK `sdk-ts` included, get the
// proxy's CLI header fingerprint, so they join the pool only when configured.
export const nativeEntrypoints = ['cli', 'sdk-cli', 'claude-vscode']
const nativeUserAgent =
  /^claude-cli\/(\d+)\.(\d+)\.(\d+)\s+\(external,\s*([^,)]+)(?:,\s*agent-sdk\/\d+\.\d+\.\d+)?\)$/i
// The proxy's default device profile, claude-cli/2.1.280, accepts patch releases of 2.1 only.
const baselineVersion = { major: 2, minor: 1, patch: 280 }
const deviceId = /^[a-f0-9]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const userIdSchema = v.object({
  device_id: v.pipe(v.string(), v.regex(deviceId)),
  session_id: v.pipe(v.string(), v.regex(uuid)),
  account_uuid: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.regex(uuid))])),
})

function hasNativeUserId(input: object) {
  if (!('metadata' in input) || typeof input.metadata !== 'object' || input.metadata === null)
    return false
  if (!('user_id' in input.metadata) || typeof input.metadata.user_id !== 'string') return false
  try {
    return v.safeParse(userIdSchema, JSON.parse(input.metadata.user_id)).success
  } catch {
    return false
  }
}

function isPoolUserAgent(userAgent: string, entrypoints: readonly string[]) {
  const match = nativeUserAgent.exec(userAgent.trim())
  if (!match) return false
  const [, major, minor, patch, entrypoint] = match
  return (
    entrypoints.includes(entrypoint!.trim().toLowerCase()) &&
    Number(major) === baselineVersion.major &&
    Number(minor) === baselineVersion.minor &&
    Number(patch) >= baselineVersion.patch
  )
}

// Haiku helper requests omit the claude-code beta, so they always keep the direct path.
function isPoolEligible(
  headers: Headers,
  input: object,
  countTokens: boolean,
  entrypoints: readonly string[] = nativeEntrypoints,
) {
  const betas = (headers.get('anthropic-beta') ?? '').split(',').map((beta) => beta.trim())
  return (
    headers.get('x-app') === 'cli' &&
    isPoolUserAgent(headers.get('user-agent') ?? '', entrypoints) &&
    betas.includes('claude-code-20250219') &&
    (countTokens || hasNativeUserId(input))
  )
}

function connectionNominated(headers: Headers) {
  return new Set(
    (headers.get('connection') ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
}

function stripHopHeaders(headers: Headers) {
  for (const name of connectionNominated(headers)) headers.delete(name)
  for (const name of hopHeaders) headers.delete(name)
}

function claudePoolRequestHeaders(incoming: Headers, apiKey: string) {
  const nominated = connectionNominated(incoming)
  const headers = new Headers()
  for (const [name, value] of incoming) {
    if (nominated.has(name)) continue
    if (
      !claudePoolHeaders.has(name) &&
      !claudePoolPrefixes.some((prefix) => name.startsWith(prefix))
    )
      continue
    headers.set(name, value)
  }
  headers.set('authorization', `Bearer ${apiKey}`)
  return headers
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
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return null
    }
    const parsed = v.safeParse(registrySchema, await response.json())
    return parsed.success ? parsed.output.data.map((model) => model.id) : null
  } catch {
    return null
  }
}

function hasModel(models: readonly string[], model: string) {
  const lastOpen = model.lastIndexOf('(')
  const base = lastOpen >= 0 && model.endsWith(')') ? model.slice(0, lastOpen) : model
  // CLIProxyAPI looks up the trimmed base, then falls back to a full suffixed registration.
  return models.includes(base.trim()) || models.includes(model)
}

export async function waitForProxy(
  options: ProxyOptions,
  timeoutMs = startupWindowMs,
  signal?: AbortSignal,
  model?: string,
) {
  const deadline = performance.now() + timeoutMs
  let observed: readonly string[] | null = null
  while (!signal?.aborted && performance.now() < deadline) {
    const next = await readProxyModels(
      options,
      Math.min(1_000, deadline - performance.now()),
      signal,
    )
    if (next !== null || performance.now() < deadline) observed = next
    if (!signal?.aborted && hasGptModels(next) && (model === undefined || hasModel(next, model)))
      return next
    const remaining = deadline - performance.now()
    if (remaining > 0 && !signal?.aborted) await Bun.sleep(Math.min(100, remaining))
  }
  // The final shortened probe can time out after a healthy catalog established model absence.
  return !signal?.aborted && model !== undefined && hasGptModels(observed) ? observed : null
}

async function inspectProxyError(response: Response, signal: AbortSignal) {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const bytes = new Uint8Array(64 * 1024)
  let length = 0
  const expired = Promise.withResolvers<null>()
  const stop = () => expired.resolve(null)
  const timer = setTimeout(stop, 1_000)
  signal.addEventListener('abort', stop, { once: true })
  try {
    while (!signal.aborted) {
      const chunk = await Promise.race([reader.read(), expired.promise])
      if (chunk === null) return null
      if (chunk.done) return new TextDecoder().decode(bytes.subarray(0, length))
      if (length + chunk.value.byteLength > bytes.byteLength) return null
      bytes.set(chunk.value, length)
      length += chunk.value.byteLength
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
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

function reportClaudePool(
  level: 'warn' | 'info',
  state: 'fallback' | 'recovered',
  fields: Record<string, unknown>,
) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      source: 'be',
      area: 'claude-gpt',
      operation: 'claude-pool',
      state,
      ...fields,
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

  async function isReady(timeoutMs: number, signal?: AbortSignal, model?: string) {
    const next = await waitForProxy(options, timeoutMs, signal, model)
    if (next === null) {
      unavailable()
      if (model !== undefined && !signal?.aborted) reportReadiness('warn', 'gave-up', failedWaits)
      return false
    }
    if (failedWaits > 0) reportReadiness('info', 'reachable', failedWaits)
    failedWaits = 0
    models = next
    return true
  }

  async function recoverModel(model: string, signal: AbortSignal) {
    const observed = await readProxyModels(options, 1_000, signal)
    if (hasGptModels(observed) && hasModel(observed, model)) {
      models = observed
      return performance.now() < startupUntil ? 'retry' : 'forward'
    }
    unavailable()
    if (!(await isReady(Math.max(1, startupUntil - performance.now()), signal, model)))
      return proxyUnavailable()
    return models !== null && hasModel(models, model) ? 'retry' : missingModel()
  }

  let claudeFallbacks = 0

  function fellBack(reason: 'unreachable' | 'model-unlisted', model: string) {
    claudeFallbacks++
    if (claudeFallbacks > 1) return
    reportClaudePool('warn', 'fallback', {
      reason,
      model,
      why:
        reason === 'unreachable'
          ? 'The proxy did not accept the Claude request.'
          : 'The proxy registry does not list this Claude model.',
      fix: 'Claude requests use the Claude Code login directly until the proxy serves them. Check the proxy process and its Claude logins.',
    })
  }

  function pooled() {
    if (claudeFallbacks > 0) reportClaudePool('info', 'recovered', { count: claudeFallbacks })
    claudeFallbacks = 0
  }

  // A pool response, or the reason the request must go to Anthropic with Claude Code's own login.
  const claudePool = options.claudeProxy ?? options
  const poolEntrypoints = options.claudePoolEntrypoints ?? nativeEntrypoints

  async function sendToPool(path: string, request: Request, body: string) {
    let response: Response
    try {
      response = await fetch(new URL(path, claudePool.proxyUrl), {
        method: 'POST',
        headers: claudePoolRequestHeaders(request.headers, claudePool.apiKey),
        body,
        signal: request.signal,
        redirect: 'manual',
      })
    } catch (error) {
      if (request.signal.aborted) throw error
      return 'unreachable' as const
    }
    if (response.status !== 400) return response
    const text = await inspectProxyError(response, request.signal)
    if (text === null)
      return failure(
        502,
        'api_error',
        'The proxy error response exceeded the inspection limit. Check the proxy and retry.',
      )
    if (isUnknownProvider(text)) return 'model-unlisted' as const
    return new Response(text, { status: response.status, headers: response.headers })
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

    const path = url.pathname + url.search
    const headers = new Headers(request.headers)
    stripHopHeaders(headers)
    const init = {
      method: 'POST',
      headers,
      body,
      signal: request.signal,
      redirect: 'manual',
    } as const
    const countTokens = url.pathname === '/v1/messages/count_tokens'
    const eligible = isPoolEligible(request.headers, input, countTokens, poolEntrypoints)
    if (isClaude && !eligible) {
      return relay(await fetch(new URL(path, options.anthropicUrl), init))
    }
    if (isClaude) {
      const attempt = await sendToPool(path, request, body)
      if (attempt instanceof Response) {
        pooled()
        return relay(attempt)
      }
      fellBack(attempt, input.model)
      return relay(await fetch(new URL(path, options.anthropicUrl), init))
    }

    if (models === null) {
      if (!(await isReady(startupWindowMs, request.signal, input.model))) return proxyUnavailable()
      if (models !== null && !hasModel(models, input.model)) return missingModel()
    }
    for (const name of Array.from(headers.keys())) {
      if (!proxyHeaders.includes(name)) headers.delete(name)
    }
    headers.set('authorization', `Bearer ${options.apiKey}`)
    const upstream = new URL(path, options.proxyUrl)
    let response = await fetch(upstream, init)
    if (response.status === 400) {
      const text = await inspectProxyError(response, request.signal)
      if (text === null)
        return failure(
          502,
          'api_error',
          'The GPT proxy error response exceeded the inspection limit. Check the proxy and retry.',
        )
      response = new Response(text, { status: response.status, headers: response.headers })
      if (isUnknownProvider(text)) {
        const recovered = await recoverModel(input.model, request.signal)
        if (recovered instanceof Response) return recovered
        if (recovered === 'retry') response = await fetch(upstream, init)
      }
    }
    return relay(response)
  }
}

function relay(response: Response) {
  const responseHeaders = new Headers(response.headers)
  stripHopHeaders(responseHeaders)
  // fetch decompresses responses; forwarding their original encoding corrupts the stream.
  responseHeaders.delete('content-encoding')
  return new Response(response.body, { status: response.status, headers: responseHeaders })
}
