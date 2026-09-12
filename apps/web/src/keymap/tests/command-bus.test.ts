import { tabId as typedTabId } from '@/lib/documents/utils/identity'
import { testDocumentRef } from '../../../test/factories/document-targets'
import { vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import {
  createCommandBus,
  type AsyncCommandSettlement,
  type AsyncWorkspaceCommandDefinition,
  type CommandBusOptions,
  type CommandDefinition,
  type CommandEventScope,
  type CommandInvocation,
  type EditorCommandDefinition,
  type ImmediateCommandDisposition,
  type ResolvedCommandTarget,
  type SyncWorkspaceCommandDefinition,
} from '@/keymap/state/command-bus'
import type { CommandWhenSnapshot } from '@/keymap/utils/when'

type TestCommandId = 'test.command'
type TestRuntime = { readonly label: string }
type TestSnapshot = CommandWhenSnapshot & { readonly generation: number }
type TestTarget = ResolvedCommandTarget & { readonly token: string }
type TestDefinition = CommandDefinition<
  TestCommandId,
  TestRuntime,
  TestSnapshot,
  TestTarget,
  CommandInvocation
>

const invocation: CommandInvocation = { source: { kind: 'keybinding' } }
const runtime: TestRuntime = { label: 'runtime' }
const enabledSnapshot: TestSnapshot = {
  activeDocumentSavable: true,
  activeDocument: testDocumentRef('/repo/src/app.ts'),
  activeTabId: typedTabId('tab-1'),
  chatMode: true,
  generation: 1,
  workspaceOpen: true,
}

test('one captured stroke reuses its snapshot and target through inspection and dispatch', async () => {
  const run = vi.fn<() => ImmediateCommandDisposition>(() => ({ status: 'handled' }))
  const harness = commandBusHarness(syncWorkspaceDefinition(run, ['workspaceOpen']))
  const stroke = harness.bus.capture(invocation)
  expect(stroke.inspect('test.command').status).toBe('ready')
  expect(stroke.inspect('test.command').status).toBe('ready')
  await expect(stroke.dispatch('test.command').completion).resolves.toEqual({ status: 'handled' })
  expect(harness.captureSnapshot).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledTimes(1)

  harness.bus.capture(invocation).inspect('test.command')
  expect(harness.captureSnapshot).toHaveBeenCalledTimes(2)
})

test('disabled inspection does not execute and dispatch remains unclaimed', async () => {
  const run = vi.fn<() => ImmediateCommandDisposition>(() => ({ status: 'handled' }))
  const definition = syncWorkspaceDefinition(run, ['workspaceOpen'])
  const harness = commandBusHarness(definition, {
    snapshot: { ...enabledSnapshot, workspaceOpen: false },
  })

  expect(harness.bus.inspect('test.command', invocation)).toMatchObject({
    reason: 'No workspace open.',
    status: 'disabled',
  })
  expect(run).not.toHaveBeenCalled()

  const ticket = harness.bus.dispatch('test.command', invocation)
  expect(ticket.claimed).toBe(false)
  await expect(ticket.completion).resolves.toEqual({
    reason: 'No workspace open.',
    status: 'disabled',
  })
  expect(run).not.toHaveBeenCalled()
  expect(harness.captureSnapshot).toHaveBeenCalledTimes(2)
})

test('a missing target is disabled and a target lost after inspection is unavailable', async () => {
  const run = vi.fn<() => ImmediateCommandDisposition>(() => ({ status: 'handled' }))
  const definition = syncWorkspaceDefinition(run)
  const missing = commandBusHarness(definition, { resolveTarget: () => null })

  expect(missing.bus.inspect('test.command', invocation)).toMatchObject({
    reason: 'No compatible command target is available.',
    status: 'disabled',
  })
  const missingTicket = missing.bus.dispatch('test.command', invocation)
  expect(missingTicket.claimed).toBe(false)
  await expect(missingTicket.completion).resolves.toMatchObject({ status: 'disabled' })

  let targetLive = true
  const lost = commandBusHarness(definition, {
    targetIsAvailable: () => targetLive,
  })
  expect(lost.bus.inspect('test.command', invocation).status).toBe('ready')
  targetLive = false

  const lostTicket = lost.bus.dispatch('test.command', invocation)
  expect(lostTicket.claimed).toBe(false)
  await expect(lostTicket.completion).resolves.toEqual({
    reason: 'target-unavailable',
    status: 'unhandled',
  })
  expect(run).not.toHaveBeenCalled()
})

test('a target availability throw resolves failed without claiming or executing', async () => {
  const failure = { code: 'TARGET_CHECK_FAILED', message: 'availability failed' }
  const run = vi.fn<() => ImmediateCommandDisposition>(() => ({ status: 'handled' }))
  const definition = syncWorkspaceDefinition(run)
  const harness = commandBusHarness(definition, {
    targetIsAvailable: () => {
      throw failure
    },
  })

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(false)
  await expect(ticket.completion).resolves.toMatchObject({
    failure: { owner: 'command-bus' },
    status: 'failed',
  })
  expect(run).not.toHaveBeenCalled()
  expect(harness.toClientError).toHaveBeenCalledWith(failure)
  expect(harness.reportError).toHaveBeenCalledOnce()
  expect(harness.endedEvents).toHaveLength(1)
})

test('adapts editor false and true to explicit dispositions', async () => {
  const definition = editorDefinition()
  const dispatchEditor = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  const harness = commandBusHarness(definition, { dispatchEditor })

  const declined = harness.bus.dispatch('test.command', invocation)
  expect(declined.claimed).toBe(false)
  await expect(declined.completion).resolves.toEqual({
    reason: 'handler-declined',
    status: 'unhandled',
  })

  const handled = harness.bus.dispatch('test.command', invocation)
  expect(handled.claimed).toBe(true)
  await expect(handled.completion).resolves.toEqual({ status: 'handled' })
  expect(dispatchEditor).toHaveBeenCalledTimes(2)
})

test('an async handler can decline synchronously without claiming the key', async () => {
  const definition = asyncWorkspaceDefinition(() => ({
    reason: 'handler-declined',
    status: 'unhandled',
  }))
  const harness = commandBusHarness(definition)

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(false)
  await expect(ticket.completion).resolves.toEqual({
    reason: 'handler-declined',
    status: 'unhandled',
  })
})

test('a started handler claims synchronously and waits for domain settlement', async () => {
  const settlement = deferred<AsyncCommandSettlement>()
  const definition = asyncWorkspaceDefinition(() => ({
    completion: settlement.promise,
    status: 'started',
  }))
  const harness = commandBusHarness(definition)
  let completed = false

  const ticket = harness.bus.dispatch('test.command', invocation)
  void ticket.completion.then(() => {
    completed = true
  })

  expect(ticket.claimed).toBe(true)
  await Promise.resolve()
  expect(completed).toBe(false)

  settlement.resolve({ status: 'handled' })
  await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
  expect(completed).toBe(true)
})

test('a synchronous throw resolves failed and reports exactly once', async () => {
  const failure = { code: 'OPERATION_FAILED', message: 'sync failure' }
  const definition = syncWorkspaceDefinition(() => {
    throw failure
  })
  const harness = commandBusHarness(definition)

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(true)
  await expect(ticket.completion).resolves.toMatchObject({
    failure: { owner: 'command-bus' },
    status: 'failed',
  })
  expect(harness.toClientError).toHaveBeenCalledOnce()
  expect(harness.toClientError).toHaveBeenCalledWith(failure)
  expect(harness.reportError).toHaveBeenCalledOnce()
  expect(harness.endedEvents).toHaveLength(1)
})

test('hostile thrown values cannot escape failed-ticket normalization', async () => {
  const hostileCause = new Proxy(
    {},
    {
      getPrototypeOf: () => neverInspectCause(),
    },
  )
  const toClientError = vi.fn(() => neverConvertCause())
  const definition = syncWorkspaceDefinition(() => {
    throw hostileCause
  })
  const harness = commandBusHarness(definition, { toClientError })

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(true)
  await expect(ticket.completion).resolves.toMatchObject({
    failure: {
      error: { category: 'unknown', message: 'Something unexpected went wrong.' },
      owner: 'command-bus',
    },
    status: 'failed',
  })
  expect(toClientError).toHaveBeenCalledOnce()
  expect(harness.reportError).toHaveBeenCalledOnce()
  expect(harness.endedEvents).toHaveLength(1)
})

test('a rejected started completion stays claimed, resolves failed, and reports once', async () => {
  const failure = { code: 'OPERATION_FAILED', message: 'async failure' }
  const definition = asyncWorkspaceDefinition(() => ({
    completion: Promise.reject(failure),
    status: 'started',
  }))
  const harness = commandBusHarness(definition)

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(true)
  await expect(ticket.completion).resolves.toMatchObject({
    failure: { owner: 'command-bus' },
    status: 'failed',
  })
  expect(harness.toClientError).toHaveBeenCalledOnce()
  expect(harness.reportError).toHaveBeenCalledOnce()
  expect(harness.endedEvents).toHaveLength(1)
})

test('a domain-owned settings failure is preserved without bus reporting', async () => {
  const definition = asyncWorkspaceDefinition(() => ({
    completion: Promise.resolve({
      failure: { operationId: 'mutation-1', owner: 'domain' },
      status: 'failed',
    }),
    status: 'started',
  }))
  const harness = commandBusHarness(definition)

  const ticket = harness.bus.dispatch('test.command', invocation)

  await expect(ticket.completion).resolves.toEqual({
    failure: { operationId: 'mutation-1', owner: 'domain' },
    status: 'failed',
  })
  expect(harness.toClientError).not.toHaveBeenCalled()
  expect(harness.reportError).not.toHaveBeenCalled()
  expect(harness.endedEvents[0]).toMatchObject({
    failureOwner: 'domain',
    operationId: 'mutation-1',
    outcome: 'failed',
  })
})

test('one wide event ends with source, target, execution, undo, outcome, and duration', async () => {
  const settlement = deferred<AsyncCommandSettlement>()
  const definition = asyncWorkspaceDefinition(() => ({
    completion: settlement.promise,
    status: 'started',
  }))
  const times = [20, 32]
  const harness = commandBusHarness(definition, {
    invocation: { source: { kind: 'menu', surface: 'titlebar' } },
    now: () => times.shift() ?? 32,
  })

  const ticket = harness.bus.dispatch('test.command', harness.invocation)
  expect(harness.createdEvents).toHaveLength(1)
  expect(harness.endedEvents).toEqual([])

  settlement.resolve({ status: 'handled' })
  await ticket.completion

  expect(harness.endedEvents).toEqual([
    expect.objectContaining({
      action: 'command.dispatch',
      area: 'command',
      commandId: 'test.command',
      durationMs: 12,
      execution: 'async',
      commandSource: 'menu',
      menuSurface: 'titlebar',
      outcome: 'handled',
      targetIdentity: 'workspace:primary',
      targetKind: 'workspace',
      undoCategory: 'workspace-operation',
    }),
  ])
})

test.each([
  { label: 'every read', now: () => neverReadClock() },
  {
    label: 'only the start read',
    now: (() => {
      let reads = 0
      return () => {
        reads += 1
        if (reads === 1) return neverReadClock()

        return 42
      }
    })(),
  },
])(
  'a diagnostics clock failure on $label cannot corrupt settlement or duration',
  async ({ now }) => {
    const definition = syncWorkspaceDefinition(() => ({ status: 'handled' }))
    const harness = commandBusHarness(definition, { now })

    const ticket = harness.bus.dispatch('test.command', invocation)

    expect(ticket.claimed).toBe(true)
    await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
    expect(harness.endedEvents).toEqual([
      expect.objectContaining({ durationMs: 0, outcome: 'handled' }),
    ])
    expect(harness.reportError).not.toHaveBeenCalled()
  },
)

test('dirty-close deferred is claimed and remains distinct from handled', async () => {
  const definition = syncWorkspaceDefinition(() => ({
    reason: 'dirty-close',
    status: 'deferred',
  }))
  const harness = commandBusHarness(definition)

  const ticket = harness.bus.dispatch('test.command', invocation)

  expect(ticket.claimed).toBe(true)
  await expect(ticket.completion).resolves.toEqual({
    reason: 'dirty-close',
    status: 'deferred',
  })
})

test('one bus keeps an in-flight command on its captured environment', async () => {
  const gate = Promise.withResolvers<void>()
  let selected: TestRuntime | null = { label: 'A' }
  const visited: string[] = []
  const definition = asyncWorkspaceDefinition(({ runtime: captured }) => ({
    status: 'started',
    completion: (async () => {
      visited.push(captured.label)
      await gate.promise
      visited.push(captured.label)
      return { status: 'handled' as const }
    })(),
  }))
  const harness = commandBusHarness(definition, { captureRuntime: () => selected })
  const first = harness.bus.dispatch('test.command', invocation)
  selected = { label: 'B' }
  gate.resolve()
  await first.completion
  await harness.bus.dispatch('test.command', invocation).completion
  expect(visited).toEqual(['A', 'A', 'B', 'B'])
  selected = null
  const switching = harness.bus.dispatch('test.command', invocation)
  expect(switching.claimed).toBe(false)
  await expect(switching.completion).resolves.toMatchObject({ status: 'disabled' })
})

type HarnessOverrides = {
  readonly captureRuntime?: () => TestRuntime | null
  readonly dispatchEditor?: CommandBusOptions<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['dispatchEditor']
  readonly invocation?: CommandInvocation
  readonly now?: () => number
  readonly resolveTarget?: CommandBusOptions<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['resolveTarget']
  readonly snapshot?: TestSnapshot
  readonly targetIsAvailable?: (target: TestTarget) => boolean
  readonly toClientError?: CommandBusOptions<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['toClientError']
}

function commandBusHarness(definition: TestDefinition, overrides: HarnessOverrides = {}) {
  const createdEvents: Record<string, unknown>[] = []
  const endedEvents: Record<string, unknown>[] = []
  const reportError = vi.fn()
  const toClientError =
    overrides.toClientError ??
    vi.fn((cause: unknown) => ({
      category: 'io_error' as const,
      cause,
      message: 'Command failed.',
    }))
  const captureSnapshot = vi.fn(() => overrides.snapshot ?? enabledSnapshot)
  const defaultTarget: TestTarget = {
    kind: definition.target,
    logIdentity: `${definition.target}:primary`,
    token: 'target-1',
    writable: true,
  }
  const createEvent = (base: Record<string, unknown>): CommandEventScope => {
    createdEvents.push(base)
    return {
      end: (context) => endedEvents.push({ ...base, ...context }),
      error: (_error, context) => {
        if (!context) return
        Object.assign(base, { error: context })
      },
    }
  }
  let time = 0
  const options: CommandBusOptions<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  > = {
    captureSnapshot,
    createEvent,
    dispatchEditor: overrides.dispatchEditor ?? (() => true),
    lookup: () => definition,
    now:
      overrides.now ??
      (() => {
        time += 5
        return time
      }),
    reportError,
    resolveTarget: overrides.resolveTarget ?? (() => defaultTarget),
    captureRuntime: overrides.captureRuntime ?? (() => runtime),
    targetIsAvailable: overrides.targetIsAvailable ?? (() => true),
    toClientError,
  }

  return {
    bus: createCommandBus(options),
    captureSnapshot,
    createdEvents,
    endedEvents,
    invocation: overrides.invocation ?? invocation,
    reportError,
    toClientError,
  }
}

function neverReadClock(): never {
  throw { code: 'CLOCK_FAILED', message: 'clock failed' }
}

function neverInspectCause(): never {
  throw { code: 'CAUSE_INSPECTION_FAILED', message: 'cause inspection failed' }
}

function neverConvertCause(): never {
  throw { code: 'CAUSE_CONVERSION_FAILED', message: 'cause conversion failed' }
}

function editorDefinition(): EditorCommandDefinition<TestCommandId> {
  return {
    execution: 'sync',
    id: 'test.command',
    target: 'editor',
    undoCategory: 'text-edit',
    when: ['editorTarget', 'editorWritable'],
  }
}

function syncWorkspaceDefinition(
  run: SyncWorkspaceCommandDefinition<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['run'],
  when: SyncWorkspaceCommandDefinition<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['when'] = [],
): SyncWorkspaceCommandDefinition<
  TestCommandId,
  TestRuntime,
  TestSnapshot,
  TestTarget,
  CommandInvocation
> {
  return {
    execution: 'sync',
    id: 'test.command',
    run,
    target: 'workspace',
    undoCategory: 'workspace-operation',
    when,
  }
}

function asyncWorkspaceDefinition(
  run: AsyncWorkspaceCommandDefinition<
    TestCommandId,
    TestRuntime,
    TestSnapshot,
    TestTarget,
    CommandInvocation
  >['run'],
): AsyncWorkspaceCommandDefinition<
  TestCommandId,
  TestRuntime,
  TestSnapshot,
  TestTarget,
  CommandInvocation
> {
  return {
    execution: 'async',
    id: 'test.command',
    run,
    target: 'workspace',
    undoCategory: 'workspace-operation',
    when: [],
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}
