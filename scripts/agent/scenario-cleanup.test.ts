import { expect, test } from 'vitest'
import { request } from 'playwright'
import { captureScenarioApi, cleanupAll } from './scenario-cleanup'
import { dispatch } from './scenarios/chat-verification'
import { existsSync } from 'node:fs'
import { startIsolatedServer } from './isolated-server'
import { installNativeProvider, settingsSnapshot } from './scenarios/native-provider-verification'

test('captured API transport retains its authenticated origin after page navigation', async () => {
  const origins: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      origins.push(req.headers.get('origin') ?? '')
      return Response.json({ ok: true })
    },
  })
  const transport = await request.newContext()
  let url = 'http://localhost:5251/chat'
  try {
    const api = captureScenarioApi({ request: transport, url: () => url })
    url = 'about:blank'
    await dispatch(api, `http://localhost:${server.port}/orchestration`, {
      type: 'session.delete',
      sessionId: 'owned-session',
    })
    expect(origins).toEqual(['http://localhost:5251'])
  } finally {
    await transport.dispose()
    server.stop(true)
  }
})

test('cleanup attempts every owned resource before reporting failures', async () => {
  const attempted: string[] = []
  const firstFailure = new TypeError('first shell refused cleanup')
  const secondFailure = new TypeError('session stop refused cleanup')
  await expect(
    cleanupAll([
      async () => {
        attempted.push('first shell')
        throw firstFailure
      },
      async () => {
        attempted.push('second shell')
      },
      async () => {
        attempted.push('session stop')
        throw secondFailure
      },
      async () => {
        attempted.push('session delete')
      },
      async () => {
        attempted.push('provider')
      },
      async () => {
        attempted.push('project')
      },
      async () => {
        attempted.push('fixture')
      },
    ]),
  ).rejects.toMatchObject({ errors: [firstFailure, secondFailure] })
  expect(attempted).toEqual([
    'first shell',
    'second shell',
    'session stop',
    'session delete',
    'provider',
    'project',
    'fixture',
  ])
})

test('native provider removal uses the captured origin after the page leaves the app', async () => {
  const server = await startIsolatedServer(new URL('http://localhost:5251'))
  const transport = await request.newContext()
  let url = 'http://localhost:5251/chat'
  const page = { request: transport, url: () => url }
  const api = captureScenarioApi(page)
  try {
    const native = await installNativeProvider(page, server.origin, {
      name: 'cleanup-origin',
      displayLabel: 'Cleanup fixture',
      fixture: new URL('./fixtures/native-conversation.mjs', import.meta.url),
    })
    url = 'about:blank'
    await native.remove()
    expect(existsSync(native.root)).toBe(false)
    const settings = await settingsSnapshot(api, server.origin)
    expect(
      settings.values['providers.instances'].some(
        (provider) => provider.providerInstanceId === native.providerInstanceId,
      ),
    ).toBe(false)
  } finally {
    await transport.dispose()
    await server.stop()
  }
}, 40_000)
