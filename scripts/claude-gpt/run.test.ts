import { expect, test } from 'vitest'
import * as v from 'valibot'
import { createGateway, type GatewayOptions } from './gateway'
import { configSchema, startGateway } from './run'

const config = {
  binary: 'fixture-proxy',
  proxyConfig: 'fixture.yaml',
  proxyPort: 18317,
  gatewayPort: 18318,
  apiKey: 'fixture-key',
  claudePoolEntrypoints: [],
}

test.each([{}, { usageFeed: { managementKeyFile: 'fixture-key-file' } }])(
  'startup always rejects Claude pooling with extra configuration %j',
  (extra) => {
    expect(v.safeParse(configSchema, { ...config, ...extra }).success).toBe(true)
    expect(
      v.safeParse(configSchema, {
        ...config,
        ...extra,
        claudePoolEntrypoints: ['cli'],
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(configSchema, {
        ...config,
        ...extra,
        claudeProxy: { proxyConfig: 'fixture.yaml', proxyPort: 18319, apiKey: 'fixture-key' },
      }).success,
    ).toBe(false)
  },
)

test('retired usageFeed configuration is stripped without validating or opening its values', () => {
  for (const usageFeed of [
    null,
    {},
    { managementKeyFile: 'fixture-unread', accounts: 'retired' },
  ]) {
    const parsed = v.parse(configSchema, { ...config, usageFeed })
    expect(parsed).not.toHaveProperty('usageFeed')
  }
})

test('omitted entrypoints default to direct Claude traffic', () => {
  const { claudePoolEntrypoints: _, ...withoutEntrypoints } = config
  expect(v.parse(configSchema, withoutEntrypoints).claudePoolEntrypoints).toEqual([])
})

const constructorNames = ['createGateway', 'startGateway'] as const
const nativeHeaders = {
  host: 'localhost:8318',
  authorization: 'Bearer fixture-caller-login',
  'content-type': 'application/json',
  'x-app': 'cli',
  'anthropic-beta': 'claude-code-20250219',
}

function constructorOptions(fetcher: GatewayOptions['fetcher']): GatewayOptions {
  return {
    gatewayPort: 0,
    anthropicUrl: 'http://fixture-anthropic.invalid',
    proxyUrl: 'http://fixture-proxy.invalid',
    apiKey: 'fixture-proxy-key',
    fetcher,
  }
}

test.each(constructorNames)('%s rejects every forbidden pool option before fetching', (name) => {
  const seen: string[] = []
  const options = constructorOptions(async (url) => {
    seen.push(String(url))
    return Response.json({ fixture: true })
  })
  for (const forbidden of [
    { claudePoolEntrypoints: ['cli'] },
    { claudePoolEntrypoints: ['sdk-ts'] },
    { claudeProxy: { proxyUrl: 'http://fixture-claude.invalid', apiKey: 'fixture-key' } },
    { claudeProxy: null },
  ]) {
    let server: ReturnType<typeof startGateway> | undefined
    try {
      expect(() => {
        if (name === 'createGateway') return createGateway({ ...options, ...forbidden })
        server = startGateway({ ...options, ...forbidden })
      }).toThrow()
      expect(seen).toEqual([])
    } finally {
      server?.stop(true)
    }
  }
})

test('startGateway rejects forbidden options before attempting to bind an occupied port', () => {
  const reservation = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('fixture reservation'),
  })
  try {
    const forbidden = {
      ...constructorOptions(async () => Response.json({ fixture: true })),
      gatewayPort: reservation.port!,
      claudePoolEntrypoints: ['cli'],
    }
    expect(() => startGateway(forbidden)).toThrow('Claude traffic requires empty pool entrypoints.')
  } finally {
    reservation.stop(true)
  }
})

type ObservedRequest = { url: string; headers: Headers; body: string }

async function checkDirectEntrypoints(
  handle: (path: string, init: RequestInit) => Promise<Response>,
  seen: readonly ObservedRequest[],
) {
  for (const entrypoint of ['cli', 'sdk-cli', 'claude-vscode', 'sdk-ts']) {
    for (const path of ['/v1/messages', '/v1/messages/count_tokens']) {
      const body = JSON.stringify({
        model: 'claude-fixture',
        metadata: {
          user_id: JSON.stringify({
            device_id: 'a'.repeat(64),
            session_id: '0b4a2f1e-1a7b-4c43-9d8e-2a3b4c5d6e7f',
          }),
        },
        messages: [],
      })
      const headers = {
        ...nativeHeaders,
        'user-agent': `claude-cli/2.1.285 (external, ${entrypoint})`,
      }
      const response = await handle(path, { method: 'POST', headers, body })
      expect(await response.json()).toEqual({ direct: true })
      const observed = seen.at(-1)!
      expect(observed.url).toBe(`http://fixture-anthropic.invalid${path}`)
      expect(observed.headers.get('authorization')).toBe('Bearer fixture-caller-login')
      expect(observed.headers.get('user-agent')).toBe(headers['user-agent'])
      expect(observed.body).toBe(body)
    }
  }
  expect(seen).toHaveLength(8)
}

test.each(constructorNames)(
  '%s keeps all Claude entrypoints direct with omitted or empty pool options',
  async (name) => {
    for (const extra of [{}, { claudePoolEntrypoints: [] }]) {
      const seen: ObservedRequest[] = []
      const options = {
        ...constructorOptions(async (url, init) => {
          seen.push({
            url: String(url),
            headers: new Headers(init?.headers),
            body: String(init?.body),
          })
          return Response.json({ direct: true })
        }),
        ...extra,
      }
      if (name === 'createGateway') {
        const handler = createGateway(options)
        await checkDirectEntrypoints(
          (path, init) => handler(new Request(`http://localhost:8318${path}`, init)),
          seen,
        )
        continue
      }
      const server = startGateway(options)
      try {
        await checkDirectEntrypoints((path, init) => fetch(new URL(path, server.url), init), seen)
      } finally {
        server.stop(true)
      }
    }
  },
)
