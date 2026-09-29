import { expect, test } from 'vitest'
import { createGateway } from './gateway'

test('preserves Claude OAuth, beta headers, request bytes and streaming tool events', async () => {
  const body = '{ "model": "claude-opus-5-5", "stream": true, "messages": [] }'
  const events =
    'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"Read","input":{}}}\n\n'
  let observed: { authorization: string | null; beta: string | null; body: string } | undefined
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      observed = {
        authorization: request.headers.get('authorization'),
        beta: request.headers.get('anthropic-beta'),
        body: await request.text(),
      }
      return new Response(events, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const gateway = createGateway({
    anthropicUrl: upstream.url.toString(),
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'proxy-key',
    syncCredentials: async () => {
      expect.unreachable('Claude requests must stay with Anthropic')
    },
  })
  try {
    const response = await gateway(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        body,
        headers: { authorization: 'Bearer claude-oauth', 'anthropic-beta': 'oauth-2025-04-20' },
      }),
    )
    expect(observed).toEqual({
      authorization: 'Bearer claude-oauth',
      beta: 'oauth-2025-04-20',
      body,
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe(events)
  } finally {
    upstream.stop(true)
  }
})

test('GPT count_tokens reaches the translator with proxy auth and no Claude credentials', async () => {
  let observed:
    | { auth: string | null; apiKey: string | null; cookie: string | null; path: string }
    | undefined
  let synced = false
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      observed = {
        auth: request.headers.get('authorization'),
        apiKey: request.headers.get('x-api-key'),
        cookie: request.headers.get('cookie'),
        path: new URL(request.url).pathname,
      }
      return Response.json({ input_tokens: 12 })
    },
  })
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
    syncCredentials: async () => {
      synced = true
    },
  })
  try {
    const response = await gateway(
      new Request('http://localhost/v1/messages/count_tokens', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-6.1-sol', messages: [] }),
        headers: {
          authorization: 'Bearer claude-oauth',
          'x-api-key': 'claude-key',
          cookie: 'claude-session=secret',
        },
      }),
    )
    expect(synced).toBe(true)
    expect(observed).toEqual({
      auth: 'Bearer proxy-key',
      apiKey: null,
      cookie: null,
      path: '/v1/messages/count_tokens',
    })
    expect(await response.json()).toEqual({ input_tokens: 12 })
  } finally {
    upstream.stop(true)
  }
})

test('rejects management paths, missing auth, malformed JSON and unsupported models', async () => {
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'proxy-key',
    syncCredentials: async () => {
      expect.unreachable('Invalid requests must stop before credential reads')
    },
  })
  expect((await gateway(new Request('http://localhost/v8/management'))).status).toBe(404)
  expect(
    (await gateway(new Request('http://localhost/v1/messages', { method: 'POST' }))).status,
  ).toBe(401)
  const headers = { authorization: 'Bearer test' }
  expect(
    (
      await gateway(
        new Request('http://localhost/v1/messages', { method: 'POST', headers, body: '{' }),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await gateway(
        new Request('http://localhost/v1/messages', {
          method: 'POST',
          headers,
          body: '{"model":"other"}',
        }),
      )
    ).status,
  ).toBe(400)
})
