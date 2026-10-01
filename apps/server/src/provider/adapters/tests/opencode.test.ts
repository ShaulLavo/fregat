import { access, readFile, rename } from 'node:fs/promises'
import * as v from 'valibot'
import { providerInstanceIdSchema, sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../../test/server'
import { openCodeAppFixture } from '../../../../test/factories/opencode'
import { startOpenCodeHttpFixture } from '../../../../test/factories/opencode-http'
import { openCodeProcessFixture } from '../../../../test/factories/opencode-process'
import { OPENCODE_DRIVER_KIND, OpenCodeProviderAdapter } from '../opencode'
import { opencodeDriver } from '../../drivers/opencode'
import { OpenCodeHttp } from '../utils/opencode-http'
import { ProviderAdapterRegistry } from '../../provider-adapter-registry'
import { ProviderStatusCache } from '../../status-cache'
import type { ProviderRuntimeEvent, ProviderTurnInput } from '../../types'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await closeTestApps()
})
const instanceId = v.parse(providerInstanceIdSchema, 'opencode-fixture')
const sessionId = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde')
const turnId = v.parse(turnIdSchema, 'turn-opencode')
const input: ProviderTurnInput = {
  attachments: [],
  cwd: '/work/fixture',
  interactionMode: 'default',
  messageText: 'Hello',
  modelSelection: { providerInstanceId: instanceId, model: 'fixture/text' },
  sessionId,
  runtimeEpoch: 'epoch-fixture',
  providerInstanceId: instanceId,
  runtimeMode: 'approval-required',
  turnId,
}

function setup(options?: Parameters<typeof startOpenCodeHttpFixture>[0]) {
  const http = startOpenCodeHttpFixture(options)
  const adapter = new OpenCodeProviderAdapter({
    serverUrl: http.url,
    env: {},
    displayLabel: 'Fixture OpenCode',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(
    () => http.close(),
    () => adapter.stopAll(),
  )
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  return { http, adapter, events }
}

test('update advice returns a structured missing-instance response after removal', async () => {
  const fixture = await openCodeAppFixture()
  cleanup.push(fixture.close)
  const url = `http://localhost/providers/${fixture.instanceId}/update`
  const before = await fixture.app.handle(
    new Request(url, { headers: { origin: 'http://localhost:5173' } }),
  )
  expect(before.status).toBe(200)

  await fixture.registry.reconcile([])
  const after = await fixture.app.handle(
    new Request(url, { headers: { origin: 'http://localhost:5173' } }),
  )

  expect(after.status).toBe(404)
  expect(await after.json()).toMatchObject({ error: { code: 'provider.INSTANCE_NOT_FOUND' } })
})

test('enabled initialization discovers native models before a turn using one owned catalog process', async () => {
  const fixture = await openCodeProcessFixture({ wrapper: 'alive' })
  const registry = new ProviderAdapterRegistry({
    drivers: [opencodeDriver],
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, () => registry.dispose())
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      binaryPath: fixture.binaryPath,
      config: { dataHome: `${fixture.root}/profile` },
    },
  ])
  expect(await registry.snapshot(instanceId)).toMatchObject({
    status: 'ready',
    auth: { status: 'unknown' },
    models: [{ slug: 'fixture/text' }],
  })
  const cached = await registry.snapshot(instanceId)
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(calls.filter((call) => call.args)).toHaveLength(1)
  expect(calls.find((call) => call.args)).toMatchObject({
    cwd: fixture.root,
    dataHome: `${fixture.root}/profile`,
  })
  const { url, pid } = calls.find((call) => call.url)
  await fetch(`${url}/fixture/model-name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Refreshed native model' }),
  })
  expect(await registry.snapshot(instanceId)).toBe(cached)
  expect(await registry.refreshSnapshot(instanceId)).toMatchObject({
    models: [{ name: 'Refreshed native model' }],
  })
  await registry.refreshSnapshot(instanceId)
  const refreshedCalls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(refreshedCalls.filter((call) => call.args)).toHaveLength(1)
  const requests = await (await fetch(`${url}/fixture/requests`)).json()
  expect(requests.filter((request: { path: string }) => request.path === '/provider')).toHaveLength(
    3,
  )
  expect(
    requests
      .filter((request: { path: string }) => !request.path.startsWith('/fixture/'))
      .every((request: { directory: string }) => request.directory === fixture.root),
  ).toBe(true)
  expect(
    requests.some(
      (request: { path: string }) => request.path === '/session' || request.path === '/event',
    ),
  ).toBe(false)
  await registry.dispose()
  await expect
    .poll(async () =>
      (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).includes(fixture.root),
    )
    .toBe(false)
})

test.each([false, true])(
  'live enable settles native models with persisted status %s',
  async (persisted) => {
    const fixture = await openCodeProcessFixture()
    const registry = new ProviderAdapterRegistry({
      drivers: [opencodeDriver],
      services: { cwd: fixture.root },
      statusCache: new ProviderStatusCache({
        directory: persisted ? `${fixture.root}/status-cache` : undefined,
      }),
    })
    cleanup.push(fixture.close, () => registry.dispose())
    const entry = {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      binaryPath: fixture.binaryPath,
      config: { dataHome: `${fixture.root}/profile` },
    }
    await registry.reconcile([{ ...entry, enabled: false }])
    expect(await registry.snapshot(instanceId)).toMatchObject({ status: 'disabled', models: [] })

    await registry.reconcile([{ ...entry, enabled: true }])

    expect((await registry.listProviders()).providers).toContainEqual(
      expect.objectContaining({
        status: 'ready',
        models: [expect.objectContaining({ slug: 'fixture/text' })],
      }),
    )
  },
)

test('enabled local instances initialize independent native catalogs and storage profiles', async () => {
  const first = await openCodeProcessFixture({ modelName: 'First profile model' })
  const second = await openCodeProcessFixture({ modelName: 'Second profile model' })
  const registry = new ProviderAdapterRegistry({
    drivers: [opencodeDriver],
    services: { cwd: first.root },
  })
  cleanup.push(first.close, second.close, () => registry.dispose())
  const otherId = v.parse(providerInstanceIdSchema, 'opencode-catalog-second')
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      binaryPath: first.binaryPath,
      config: { dataHome: first.root },
    },
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: otherId,
      binaryPath: second.binaryPath,
      config: { dataHome: second.root },
    },
  ])
  expect(await registry.snapshot(instanceId)).toMatchObject({
    models: [{ name: 'First profile model' }],
  })
  expect(await registry.snapshot(otherId)).toMatchObject({
    models: [{ name: 'Second profile model' }],
  })
  const firstCalls = (await readFile(first.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const secondCalls = (await readFile(second.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(firstCalls.find((call) => call.args).dataHome).toBe(first.root)
  expect(secondCalls.find((call) => call.args).dataHome).toBe(second.root)
  expect(firstCalls.find((call) => call.url).url).not.toBe(secondCalls.find((call) => call.url).url)
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: otherId,
      binaryPath: second.binaryPath,
      config: { dataHome: second.root },
    },
  ])
  expect(await registry.refreshSnapshot(otherId)).toMatchObject({
    status: 'ready',
    models: [{ name: 'Second profile model' }],
  })
})

test('disabled initialization never starts a native catalog executable', async () => {
  const fixture = await openCodeProcessFixture()
  const handle = await opencodeDriver.create({
    binaryPath: fixture.binaryPath,
    config: {},
    env: {},
    displayLabel: 'Disabled fixture',
    enabled: false,
    providerInstanceId: instanceId,
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, handle.dispose)
  expect(await handle.adapter.snapshot()).toMatchObject({ status: 'disabled', models: [] })
  await handle.dispose()
  await expect(access(fixture.marker)).rejects.toBeDefined()
})

test('failed catalog initialization reports a missing executable without a ready catalog', async () => {
  const fixture = await openCodeProcessFixture()
  const handle = await opencodeDriver.create({
    binaryPath: `${fixture.root}/missing`,
    config: {},
    env: {},
    displayLabel: 'Missing fixture',
    enabled: true,
    providerInstanceId: instanceId,
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, handle.dispose)
  expect(await handle.adapter.snapshot()).toMatchObject({
    installed: false,
    status: 'error',
    models: [],
    auth: { status: 'unknown' },
  })
  await expect(access(fixture.marker)).rejects.toBeDefined()
})

test('catalog refresh recovers after installing the missing executable', async () => {
  const fixture = await openCodeProcessFixture()
  const binaryPath = `${fixture.root}/installed-later`
  const registry = new ProviderAdapterRegistry({
    drivers: [opencodeDriver],
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, () => registry.dispose())
  await registry.reconcile([
    { driverKind: OPENCODE_DRIVER_KIND, providerInstanceId: instanceId, binaryPath, config: {} },
  ])
  expect(await registry.snapshot(instanceId)).toMatchObject({ installed: false, status: 'error' })
  await expect(access(fixture.marker)).rejects.toBeDefined()
  await rename(fixture.binaryPath, binaryPath)
  expect(await registry.refreshSnapshot(instanceId)).toMatchObject({
    installed: true,
    status: 'ready',
    models: [{ slug: 'fixture/text' }],
  })
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(calls.filter((call) => call.args)).toHaveLength(1)
})

test('catalog refresh recovers after the owned process exits with one replacement', async () => {
  const fixture = await openCodeProcessFixture({ wrapper: 'alive' })
  const registry = new ProviderAdapterRegistry({
    drivers: [opencodeDriver],
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, () => registry.dispose())
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      binaryPath: fixture.binaryPath,
      config: {},
    },
  ])
  expect(await registry.snapshot(instanceId)).toMatchObject({ status: 'ready' })
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const original = calls.find((call) => call.wrapperPid)
  process.kill(original.wrapperPid, 'SIGKILL')
  const ownedGroupCleanupGraceMs = 1_000
  const fixtureRespawnAllowanceMs = 1_000
  // OpenCodeServer.closeProcess waits out its group grace before fixture respawn can begin.
  const replacementLaunchTimeoutMs = ownedGroupCleanupGraceMs + fixtureRespawnAllowanceMs
  await expect
    .poll(
      async () => {
        await Promise.all([
          registry.refreshSnapshot(instanceId),
          registry.refreshSnapshot(instanceId),
        ])
        const launches = (await readFile(fixture.marker, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        return launches.filter((call) => call.args).length
      },
      { timeout: replacementLaunchTimeoutMs },
    )
    .toBe(2)
  const snapshots = await Promise.all([
    registry.refreshSnapshot(instanceId),
    registry.refreshSnapshot(instanceId),
  ])
  for (const snapshot of snapshots)
    expect(snapshot).toMatchObject({ status: 'ready', models: [{ slug: 'fixture/text' }] })
  const refreshedCalls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(refreshedCalls.filter((call) => call.args)).toHaveLength(2)
  await expect
    .poll(async () =>
      (await readFile(`/proc/${original.childPid}/cmdline`, 'utf8').catch(() => '')).includes(
        fixture.root,
      ),
    )
    .toBe(false)
})

test('catalog disposal cancels owned initialization and reaps the wrapper descendants', async () => {
  const fixture = await openCodeProcessFixture({ wrapper: 'alive', holdReadiness: true })
  const handle = await opencodeDriver.create({
    binaryPath: fixture.binaryPath,
    config: {},
    env: {},
    displayLabel: 'Starting fixture',
    enabled: true,
    providerInstanceId: instanceId,
    services: { cwd: fixture.root },
  })
  cleanup.push(fixture.close, handle.dispose)
  const snapshot = handle.adapter.snapshot()
  await expect
    .poll(async () => (await readFile(fixture.marker, 'utf8').catch(() => '')).includes('"url"'))
    .toBe(true)
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  await handle.dispose()
  expect(await snapshot).toMatchObject({ status: 'error' })
  for (const call of calls)
    for (const pid of [call.pid, call.wrapperPid, call.childPid]) {
      if (!pid) continue
      await expect
        .poll(async () =>
          (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).includes(fixture.root),
        )
        .toBe(false)
    }
})

test('catalog disposal cancels HTTP discovery while leaving an external server alive', async () => {
  const held = Promise.withResolvers<void>()
  const http = startOpenCodeHttpFixture({ beforeCatalogResponse: () => held.promise })
  const handle = await opencodeDriver.create({
    config: { serverUrl: http.url },
    env: {},
    displayLabel: 'External fixture',
    enabled: true,
    providerInstanceId: instanceId,
    services: { cwd: process.cwd() },
  })
  cleanup.push(
    () => http.close(),
    () => held.resolve(),
    handle.dispose,
  )
  const snapshot = handle.adapter.snapshot()
  await expect.poll(() => http.requests.some((request) => request.path === '/provider')).toBe(true)
  await handle.dispose()
  expect(await snapshot).toMatchObject({ status: 'error' })
  expect((await fetch(`${http.url}/global/health`)).ok).toBe(true)
  expect(http.requests.find((request) => request.path === '/provider')?.directory).toBe(
    process.cwd(),
  )
})

test('anonymous connected free models are usable without claiming account authentication', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/global/health')
        return Response.json({ healthy: true, version: 'anonymous-fixture' })
      return Response.json({
        connected: ['opencode'],
        all: [
          {
            id: 'opencode',
            source: 'custom',
            options: { apiKey: 'public' },
            models: { 'free-text': { name: 'Free text', cost: { input: 0, output: 0 } } },
          },
        ],
      })
    },
  })
  const adapter = new OpenCodeProviderAdapter({
    serverUrl: server.url.toString(),
    env: {},
    displayLabel: 'Anonymous OpenCode',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(
    () => server.stop(true),
    () => adapter.stopAll(),
  )

  expect(await adapter.snapshot()).toMatchObject({
    installed: true,
    status: 'ready',
    supportsSignIn: false,
    auth: { status: 'unknown' },
    models: [{ slug: 'opencode/free-text', name: 'Free text' }],
  })
})

test('SDKv2 fixture streams one answer, filters user/foreign events, and completes one turn', async () => {
  const { http, adapter, events } = setup()
  await adapter.sendTurn(input)
  const native = [...http.sessions.keys()][0]!
  http.emit('message.updated', { info: { sessionID: native, id: 'user', role: 'user' } })
  http.emit('message.part.delta', {
    sessionID: native,
    messageID: 'user',
    field: 'text',
    partID: 'user-part',
    delta: 'DO NOT ECHO',
  })
  http.emit('session.error', { sessionID: 'foreign', error: { message: 'foreign error' } })
  http.answer(native)
  http.complete(native)
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
  expect(
    events
      .filter((event) => event.type === 'content.delta')
      .map((event) => event.payload.delta)
      .join(''),
  ).toBe('Fixture answer')
  expect(events.find((event) => event.type === 'turn.completed')).toMatchObject({
    payload: { state: 'completed' },
    providerInstanceId: instanceId,
    runtimeEpoch: input.runtimeEpoch,
  })
  expect(http.requests.find((request) => request.path.endsWith('/prompt_async'))?.body).toEqual({
    model: { providerID: 'fixture', modelID: 'text' },
    parts: [{ type: 'text', text: 'Hello' }],
  })
})

test('reasoning deltas remain reasoning when the final part arrives', async () => {
  const { http, adapter, events } = setup()
  await adapter.sendTurn(input)
  const id = [...http.sessions.keys()][0]!
  http.emit('message.updated', { info: { sessionID: id, id: 'assistant', role: 'assistant' } })
  http.emit('message.part.updated', {
    part: { sessionID: id, messageID: 'assistant', id: 'reason', type: 'reasoning', text: '' },
  })
  http.emit('message.part.delta', {
    sessionID: id,
    messageID: 'assistant',
    partID: 'reason',
    field: 'text',
    delta: 'Thinking',
  })
  http.emit('message.part.updated', {
    part: {
      sessionID: id,
      messageID: 'assistant',
      id: 'reason',
      type: 'reasoning',
      text: 'Thinking',
    },
  })
  http.complete(id)
  await expect.poll(() => events.some((event) => event.type === 'turn.completed')).toBe(true)
  expect(events.filter((event) => event.type === 'content.delta')).toMatchObject([
    { payload: { streamKind: 'reasoning_text', delta: 'Thinking' } },
  ])
})

test('native resume updates permissions and does not create another native session', async () => {
  const { http, adapter } = setup()
  const runtime = await adapter.startRuntime(input)
  await adapter.stopRuntime({ sessionId })
  const resumed = await adapter.startRuntime({
    ...input,
    providerResumeCursor: runtime.providerResumeCursor,
    runtimeMode: 'full-access',
  })
  expect(resumed.providerBindingHandle).toBe(runtime.providerBindingHandle)
  expect(
    http.requests.filter((request) => request.path === '/session' && request.method === 'POST'),
  ).toHaveLength(1)
  expect(http.requests.find((request) => request.method === 'PATCH')?.body).toEqual({
    permission: [
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'external_directory', pattern: '*', action: 'allow' },
    ],
  })
})

test('Stop aborts only its own turn and old turn IDs cannot stop a new one', async () => {
  const { http, adapter, events } = setup()
  await adapter.sendTurn(input)
  await adapter.interruptTurn({ sessionId, turnId: v.parse(turnIdSchema, 'wrong-turn') })
  expect(http.requests.some((request) => request.path.endsWith('/abort'))).toBe(false)
  await adapter.interruptTurn({ sessionId, turnId })
  expect(http.requests.filter((request) => request.path.endsWith('/abort'))).toHaveLength(1)
  expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
    { payload: { state: 'interrupted' } },
  ])
  http.complete([...http.sessions.keys()][0]!)
  await adapter.stopRuntime({ sessionId })
  expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
})

test('native error and unexpected SSE EOF settle the active turn as failed', async () => {
  const { http, adapter, events } = setup()
  await adapter.sendTurn(input)
  http.emit('session.error', {
    sessionID: [...http.sessions.keys()][0],
    error: { message: 'fixture failure' },
  })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
  expect(events.at(-1)).toMatchObject({ type: 'turn.completed', payload: { state: 'failed' } })
  await adapter.sendTurn({ ...input, turnId: v.parse(turnIdSchema, 'second-turn') })
  http.disconnect()
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed')).toHaveLength(2)
  expect(await adapter.hasRuntime({ sessionId })).toBe(false)
})

test('permission replies are owned by the asking session and persistent approvals are unavailable', async () => {
  const { http, adapter, events } = setup()
  await adapter.sendTurn(input)
  http.emit('permission.asked', {
    sessionID: [...http.sessions.keys()][0],
    id: 'permit-1',
    permission: 'bash',
    patterns: ['echo fixture'],
  })
  await expect.poll(() => events.some((event) => event.type === 'request.opened')).toBe(true)
  const requestId = 'permit-1' as Parameters<typeof adapter.respondApproval>[0]['requestId']
  await expect(
    adapter.respondApproval({ sessionId, requestId, decision: 'acceptAlways' }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_UNSUPPORTED' })
  await adapter.respondApproval({ sessionId, requestId, decision: 'accept' })
  expect(
    http.requests.find((request) => request.path === '/permission/permit-1/reply')?.body,
  ).toEqual({ reply: 'once' })
  await expect(
    adapter.respondApproval({ sessionId, requestId, decision: 'accept' }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_SESSION_CONFLICT' })
})

test('two enabled driver instances keep native cursors, model catalogs, and aborts isolated', async () => {
  const first = startOpenCodeHttpFixture()
  const second = startOpenCodeHttpFixture()
  const otherId = v.parse(providerInstanceIdSchema, 'opencode-second')
  const registry = new ProviderAdapterRegistry({
    drivers: [opencodeDriver],
    services: { cwd: process.cwd() },
  })
  cleanup.push(
    () => first.close(),
    () => second.close(),
    () => registry.dispose(),
  )
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      config: { serverUrl: first.url },
    },
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: otherId,
      config: { serverUrl: second.url },
    },
  ])
  const a = registry.getByInstance(instanceId)!
  const b = registry.getByInstance(otherId)!
  const native = await a.startRuntime(input)
  await a.sendTurn(input)
  expect(await b.hasRuntime({ sessionId })).toBe(false)
  await expect(
    b.startRuntime({
      ...input,
      providerInstanceId: otherId,
      modelSelection: { ...input.modelSelection, providerInstanceId: otherId },
      providerResumeCursor: native.providerResumeCursor,
    }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_SESSION_CONFLICT' })
  await b.interruptTurn({ sessionId })
  expect(first.requests.some((request) => request.path.endsWith('/abort'))).toBe(false)
  expect(second.requests.some((request) => request.path.endsWith('/abort'))).toBe(false)
  expect(await registry.refreshSnapshot(instanceId)).toMatchObject({
    models: [{ slug: 'fixture/text' }],
    status: 'ready',
  })
})

test('status does not execute a shim and local SDKv2 ready output starts an owned fixture server', async () => {
  const fixture = await openCodeProcessFixture()
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Owned fixture',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(fixture.close, () => adapter.stopAll())
  expect(await adapter.snapshot()).toMatchObject({
    installed: true,
    version: null,
    status: 'warning',
    traits: { supportsSteering: false },
  })
  await expect(access(fixture.marker)).rejects.toBeDefined()
  await adapter.startRuntime({ ...input, cwd: fixture.root })
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(calls[0].dataHome).toBe(fixture.root)
  expect(calls[0].args.slice(0, 2)).toEqual(['serve', '--hostname=127.0.0.1'])
  const requestedPort = Number(calls[0].args[2].split('=')[1])
  expect(requestedPort).toBeGreaterThan(0)
  expect(new URL(calls[1].url).port).toBe(String(requestedPort))
  await adapter.stopAll()
  expect(await adapter.hasRuntime({ sessionId })).toBe(false)
})

test('unsupported capabilities fail explicitly before creating sessions', async () => {
  const { http, adapter } = setup()
  expect(adapter.capabilities).toEqual({
    conversationRollback: false,
    sessionModelSwitch: 'in-session',
    signIn: false,
    listCommands: false,
  })
  await expect(adapter.prepareRollbackSession()).rejects.toMatchObject({
    code: 'provider.OPENCODE_UNSUPPORTED',
  })
  await expect(adapter.sendTurn({ ...input, interactionMode: 'plan' })).rejects.toMatchObject({
    code: 'provider.OPENCODE_UNSUPPORTED',
  })
  await expect(adapter.sendTurn({ ...input, kind: 'compact' })).rejects.toMatchObject({
    code: 'provider.OPENCODE_UNSUPPORTED',
  })
  expect(http.sessions.size).toBe(0)
})

test('enabled fixture provider runs a complete turn through the real in-process app', async () => {
  const fixture = await openCodeAppFixture()
  cleanup.push(fixture.close)
  const registered = await fixture.engine.dispatchClientCommand({
    type: 'project.create',
    commandId: 'open-project',
    workspaceRoot: fixture.checkout,
    title: 'OpenCode fixture',
    defaultModelSelection: input.modelSelection,
  })
  expect(registered.result).not.toBeNull()
  await fixture.engine.dispatchClientCommand({
    type: 'session.create',
    commandId: 'open-session',
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId: registered.result!.worktreeId },
    title: 'OpenCode',
    modelSelection: input.modelSelection,
  })
  await fixture.engine.dispatchClientCommand({
    type: 'session.turn.start',
    commandId: 'open-turn',
    sessionId,
    turnId,
    message: { messageId: 'open-message', role: 'user', text: 'Hello', attachments: [] },
  })
  await expect
    .poll(() => fixture.http.requests.some((request) => request.path.endsWith('/prompt_async')))
    .toBe(true)
  const id = [...fixture.http.sessions.keys()][0]!
  fixture.http.answer(id)
  fixture.http.complete(id)
  await expect
    .poll(
      async () =>
        (await fixture.engine.readModelSnapshot()).sessions.get(sessionId)?.latestTurn?.state,
    )
    .toBe('completed')
  const session = (await fixture.engine.readModelSnapshot()).sessions.get(sessionId)!
  expect(
    session.messages.some(
      (message) => message.role === 'assistant' && message.text === 'Fixture answer',
    ),
  ).toBe(true)
})

test('simultaneous same-cwd runtimes own distinct local processes and Stop preserves the other', async () => {
  const fixture = await openCodeProcessFixture()
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Owned fixture',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(fixture.close, () => adapter.stopAll())
  const otherSession = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cdf')
  await Promise.all([
    adapter.sendTurn({ ...input, cwd: fixture.root }),
    adapter.sendTurn({ ...input, cwd: fixture.root, sessionId: otherSession }),
  ])
  const servers = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.url)
  expect(servers).toHaveLength(2)
  expect(new Set(servers.map((server) => server.url)).size).toBe(2)
  await adapter.interruptTurn({ sessionId, turnId })
  const abortCounts = await Promise.all(
    servers.map(async (server) => {
      const requests = (await (await fetch(`${server.url}/fixture/requests`)).json()) as {
        path: string
      }[]
      return requests.filter((request) => request.path.endsWith('/abort')).length
    }),
  )
  expect(abortCounts.sort()).toEqual([0, 1])
  await adapter.stopRuntime({ sessionId })
  expect(await adapter.hasRuntime({ sessionId: otherSession })).toBe(true)
  expect(await adapter.snapshot()).toMatchObject({ status: 'ready', version: 'fixture-v2' })
})

test('native idle before the abort HTTP acknowledgement still ends Stop as interrupted', async () => {
  const ended = Promise.withResolvers<void>()
  const { adapter, events } = setup({ beforeAbortResponse: () => ended.promise })
  adapter.subscribeEvents((event) => {
    if (event.type === 'turn.completed') ended.resolve()
  })
  await adapter.sendTurn(input)
  await adapter.interruptTurn({ sessionId, turnId })
  expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
    { payload: { state: 'interrupted' } },
  ])
})

test('a late abort acknowledgement cannot finish the following turn', async () => {
  const ended = Promise.withResolvers<void>()
  const ack = Promise.withResolvers<void>()
  const { adapter, http, events } = setup({ beforeAbortResponse: () => ack.promise })
  cleanup.push(() => ack.resolve())
  adapter.subscribeEvents((event) => {
    if (event.type === 'turn.completed') ended.resolve()
  })
  await adapter.sendTurn(input)
  const interrupted = adapter.interruptTurn({ sessionId, turnId })
  await ended.promise
  const nextTurn = v.parse(turnIdSchema, 'following-turn')
  await adapter.sendTurn({ ...input, turnId: nextTurn })
  ack.resolve()
  await interrupted
  expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
    { turnId, payload: { state: 'interrupted' } },
  ])
  const native = [...http.sessions.keys()][0]!
  http.answer(native)
  http.complete(native)
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed')).toHaveLength(2)
  expect(events.at(-1)).toMatchObject({ turnId: nextTurn, payload: { state: 'completed' } })
})

test('an owned child announcing another listener is rejected before HTTP session creation', async () => {
  const unrelated = startOpenCodeHttpFixture()
  const fixture = await openCodeProcessFixture({ announcedUrl: unrelated.url })
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Owned fixture',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(
    () => unrelated.close(),
    fixture.close,
    () => adapter.stopAll(),
  )
  await expect(adapter.startRuntime({ ...input, cwd: fixture.root })).rejects.toMatchObject({
    code: 'provider.OPENCODE_REQUEST_FAILED',
  })
  expect(unrelated.requests).toHaveLength(0)
  expect((await fetch(`${unrelated.url}/global/health`)).ok).toBe(true)
})

test('an occupied requested port fails its owned child without falling back to another listener', async () => {
  const fixture = await openCodeProcessFixture({ occupyRequestedPort: true })
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Owned fixture',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(fixture.close, () => adapter.stopAll())
  await expect(adapter.startRuntime({ ...input, cwd: fixture.root })).rejects.toMatchObject({
    code: 'provider.OPENCODE_REQUEST_FAILED',
  })
  const calls = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(calls).toHaveLength(1)
  expect(Number(calls[0].args[2].split('=')[1])).toBeGreaterThan(0)
  expect(await adapter.hasRuntime({ sessionId })).toBe(false)
})

test('review: duplicate native resume cannot adopt or abort another live Platform owner', async () => {
  const { adapter, http } = setup()
  const runtime = await adapter.startRuntime(input)
  const other = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cff')
  await adapter.sendTurn(input)
  const before = http.requests.length
  await expect(
    adapter.startRuntime({
      ...input,
      sessionId: other,
      providerResumeCursor: runtime.providerResumeCursor,
    }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_SESSION_CONFLICT' })
  expect(http.requests).toHaveLength(before)
  await adapter.interruptTurn({ sessionId: other })
  expect(http.requests.some((request) => request.path.endsWith('/abort'))).toBe(false)
  await adapter.stopRuntime({ sessionId })
  await expect(
    adapter.startRuntime({
      ...input,
      sessionId: other,
      providerResumeCursor: runtime.providerResumeCursor,
    }),
  ).resolves.toMatchObject({ providerBindingHandle: runtime.providerBindingHandle })
})

test('review: concurrent native adoption reserves identity before permission or SSE work', async () => {
  const { adapter, http } = setup()
  const runtime = await adapter.startRuntime(input)
  await adapter.stopRuntime({ sessionId })
  const other = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cff')
  const before = http.requests.length
  const results = await Promise.allSettled([
    adapter.startRuntime({ ...input, providerResumeCursor: runtime.providerResumeCursor }),
    adapter.startRuntime({
      ...input,
      sessionId: other,
      providerResumeCursor: runtime.providerResumeCursor,
    }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect(http.requests.slice(before).filter((request) => request.method === 'PATCH')).toHaveLength(
    1,
  )
})

test('review: late prompt failure belongs to its submitted turn and leaves the next turn active', async () => {
  const response = Promise.withResolvers<Response | null>()
  let count = 0
  const { adapter, http, events } = setup({
    beforePromptResponse: () => (++count === 1 ? response.promise : Promise.resolve(null)),
  })
  cleanup.push(() => response.resolve(Response.json({}, { status: 500 })))
  const submitted = adapter.sendTurn(input).then(
    () => null,
    (error) => error,
  )
  await expect
    .poll(() => http.requests.some((request) => request.path.endsWith('/prompt_async')))
    .toBe(true)
  const native = [...http.sessions.keys()][0]!
  http.complete(native)
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
  const next = { ...input, turnId: v.parse(turnIdSchema, 'next-prompt') }
  await adapter.sendTurn(next)
  response.resolve(Response.json({}, { status: 500 }))
  expect(await submitted).toMatchObject({ code: 'provider.OPENCODE_REQUEST_FAILED' })
  expect(
    events.filter((event) => event.type === 'turn.completed' && event.turnId === next.turnId),
  ).toHaveLength(0)
  await expect(
    adapter.sendTurn({ ...next, turnId: v.parse(turnIdSchema, 'third') }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_SESSION_CONFLICT' })
})

test.each(['permission', 'question'] as const)(
  'review: late automatic %s response failure leaves the following turn active',
  async (kind) => {
    const response = Promise.withResolvers<Response | null>()
    const { adapter, http, events } = setup({ beforeReplyResponse: () => response.promise })
    cleanup.push(() => response.resolve(Response.json({}, { status: 500 })))
    const turn = { ...input, runtimeMode: 'full-access' as const }
    await adapter.sendTurn(turn)
    const native = [...http.sessions.keys()][0]!
    http.emit(`${kind}.asked`, {
      sessionID: native,
      id: 'request-old',
      permission: 'read',
      patterns: ['*'],
    })
    await expect
      .poll(() =>
        http.requests.some(
          (request) => request.path.endsWith('/reply') || request.path.endsWith('/reject'),
        ),
      )
      .toBe(true)
    http.complete(native)
    await expect
      .poll(() => events.filter((event) => event.type === 'turn.completed'))
      .toHaveLength(1)
    const next = { ...turn, turnId: v.parse(turnIdSchema, 'next-reply') }
    await adapter.sendTurn(next)
    response.resolve(Response.json({}, { status: 500 }))
    await expect
      .poll(
        () =>
          events.some((event) => event.type === 'turn.completed' && event.turnId === next.turnId) ||
          events.some(
            (event) =>
              event.type === 'runtime.warning' &&
              event.payload.message === `OpenCode ${kind} response failed.`,
          ),
      )
      .toBe(true)
    expect(
      events.filter((event) => event.type === 'turn.completed' && event.turnId === next.turnId),
    ).toHaveLength(0)
    expect(
      events.find(
        (event) =>
          event.type === 'runtime.warning' &&
          event.payload.message === `OpenCode ${kind} response failed.`,
      )?.turnId,
    ).toBe(turn.turnId)
  },
)

test.each(['stopRuntime', 'stopAll'] as const)(
  'review: %s cancels startup while SSE response headers are withheld',
  async (stop) => {
    const gate = Promise.withResolvers<void>()
    const { adapter, http } = setup({ beforeEventHeaders: () => gate.promise })
    cleanup.push(() => gate.resolve())
    const startup = adapter.startRuntime(input).then(
      () => null,
      (error) => error,
    )
    await expect.poll(() => http.requests.some((request) => request.path === '/event')).toBe(true)
    const stopped = stop === 'stopAll' ? adapter.stopAll() : adapter.stopRuntime({ sessionId })
    const outcome = await Promise.race([
      stopped.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    gate.resolve()
    await stopped
    const failure = await startup
    expect(outcome).toBe(true)
    expect(failure).toBeDefined()
    expect(await adapter.hasRuntime({ sessionId })).toBe(false)
  },
)

async function fixtureProcessRunning(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  return stat !== '' && stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z'
}

test('review: wrapper descendants terminate with their runtime while another runtime stays alive', async () => {
  const fixture = await openCodeProcessFixture({ wrapper: 'alive' })
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Wrapped fixture',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(fixture.close, () => adapter.stopAll())
  const other = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cff')
  await adapter.startRuntime({ ...input, cwd: fixture.root })
  await adapter.startRuntime({ ...input, cwd: fixture.root, sessionId: other })
  const servers = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.url)
  expect(servers).toHaveLength(2)
  await adapter.stopRuntime({ sessionId })
  await expect.poll(() => fixtureProcessRunning(servers[0].pid), { timeout: 500 }).toBe(false)
  expect(await fixtureProcessRunning(servers[1].pid)).toBe(true)
  expect((await fetch(`${servers[1].url}/global/health`)).ok).toBe(true)
  await expect(fetch(`${servers[0].url}/global/health`)).rejects.toBeDefined()
})

test('review: startup failure cleans descendants after their direct wrapper has exited', async () => {
  const fixture = await openCodeProcessFixture({ wrapper: 'exit' })
  const adapter = new OpenCodeProviderAdapter({
    binaryPath: fixture.binaryPath,
    env: { PATH: '', XDG_DATA_HOME: fixture.root },
    displayLabel: 'Exited wrapper',
    enabled: true,
    providerInstanceId: instanceId,
  })
  cleanup.push(fixture.close, () => adapter.stopAll())
  await expect(adapter.startRuntime({ ...input, cwd: fixture.root })).rejects.toMatchObject({
    code: 'provider.OPENCODE_REQUEST_FAILED',
  })
  const wrapper = (await readFile(fixture.marker, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((row) => row.childPid)
  expect(wrapper).toBeDefined()
  await expect.poll(() => fixtureProcessRunning(wrapper.childPid), { timeout: 500 }).toBe(false)
})

test('review: SSE bootstrap has a finite operation budget and healthy streams outlive it', async () => {
  const gate = Promise.withResolvers<void>()
  const blocked = startOpenCodeHttpFixture({ beforeEventHeaders: () => gate.promise })
  const controller = new AbortController()
  cleanup.push(
    () => blocked.close(),
    () => gate.resolve(),
    () => controller.abort(),
  )
  const pending = new OpenCodeHttp(blocked.url, 50).events(input.cwd, controller.signal).then(
    () => null,
    (error) => error,
  )
  const outcome = await Promise.race([
    pending,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 300)),
  ])
  controller.abort()
  gate.resolve()
  await pending
  expect(outcome).toMatchObject({ code: 'provider.OPENCODE_REQUEST_FAILED' })
  const healthy = startOpenCodeHttpFixture()
  const active = new AbortController()
  cleanup.push(
    () => healthy.close(),
    () => active.abort(),
  )
  const stream = await new OpenCodeHttp(healthy.url, 50).events(input.cwd, active.signal)
  const reader = stream.getReader()
  await reader.read()
  await new Promise((resolve) => setTimeout(resolve, 75))
  healthy.emit('after-budget', {})
  expect((await reader.read()).done).toBe(false)
  await reader.cancel()
  reader.releaseLock()
})

test('review: failed adoption and stream EOF release native ownership', async () => {
  const { adapter, http } = setup()
  const runtime = await adapter.startRuntime(input)
  await adapter.stopRuntime({ sessionId })
  await expect(
    adapter.startRuntime({
      ...input,
      cwd: '/work/wrong',
      providerResumeCursor: runtime.providerResumeCursor,
    }),
  ).rejects.toMatchObject({ code: 'provider.OPENCODE_UNSUPPORTED' })
  await adapter.startRuntime({ ...input, providerResumeCursor: runtime.providerResumeCursor })
  http.disconnect()
  await expect.poll(() => adapter.hasRuntime({ sessionId })).toBe(false)
  const other = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cff')
  await expect
    .poll(async () => {
      try {
        await adapter.startRuntime({
          ...input,
          sessionId: other,
          providerResumeCursor: runtime.providerResumeCursor,
        })
        return true
      } catch {
        return false
      }
    })
    .toBe(true)
})

test.each(['stop', 'eof', 'stop-eof'] as const)(
  'ABA: old %s cleanup preserves a replacement runtime and its exact native lease',
  async (mode) => {
    const fixture = await openCodeProcessFixture({
      persistentSessions: true,
      holdAbortResponse: mode === 'stop-eof',
    })
    const adapter = new OpenCodeProviderAdapter({
      binaryPath: fixture.binaryPath,
      env: { PATH: '', XDG_DATA_HOME: fixture.root },
      displayLabel: 'Persistent fixture',
      enabled: true,
      providerInstanceId: instanceId,
    })
    cleanup.push(fixture.close, () => adapter.stopAll())
    const exited = Promise.withResolvers<void>()
    adapter.subscribeEvents((event) => {
      if (event.type === 'runtime.exited' && event.runtimeEpoch === input.runtimeEpoch)
        exited.resolve()
    })
    await adapter.startRuntime({ ...input, cwd: fixture.root })
    if (mode === 'stop-eof') await adapter.sendTurn({ ...input, cwd: fixture.root })
    const calls = (await readFile(fixture.marker, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const first = calls.find((row) => row.url)
    let stopped: Promise<unknown> = Promise.resolve()
    if (mode !== 'eof') stopped = adapter.stopRuntime({ sessionId }).catch((error) => error)
    if (mode === 'stop-eof')
      await expect
        .poll(async () => {
          const requests = (await (await fetch(`${first.url}/fixture/requests`)).json()) as {
            path: string
          }[]
          return requests.some((request) => request.path.endsWith('/abort'))
        })
        .toBe(true)
    if (mode !== 'stop') await fetch(`${first.url}/fixture/disconnect`).catch(() => undefined)
    await expect.poll(() => adapter.hasRuntime({ sessionId })).toBe(false)
    const replacement = await adapter.startRuntime({
      ...input,
      cwd: fixture.root,
      runtimeEpoch: 'replacement-epoch',
    })
    await exited.promise
    await stopped
    expect(await adapter.hasRuntime({ sessionId })).toBe(true)
    const other = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cff')
    await expect(
      adapter.startRuntime({
        ...input,
        cwd: fixture.root,
        sessionId: other,
        providerResumeCursor: replacement.providerResumeCursor,
      }),
    ).rejects.toMatchObject({ code: 'provider.OPENCODE_SESSION_CONFLICT' })
    expect(await adapter.hasRuntime({ sessionId })).toBe(true)
  },
)
