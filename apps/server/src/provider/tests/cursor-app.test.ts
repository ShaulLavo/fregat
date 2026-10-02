import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFsLogs } from 'evlog/fs'
import { afterEach, expect, test, vi } from 'vitest'
import * as v from 'valibot'
import { approvalRequestIdSchema, sessionIdSchema } from '@workspace/contracts'
import { createAcpAppFixture } from '../../../test/factories/acp-app'
import { closeTestApps, createTestApp } from '../../../test/server'
import { createAcpExecutableFixture } from '../../../test/factories/acp'
import { orchestrationForApp } from '../../app'
import { DEFAULT_PROVIDER_INSTANCES } from '../drivers/built-in'
import { testSettingsOptions } from '../../settings/testing'
import { runGit } from '../../testing/git'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { cursorDriver } from '../drivers/cursor'

const fixtures: Awaited<ReturnType<typeof createAcpAppFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
  await resetObservabilityForTests()
  vi.unstubAllEnvs()
})

test('real app routes settle Cursor answers and advertised permission decisions in the read model', async () => {
  const fixture = await createAcpAppFixture(cursorDriver)
  fixtures.push(fixture)
  const sessionId = fixture.input.sessionId
  const created = await fixture.command({
    type: 'session.create',
    commandId: 'cursor-app-session',
    sessionId,
    title: 'Cursor app acceptance',
    worktreeTarget: { kind: 'current', worktreeId: fixture.registration.worktreeId },
    modelSelection: fixture.input.modelSelection,
    runtimeMode: 'approval-required',
  })
  expect(created.status, await created.clone().text()).toBe(200)
  const answer = await fixture.command({
    type: 'session.turn.start',
    runtimeMode: 'approval-required',
    commandId: 'cursor-app-answer',
    sessionId,
    turnId: 'cursor-app-answer-turn',
    message: {
      messageId: 'cursor-app-answer-message',
      role: 'user',
      text: 'hello',
      attachments: [],
    },
  })
  expect(answer.status, await answer.clone().text()).toBe(200)
  await expect
    .poll(async () => {
      const snapshot = await fixture.engine.sessionDetailSnapshot(sessionId)
      return snapshot.session.latestTurn?.state
    })
    .toBe('completed')
  const answered = await fixture.engine.sessionDetailSnapshot(sessionId)
  expect(answered.session.messages).toContainEqual(
    expect.objectContaining({
      role: 'assistant',
      text: expect.stringContaining('fixture:hello:'),
      turnId: 'cursor-app-answer-turn',
    }),
  )
  const permission = await fixture.command({
    type: 'session.turn.start',
    runtimeMode: 'approval-required',
    commandId: 'cursor-app-permission',
    sessionId,
    turnId: 'cursor-app-permission-turn',
    message: {
      messageId: 'cursor-app-permission-message',
      role: 'user',
      text: 'permission',
      attachments: [],
    },
  })
  expect(permission.status, await permission.clone().text()).toBe(200)
  await expect
    .poll(async () =>
      (await fixture.records()).some(
        (entry) =>
          entry.method === 'session/prompt' && entry.params.prompt[0].text === 'permission',
      ),
    )
    .toBe(true)
  await expect
    .poll(async () => {
      const snapshot = await fixture.engine.sessionDetailSnapshot(sessionId)
      return snapshot.session.activities.find((activity) => activity.kind === 'approval.requested')
    })
    .toBeDefined()
  const awaiting = await fixture.engine.sessionDetailSnapshot(sessionId)
  const { requestId } = v.parse(
    v.object({ requestId: approvalRequestIdSchema }),
    awaiting.session.activities.find((activity) => activity.kind === 'approval.requested')?.payload,
  )
  const decision = await fixture.command({
    type: 'session.approval.respond',
    commandId: 'cursor-app-allow',
    sessionId,
    requestId,
    decision: 'accept',
  })
  expect(decision.status, await decision.clone().text()).toBe(200)
  await expect
    .poll(
      async () => (await fixture.engine.sessionDetailSnapshot(sessionId)).session.latestTurn?.state,
    )
    .toBe('completed')
  const records = await fixture.records()
  expect(records.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
  expect(records.filter((entry) => entry.id === 'permission-1')).toMatchObject([
    { result: { outcome: { outcome: 'selected', optionId: 'yes' } } },
  ])
})

test('production app composition uses its configured Cursor service without creating an unused registry', async () => {
  const executable = await createAcpExecutableFixture('cursor')
  try {
    vi.stubEnv('PLATFORM_HOME', path.join(executable.root, 'home'))
    vi.stubEnv('HOME', executable.root)
    vi.stubEnv('PLATFORM_AGENT_HARNESS', '')
    vi.stubEnv('FREGAT_ACP_FIXTURE_LOG', executable.log)
    const logs = path.join(executable.root, 'logs')
    initializeObservability({
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logs,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '100',
      NODE_ENV: 'production',
    })
    await runGit(executable.root, ['init', '-b', 'main'], { cwdMode: 'option' })
    await writeFile(path.join(executable.root, 'tracked.txt'), 'fixture\n')
    await runGit(executable.root, ['add', 'tracked.txt'], { cwdMode: 'option' })
    await runGit(executable.root, ['commit', '-m', 'fixture'], { cwdMode: 'option' })
    const settings = testSettingsOptions(executable.root)
    await mkdir(path.dirname(settings.userFilePath!), { recursive: true })
    await writeFile(
      settings.userFilePath!,
      JSON.stringify({
        'providers.instances': DEFAULT_PROVIDER_INSTANCES.map((instance) => ({
          ...instance,
          enabled: instance.driverKind === 'cursor',
          binaryPath:
            instance.driverKind === 'cursor'
              ? executable.binaryPath
              : path.join(executable.root, 'absent-fixture-cli'),
          config: {
            home: path.join(executable.root, 'codex'),
            configDir: path.join(executable.root, 'claude'),
          },
        })),
      }),
    )
    const app = createTestApp({
      workspaceRoot: executable.root,
      homeDirectory: executable.root,
      settings,
      watch: false,
      orchestration: { providerRuntime: true },
    })
    const request = (route: string, body?: unknown) =>
      app.handle(
        new Request(`http://local${route}`, {
          headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
          ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        }),
      )
    await expect
      .poll(async () => {
        const providers = await (await request('/providers')).json()
        return providers.providers.filter(
          (provider: { driverKind: string }) => provider.driverKind === 'cursor',
        )
      })
      .toMatchObject([{ providerInstanceId: 'cursor', status: 'ready', enabled: true }])
    const catalogueRecords = await executable.records()
    expect(
      catalogueRecords.filter((record) => record.method === 'cursor/list_available_models'),
    ).toHaveLength(1)
    expect(catalogueRecords.filter((record) => record.event === 'spawn')).toMatchObject([
      { profile: path.join(executable.root, 'home', 'providers', 'cursor', 'cursor') },
    ])
    const engine = orchestrationForApp(app)
    const registered = await engine.dispatchClientCommand({
      type: 'project.create',
      commandId: 'cursor-composition-project',
      title: 'Cursor composition',
      workspaceRoot: executable.root,
      defaultModelSelection: { providerInstanceId: 'cursor', model: 'auto' },
    })
    expect(registered.result).toBeTruthy()
    const sessionId = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde')
    expect(
      (
        await request('/orchestration/commands', {
          type: 'session.create',
          commandId: 'cursor-composition-session',
          sessionId,
          title: 'Cursor composition',
          worktreeTarget: { kind: 'current', worktreeId: registered.result!.worktreeId },
          modelSelection: { providerInstanceId: 'cursor', model: 'auto' },
          runtimeMode: 'approval-required',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request('/orchestration/commands', {
          type: 'session.turn.start',
          commandId: 'cursor-composition-turn',
          sessionId,
          turnId: 'cursor-composition-turn',
          runtimeMode: 'approval-required',
          message: {
            messageId: 'cursor-composition-message',
            role: 'user',
            text: 'hello',
            attachments: [],
          },
        })
      ).status,
    ).toBe(200)
    await expect
      .poll(async () => (await engine.sessionDetailSnapshot(sessionId)).session.latestTurn?.state)
      .toBe('completed')
    expect((await engine.sessionDetailSnapshot(sessionId)).session.messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        text: expect.stringContaining('fixture:hello:'),
      }),
    )
    const records = await executable.records()
    expect(records.filter((record) => record.method === 'session/new')).toHaveLength(1)
    expect(
      records.some(
        (record) => record.method === 'session/prompt' && record.params.prompt[0].text === 'hello',
      ),
    ).toBe(true)
    await flushObservability()
    const failures = []
    for await (const event of readFsLogs({ dir: logs })) {
      if (event.action === 'chat.pipeline.provider_registry.instance_failed') failures.push(event)
    }
    expect(
      failures.map((event) => ({
        provider: event.driverKind,
        code: (event.error as { code?: string })?.code,
      })),
    ).toEqual([])
    await closeTestApps()
    for (const record of (await executable.records()).filter((entry) => entry.event === 'spawn')) {
      expect(() => process.kill(record.pid, 0)).toThrow()
    }
  } finally {
    await closeTestApps()
    await executable.dispose()
  }
})
