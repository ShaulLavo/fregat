import { access, readFile } from 'node:fs/promises'
import * as v from 'valibot'
import { providerInstanceIdSchema, sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../../test/server'
import { openCodeAppFixture } from '../../../../test/factories/opencode'
import { startOpenCodeHttpFixture } from '../../../../test/factories/opencode-http'
import { openCodeProcessFixture } from '../../../../test/factories/opencode-process'
import { OPENCODE_DRIVER_KIND, OpenCodeProviderAdapter } from '../opencode'
import { opencodeDriver } from '../../drivers/opencode'
import { ProviderAdapterRegistry } from '../../provider-adapter-registry'
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
  const registry = new ProviderAdapterRegistry({ drivers: [opencodeDriver] })
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
