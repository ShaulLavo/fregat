import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { orchestrationCommandSchema, sessionIdSchema, type PushDevices } from '@workspace/contracts'
import { expect } from 'vitest'
import { orchestrationForApp, type App } from '../../src/app'
import type { MetadataDatabaseHandle } from '../../src/db/client'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { testSettingsOptions } from '../../src/settings/testing'
import { createTestApp } from '../server'
import { createPushSubscriber, type PushSubscriber } from './push-subscriber'

export const PUSH_SESSION_ORIGIN = 'http://localhost:5173'
export const PUSH_SESSION_ID = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde')
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-one'
const MODEL = { providerInstanceId: 'codex', model: 'mock-model' }

type Pushed = { readonly url: string; readonly body: Uint8Array }

/**
 * The real app with a mock provider, one push device and a push service stand-in:
 * `runTurn` completes a real turn, and `pushed` holds what reached the push service.
 */
export async function createPushSessionFixture(options: {
  readonly root: string
  readonly pushNotifications: boolean
  readonly answer?: number
  readonly database?: MetadataDatabaseHandle
}) {
  const root = options.root
  const checkout = path.join(root, 'checkout')
  await mkdir(checkout, { recursive: true })
  await mkdir(path.join(root, '.platform-test'), { recursive: true })
  await writeFile(
    path.join(root, '.platform-test', 'settings.json'),
    JSON.stringify({ 'chat.pushNotifications': options.pushNotifications }),
  )
  const pushed: Pushed[] = []
  const adapter = new MockProviderAdapter()
  const database = options.database
  const app = createTestApp({
    auth: { allowedOrigins: [PUSH_SESSION_ORIGIN] },
    push: {
      fetcher: async (url, init) => {
        pushed.push({ url, body: new Uint8Array(await new Request(url, init).arrayBuffer()) })
        return new Response(null, { status: options.answer ?? 201 })
      },
    },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
    ...(database ? { metadataDatabase: database } : {}),
    orchestration: {
      ...(database ? { database: database.db } : {}),
      attachmentsDir: path.join(root, 'attachments'),
      providerRuntime: true,
      providerAdapterRegistry: new ProviderAdapterRegistry([adapter]),
    },
  })
  const engine = orchestrationForApp(app)
  await engine.ready
  const environmentId = (await (await get(app, '/health')).json()).environmentId as string
  const command = (input: unknown) => engine.dispatch(v.parse(orchestrationCommandSchema, input))

  return {
    app,
    root,
    pushed,
    environmentId,
    get: (pathname: string) => get(app, pathname),
    devices: async (): Promise<PushDevices> => (await get(app, '/push/devices')).json(),
    async register(): Promise<PushSubscriber> {
      const subscriber = createPushSubscriber(ENDPOINT)
      const response = await app.handle(
        request('/push/devices', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'Chrome on Linux', subscription: subscriber.subscription }),
        }),
      )
      expect(response.status).toBe(200)
      return subscriber
    },
    async createSession() {
      const registration = await engine.dispatchClientCommand({
        type: 'project.create',
        commandId: 'register-checkout',
        workspaceRoot: checkout,
        title: 'Fixture',
        defaultModelSelection: MODEL,
      })
      const worktreeId = registration.result?.worktreeId
      if (!worktreeId) return expect.unreachable('the checkout registered no worktree')
      await command({
        type: 'session.create',
        commandId: 'create-session',
        sessionId: PUSH_SESSION_ID,
        worktreeTarget: { kind: 'current', worktreeId },
        title: 'Fixture session',
        modelSelection: MODEL,
      })
      // A session is baselined on first sight; the mock turn would otherwise land in the same window.
      await Bun.sleep(150)
    },
    async runTurn(turnId: string) {
      await command({
        type: 'session.turn.start',
        commandId: `start-${turnId}`,
        sessionId: PUSH_SESSION_ID,
        turnId,
        message: { messageId: `message-${turnId}`, role: 'user', text: 'Hello', attachments: [] },
      })
      await expect
        .poll(async () => {
          const shell = await engine.shellSnapshot()
          const turn = shell.sessions.find((session) => session.id === PUSH_SESSION_ID)?.latestTurn
          return turn?.turnId === turnId ? turn.state : null
        })
        .toBe('completed')
    },
    async setPush(enabled: boolean) {
      const response = await app.handle(
        request('/settings/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mutationId: `push-${enabled}`,
            operations: [{ key: 'chat.pushNotifications', kind: 'set', value: enabled }],
            target: 'user',
          }),
        }),
      )
      expect(response.status).toBe(200)
    },
    /** Long enough for a coalesced shell window and a detached delivery to land. */
    async settle() {
      await engine.providerRuntimeIdle()
      await Bun.sleep(250)
    },
  }
}

function get(app: App, pathname: string) {
  return app.handle(request(pathname, { method: 'GET' }))
}

function request(pathname: string, init: RequestInit) {
  const headers = new Headers(init.headers)
  headers.set('origin', PUSH_SESSION_ORIGIN)
  return new Request(`http://localhost${pathname}`, { ...init, headers })
}
