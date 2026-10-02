import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as v from 'valibot'
import { createGateway } from './gateway'
import { configSchema } from './run'

beforeEach(() => vi.stubGlobal('fetch', async () => new Response('network blocked by fixture')))
afterEach(() => vi.unstubAllGlobals())

function request(signal?: AbortSignal) {
  return new Request('http://127.0.0.1:18318/v1/messages?beta=true', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:18318',
      authorization: 'Bearer caller-own-login',
      'content-type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'x-app': 'cli',
    },
    body: '{ "model": "claude-test", "messages": [], "private": "original bytes" }',
    signal,
  })
}

test('direct Claude captures headers without body reads, extra provider calls, or response mutation', async () => {
  const chunk = new TextEncoder().encode('data: {"type":"tool_use"}\n\n')
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(chunk)
        controller.close()
      },
    }),
    {
      status: 429,
      headers: {
        'content-type': 'text/event-stream',
        'anthropic-ratelimit-unified-5h-status': 'rejected',
        'x-request-id': 'unchanged',
        'retry-after': '12',
      },
    },
  )
  const text = vi.spyOn(response, 'text')
  const json = vi.spyOn(response, 'json')
  const clone = vi.spyOn(response, 'clone')
  const calls: { url: string; init?: RequestInit }[] = []
  const observed: Headers[] = []
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response
  }
  vi.stubGlobal('fetch', fetcher)
  const gateway = createGateway({
    gatewayPort: 18318,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: 'http://127.0.0.1:18317',
    apiKey: 'codex-key',
    claudePoolEntrypoints: [],
    fetcher,
    observeClaudeHeaders: (headers) => {
      observed.push(new Headers(headers))
    },
  })
  const input = request()
  const output = await gateway(input)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages?beta=true')
  expect(calls[0]!.init!.body).toBe(await request().text())
  expect(calls[0]!.init!.signal).toBe(input.signal)
  expect(new Headers(calls[0]!.init!.headers).get('authorization')).toBe('Bearer caller-own-login')
  expect(observed).toHaveLength(1)
  expect(observed[0]!.get('anthropic-ratelimit-unified-5h-status')).toBe('rejected')
  expect(text).not.toHaveBeenCalled()
  expect(json).not.toHaveBeenCalled()
  expect(clone).not.toHaveBeenCalled()
  expect(output.status).toBe(429)
  expect(output.headers.get('x-request-id')).toBe('unchanged')
  expect(output.headers.get('retry-after')).toBe('12')
  expect(new Uint8Array(await output.arrayBuffer())).toEqual(chunk)
})

test('observer failure cannot change successful stream; cancellation reaches original fetch and body', async () => {
  const abort = new AbortController()
  let canceled = false
  let upstreamSignal: AbortSignal | null | undefined
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    upstreamSignal = init!.signal
    return new Response(
      new ReadableStream({
        cancel() {
          canceled = true
        },
      }),
    )
  }
  vi.stubGlobal('fetch', fetcher)
  const gateway = createGateway({
    gatewayPort: 18318,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: 'http://127.0.0.1:18317',
    apiKey: 'codex-key',
    claudePoolEntrypoints: [],
    fetcher,
    observeClaudeHeaders: () => {
      throw new DOMException('injected observer failure')
    },
  })
  const output = await gateway(request(abort.signal))
  expect(output.status).toBe(200)
  abort.abort()
  expect(upstreamSignal!.aborted).toBe(true)
  await output.body!.cancel()
  expect(canceled).toBe(true)
})

test('transport rejection stays original error and produces no observation', async () => {
  const failure = new DOMException('injected transport failure', 'AbortError')
  const observer = vi.fn()
  vi.stubGlobal('fetch', async () => {
    throw failure
  })
  const gateway = createGateway({
    gatewayPort: 18318,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: 'http://127.0.0.1:18317',
    apiKey: 'codex-key',
    claudePoolEntrypoints: [],
    fetcher: async () => {
      throw failure
    },
    observeClaudeHeaders: observer,
  })
  await expect(gateway(request())).rejects.toBe(failure)
  expect(observer).not.toHaveBeenCalled()
})

test('feed runtime config requires empty Claude pool entrypoints and no Claude proxy', () => {
  const base = {
    binary: 'proxy',
    proxyConfig: 'config.yaml',
    proxyPort: 18317,
    gatewayPort: 18318,
    apiKey: 'codex-key',
    claudePoolEntrypoints: [],
    usageFeed: { managementKeyFile: 'management-key' },
  }
  const parsed = v.parse(configSchema, base)
  expect(parsed.claudePoolEntrypoints).toEqual([])
  expect(parsed.usageFeed?.accounts.map(({ plan }) => plan)).toEqual(['max', 'pro', 'pro'])
  expect(v.safeParse(configSchema, { ...base, claudePoolEntrypoints: ['sdk-ts'] }).success).toBe(
    false,
  )
  expect(v.safeParse(configSchema, { ...base, claudePoolEntrypoints: undefined }).success).toBe(
    false,
  )
  expect(
    v.safeParse(configSchema, {
      ...base,
      claudeProxy: { proxyConfig: 'claude.yaml', proxyPort: 18319, apiKey: 'key' },
    }).success,
  ).toBe(false)
  expect(
    v.safeParse(configSchema, { ...base, usageFeed: { ...base.usageFeed, intervalMs: 1000 } })
      .success,
  ).toBe(false)
})

test('GPT and historical pool responses never enter the direct Claude observer', async () => {
  const observer = vi.fn()
  const urls: string[] = []
  const fetcher = async (input: string | URL | Request) => {
    urls.push(String(input))
    if (new URL(String(input)).pathname === '/v1/models')
      return Response.json({ data: [{ id: 'gpt-6.1-sol' }] })
    return new Response('unchanged', {
      headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.5' },
    })
  }
  const gateway = createGateway({
    gatewayPort: 18318,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: 'http://127.0.0.1:18317',
    apiKey: 'codex-key',
    fetcher,
    observeClaudeHeaders: observer,
  })
  const pooled = new Request('http://127.0.0.1:18318/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:18318',
      authorization: 'Bearer owner',
      'user-agent': 'claude-cli/2.1.285 (external, cli)',
      'x-app': 'cli',
      'anthropic-beta': 'claude-code-20250219',
    },
    body: '{"model":"claude-test"}',
  })
  expect(await (await gateway(pooled)).text()).toBe('unchanged')
  const gpt = new Request('http://127.0.0.1:18318/v1/messages', {
    method: 'POST',
    headers: { host: '127.0.0.1:18318', authorization: 'Bearer owner' },
    body: '{"model":"gpt-6.1-sol"}',
  })
  expect(await (await gateway(gpt)).text()).toBe('unchanged')
  expect(urls).toEqual([
    'http://127.0.0.1:18317/v1/messages/count_tokens',
    'http://127.0.0.1:18317/v1/models',
    'http://127.0.0.1:18317/v1/messages',
  ])
  expect(observer).not.toHaveBeenCalled()
})

test('header observation leaves an open SSE stream incremental and cancelable', async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array>
  let canceled = false
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller
        controller.enqueue(new TextEncoder().encode('first\n'))
      },
      cancel() {
        canceled = true
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
        'anthropic-ratelimit-unified-5h-utilization': '0.2',
      },
    },
  )
  const observer = vi.fn((headers: Headers) => headers.set('x-request-id', 'observer-mutation'))
  const gateway = createGateway({
    gatewayPort: 18318,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: 'http://127.0.0.1:18317',
    apiKey: 'codex-key',
    claudePoolEntrypoints: [],
    fetcher: async () => response,
    observeClaudeHeaders: observer,
  })
  const output = await gateway(request())
  expect(observer).toHaveBeenCalledTimes(1)
  expect(output.headers.has('x-request-id')).toBe(false)
  const reader = output.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('first\n')
  upstream!.enqueue(new TextEncoder().encode('second\n'))
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('second\n')
  await reader.cancel()
  expect(canceled).toBe(true)
})
