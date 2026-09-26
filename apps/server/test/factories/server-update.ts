import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { orchestrationCommandSchema, serverRestartResultSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { onTestFinished } from 'vitest'

import { closeApp, orchestrationForApp } from '../../src/app'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { testSettingsOptions } from '../../src/settings/testing'
import type { RestartRecord } from '../../src/update/service'
import { createTestApp, createTestDatabase } from '../server'

const origin = 'http://localhost:5173'
const model = { providerInstanceId: 'codex', model: 'gpt-5-codex' }

/** `<root>/pending` → `<root>/releases/<name>`, the way `deploy --server` stages it. */
export async function stageRelease(root: string, name: string) {
  const release = path.join(root, 'releases', name)
  await mkdir(release, { recursive: true })
  await rm(path.join(root, 'pending'), { force: true })
  await symlink(release, path.join(root, 'pending'))
  return release
}

/** Holds every turn inside the provider until `finish()`; `started(n)` waits for the nth. */
export function heldTurnAdapter() {
  const finished = Promise.withResolvers<void>()
  const waiters: Array<{ count: number; resolve: () => void }> = []
  let turns = 0
  const adapter = new MockProviderAdapter({
    beforeComplete: async () => {
      turns += 1
      for (const waiter of waiters) if (turns >= waiter.count) waiter.resolve()
      await finished.promise
    },
  })
  return {
    adapter,
    finish: () => finished.resolve(),
    started(count = 1) {
      const waiter = Promise.withResolvers<void>()
      if (turns >= count) waiter.resolve()
      waiters.push({ count, resolve: waiter.resolve })
      return waiter.promise
    },
  }
}

export async function restartFixture(
  adapter: MockProviderAdapter,
  options: { staged?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-server-update-'))
  onTestFinished(() => rm(root, { force: true, recursive: true }))
  const production = path.join(root, 'production')
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  if (options.staged !== false) await stageRelease(production, 'staged-release')
  const database = createTestDatabase()
  const exits: RestartRecord[] = []
  const open = (next: MockProviderAdapter) =>
    createTestApp({
      auth: { allowedOrigins: [origin] },
      metadataDatabase: database,
      orchestration: {
        database: database.db,
        providerAdapterRegistry: new ProviderAdapterRegistry([next]),
        providerRuntime: true,
      },
      settings: testSettingsOptions(root),
      update: { root: production, restart: (record) => exits.push(record) },
      watch: false,
      workspaceRoot: workspace,
    })
  let app = open(adapter)
  let nextCommand = 0
  const dispatch = (command: Record<string, unknown>) =>
    orchestrationForApp(app).dispatchClientCommand({
      commandId: `server-update-${++nextCommand}`,
      ...command,
    })

  return {
    exits,
    production,
    get app() {
      return app
    },
    get engine() {
      return orchestrationForApp(app)
    },
    async register() {
      const receipt = await dispatch({
        type: 'project.create',
        title: 'Platform',
        workspaceRoot: workspace,
      })
      if (!receipt.result || !('worktreeId' in receipt.result))
        throw new TypeError('Project registration returned no worktree')
      return receipt.result.worktreeId
    },
    createSession: (worktreeId: string, sessionId: string, title: string) =>
      dispatch({
        type: 'session.create',
        sessionId,
        worktreeTarget: { kind: 'current', worktreeId },
        title,
        modelSelection: model,
        interactionMode: 'default',
        runtimeMode: 'full-access',
        createdAt: new Date().toISOString(),
      }),
    send: (sessionId: string, turnId: string) =>
      dispatch({
        type: 'session.turn.start',
        sessionId,
        turnId,
        message: { messageId: `message-${turnId}`, role: 'user', text: 'Hello' },
        interactionMode: 'default',
        runtimeMode: 'full-access',
        createdAt: new Date().toISOString(),
      }),
    // An approval the provider opened and nobody answered yet.
    openApproval(sessionId: string, requestId: string) {
      const createdAt = new Date().toISOString()
      return orchestrationForApp(app).dispatch(
        v.parse(orchestrationCommandSchema, {
          type: 'session.activity.append',
          commandId: `server-update-${++nextCommand}`,
          sessionId,
          createdAt,
          activity: {
            id: `approval-${requestId}`,
            sessionId,
            createdAt,
            turnId: null,
            tone: 'info',
            kind: 'approval.requested',
            summary: 'approval.requested',
            payload: { requestId },
          },
        }),
      )
    },
    /** `from: null` sends no Origin header, the way a non-browser client would. */
    async restart(interrupt: readonly string[], from: string | null = origin) {
      const headers = new Headers({ 'content-type': 'application/json' })
      if (from !== null) headers.set('origin', from)
      const response = await app.handle(
        new Request('http://local/server/restart', {
          body: JSON.stringify({ interrupt }),
          headers,
          method: 'POST',
        }),
      )
      const body: unknown = await response.json()
      if (response.status !== 200) return { status: response.status, body, result: null }
      return { status: response.status, body, result: v.parse(serverRestartResultSchema, body) }
    },
    async latestTurn(sessionId: string) {
      const model = await orchestrationForApp(app).readModelSnapshot()
      return model.sessions.get(sessionId)?.latestTurn ?? null
    },
    /** closeApp, then promote `pending` the way ExecStartPre does, then boot over the same database. */
    async reopen(next: MockProviderAdapter) {
      await closeApp(app)
      await rm(path.join(production, 'pending'), { force: true })
      app = open(next)
      await orchestrationForApp(app).ready
      await orchestrationForApp(app).providerRuntimeIdle()
      return app
    },
  }
}
