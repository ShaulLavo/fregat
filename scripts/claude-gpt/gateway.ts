type GatewayOptions = {
  anthropicUrl: string
  proxyUrl: string
  apiKey: string
}

const messagePaths = new Set(['/v1/messages', '/v1/messages/count_tokens'])
const hopHeaders = ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding']

function failure(status: number, type: string, message: string) {
  return Response.json({ type: 'error', error: { type, message } }, { status })
}

export function createGateway(options: GatewayOptions) {
  return async (request: Request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ready' })
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
    for (const name of hopHeaders) headers.delete(name)
    if (isGpt) {
      // Claude OAuth and API keys belong only on requests to Anthropic.
      headers.delete('x-api-key')
      headers.delete('cookie')
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
    for (const name of hopHeaders) responseHeaders.delete(name)
    // fetch decompresses responses; forwarding their original encoding corrupts the stream.
    responseHeaders.delete('content-encoding')
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  }
}
