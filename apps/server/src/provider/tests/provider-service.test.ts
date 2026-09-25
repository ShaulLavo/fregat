import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationProjectionPipeline } from '../../orchestration/projection-pipeline'
import {
  domainBootstrap,
  domainEvent,
  DOMAIN_IDS,
} from '../../orchestration/tests/factories/session-domain'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
  worktreeIdSchema,
} from '@workspace/contracts'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { WorktreeExecutionGate } from '../../orchestration/worktree-execution-gate'
import { MockProviderAdapter } from '../adapters/mock'
import { MOCK_DRIVER_KIND, mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderService } from '../provider-service'
import { ProviderSessionDirectory } from '../provider-session-directory'
import type { ProviderRuntimeEvent, ProviderTurnInput } from '../types'

describe('ProviderService', () => {
  it('reclaims an idle runtime periodically without another launch and clears its timer on shutdown', async () => {
    vi.useFakeTimers()
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = {
      ...providerTurnInput(),
      sessionId: v.parse(sessionIdSchema, DOMAIN_IDS.session),
    }
    try {
      const pipeline = new OrchestrationProjectionPipeline(fixture.database)
      pipeline.applyEvents(domainBootstrap())
      await service.ensureRuntime({
        providerInstanceId: input.providerInstanceId,
        runtimeMode: input.runtimeMode,
        runtimePayload: providerSessionPayload(input),
        runtimeEpoch: input.runtimeEpoch,
        sessionId: input.sessionId,
      })
      await service.drainRuntimeEvents()
      pipeline.applyEvents([
        domainEvent(
          'session.runtime-set',
          {
            sessionId: input.sessionId,
            runtime: {
              sessionId: input.sessionId,
              status: 'ready',
              providerName: 'codex',
              providerInstanceId: input.providerInstanceId,
              runtimeMode: input.runtimeMode,
              runtimeEpoch: input.runtimeEpoch,
              providerBindingHandle: null,
              providerConversationMarker: null,
              providerResumeCursor: null,
              activeTurnId: null,
              lastError: null,
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          },
          4,
        ),
      ])
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(true)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(await adapter.hasRuntime({ sessionId: input.sessionId })).toBe(false)
      await service.shutdown()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await service.shutdown()
      fixture.close()
      vi.useRealTimers()
    }
  })

  it('closes a launch that resolves after the shutdown wait times out', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ operationTimeoutMs: 5 })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const originalStart = adapter.startRuntime.bind(adapter)
    adapter.startRuntime = async (input) => {
      entered.resolve()
      await release.promise
      return originalStart(input)
    }
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const turn = providerTurnInput()
    let databaseClosed = false
    const launch = service
      .ensureRuntime({
        providerInstanceId: turn.providerInstanceId,
        runtimeMode: turn.runtimeMode,
        runtimePayload: providerSessionPayload(turn),
        runtimeEpoch: turn.runtimeEpoch,
        sessionId: turn.sessionId,
      })
      .then(
        () => null,
        (error: unknown) => error,
      )
    try {
      await entered.promise
      await service.shutdown()
      fixture.close()
      databaseClosed = true
      release.resolve()
      expect(await launch).toMatchObject({ code: 'provider.SERVICE_CLOSED' })
      expect(await adapter.hasRuntime({ sessionId: turn.sessionId })).toBe(false)
    } finally {
      release.resolve()
      await launch
      await adapter.stopAll()
      if (!databaseClosed) fixture.close()
    }
  })

  it('offers the current epoch only for a live runtime with every launch option unchanged', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const turn = providerTurnInput()
    const input = {
      providerInstanceId: turn.providerInstanceId,
      runtimeMode: turn.runtimeMode,
      runtimePayload: providerSessionPayload(turn),
      runtimeEpoch: turn.runtimeEpoch,
      sessionId: turn.sessionId,
    }
    try {
      await service.ensureRuntime(input)
      expect(await service.reusableRuntimeEpoch(input)).toBe(turn.runtimeEpoch)
      expect(
        await service.reusableRuntimeEpoch({ ...input, runtimeMode: 'approval-required' }),
      ).toBeNull()
      expect(
        await service.reusableRuntimeEpoch({
          ...input,
          runtimePayload: { ...input.runtimePayload, cwd: '/other' },
        }),
      ).toBeNull()
      expect(
        await service.reusableRuntimeEpoch({
          ...input,
          runtimePayload: { ...input.runtimePayload, interactionMode: 'plan' },
        }),
      ).toBeNull()
      expect(
        await service.reusableRuntimeEpoch({
          ...input,
          runtimePayload: {
            ...input.runtimePayload,
            modelSelection: { ...turn.modelSelection, options: { reasoningEffort: 'high' } },
          },
        }),
      ).toBeNull()
      await service.stopRuntime({ sessionId: turn.sessionId })
      expect(await service.reusableRuntimeEpoch(input)).toBeNull()
    } finally {
      await service.shutdown()
      fixture.close()
    }
  })

  it('fences cleanup behind a pending runtime launch without treating it as no binding', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ operationTimeoutMs: 5 })
    const release = Promise.withResolvers<void>()
    const originalStart = adapter.startRuntime.bind(adapter)
    adapter.startRuntime = async (input) => {
      await release.promise
      return originalStart(input)
    }
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const turn = providerTurnInput()
    const launch = service.ensureRuntime({
      providerInstanceId: turn.providerInstanceId,
      runtimeMode: turn.runtimeMode,
      runtimePayload: providerSessionPayload(turn),
      runtimeEpoch: turn.runtimeEpoch,
      sessionId: turn.sessionId,
    })
    try {
      expect(await service.hasActiveRuntimeForInstance(turn.providerInstanceId)).toBe(true)
      await expect(service.hasRuntime({ sessionId: turn.sessionId })).rejects.toMatchObject({
        code: 'provider.OPERATION_TIMED_OUT',
      })
      await expect(service.stopRuntime({ sessionId: turn.sessionId })).rejects.toMatchObject({
        code: 'provider.OPERATION_TIMED_OUT',
      })
      release.resolve()
      await launch
      expect(await service.hasRuntime({ sessionId: turn.sessionId })).toBe(true)
      await service.stopRuntime({ sessionId: turn.sessionId })
      expect(await adapter.hasRuntime({ sessionId: turn.sessionId })).toBe(false)
    } finally {
      release.resolve()
      await launch
      await service.shutdown()
      fixture.close()
    }
  })

  it('reuses compatible session bindings and resets incompatible ones', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    const first = await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })
    const reused = await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })
    const reset = await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: {
        ...providerSessionPayload(input),
        cwd: '/other-workspace',
      },
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })

    expect(first).toMatchObject({ reused: false })
    expect(reused).toMatchObject({ reused: true })
    expect(reset).toMatchObject({
      binding: { runtimePayload: expect.objectContaining({ cwd: '/other-workspace' }) },
      reused: false,
    })
    fixture.close()
  })

  it('reuses session bindings when only model option key order changes', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const turn = providerTurnInput()
    const input = {
      providerInstanceId: turn.providerInstanceId,
      runtimeMode: turn.runtimeMode,
      runtimeEpoch: turn.runtimeEpoch,
      sessionId: turn.sessionId,
      runtimePayload: providerSessionPayload(turn),
    }
    try {
      await service.ensureRuntime({
        ...input,
        runtimePayload: {
          ...input.runtimePayload,
          modelSelection: { ...turn.modelSelection, options: { effort: 'high', budget: 100 } },
        },
      })
      const reused = await service.ensureRuntime({
        ...input,
        runtimePayload: {
          ...input.runtimePayload,
          modelSelection: { ...turn.modelSelection, options: { budget: 100, effort: 'high' } },
        },
      })

      expect(reused).toMatchObject({ reused: true })
    } finally {
      await service.shutdown()
      fixture.close()
    }
  })

  it('carries the resume cursor across a mid-conversation model switch', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    const started = await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })
    const switched = await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: {
        ...providerSessionPayload(input),
        modelSelection: { ...input.modelSelection, model: 'gpt-5.5' },
      },
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })

    expect(started.binding.providerResumeCursor).toBe(
      'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
    )
    expect(switched).toMatchObject({ reused: false })
    // The session restarts, the conversation does not.
    expect(adapter.startedSessions.map((session) => session.providerResumeCursor)).toEqual([
      null,
      'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
    ])
    expect(switched.binding.providerResumeCursor).toBe(
      'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
    )
    fixture.close()
  })

  it('uses the captured native boundary only on the first start', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    const source = v.parse(sessionIdSchema, '5b2b1c8e-4b5a-4d8a-9d0e-8a7c1a2b3c4d')
    directory.upsert({
      adapterKey: adapter.adapterKey,
      providerDriverKind: adapter.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: `mock:${source}`,
      providerResumeCursor: 'source-conversation',
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: source,
      runtimeEpoch: 'source-epoch',
    })
    const fork = {
      native: { conversationId: 'captured-conversation', boundaryId: 'captured-turn' },
      sessionId: source,
      turnId: input.turnId,
    }
    const ensure = (runtimeEpoch: string) =>
      service.ensureRuntime({
        fork,
        providerInstanceId: input.providerInstanceId,
        runtimeMode: input.runtimeMode,
        runtimePayload: providerSessionPayload(input),
        runtimeEpoch,
        sessionId: input.sessionId,
      })

    await ensure(input.runtimeEpoch)
    await ensure('second-epoch')

    expect(adapter.startedSessions.map((session) => session.fork ?? null)).toEqual([
      fork.native,
      null,
    ])
    fixture.close()
  })

  it('hands a turn the cursor of the conversation it continues', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    // A binding that outlived the process that created it: no adapter session
    // exists any more, so the turn itself has to carry the cursor.
    directory.upsert({
      adapterKey: adapter.adapterKey,
      providerDriverKind: adapter.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: 'mock:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
      providerResumeCursor: 'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })

    await service.sendTurn(input)

    expect(adapter.startedTurns[0]?.providerResumeCursor).toBe(
      'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
    )
    expect(adapter.startedSessions[0]?.providerResumeCursor).toBe(
      'mock-conversation:ee84050b-1b17-5fe8-9f71-0983f1fceccc',
    )
    fixture.close()
  })

  it('keeps a session parked on an approval reusable and listed', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter()
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    const ensureInput = {
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    }

    await service.ensureRuntime(ensureInput)
    expect(await service.listActiveRuntimes()).toContainEqual(
      expect.objectContaining({ sessionId: input.sessionId }),
    )
    expect(await service.ensureRuntime(ensureInput)).toMatchObject({ reused: true })
    await adapter.stopRuntime({ sessionId: input.sessionId })
    expect(await service.listActiveRuntimes()).toEqual([])
    fixture.close()
  })

  it('refuses to repoint a session at another provider instance', async () => {
    const fixture = createFixture()
    const codex = new MockProviderAdapter()
    const other = new MockProviderAdapter({
      providerInstanceId: v.parse(providerInstanceIdSchema, 'codex-personal'),
    })
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([codex, other]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })

    await expect(
      service.ensureRuntime({
        providerInstanceId: other.adapterKey,
        runtimeMode: input.runtimeMode,
        runtimePayload: {
          ...providerSessionPayload(input),
          modelSelection: { ...input.modelSelection, providerInstanceId: other.adapterKey },
        },
        sessionId: input.sessionId,
        runtimeEpoch: input.runtimeEpoch,
      }),
    ).rejects.toThrow('The session belongs to another provider instance')

    expect(other.startedSessions).toHaveLength(0)
    fixture.close()
  })

  it('routes provider turns and controls through the registered Codex adapter', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ responseText: 'Service response' })
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    const fanOutEvents: ProviderRuntimeEvent[] = []
    const unsubscribe = service.subscribeRuntimeEvents((event) => {
      fanOutEvents.push(event)
    })

    await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })
    await service.sendTurn(input)
    await waitForRuntimeEvent(fanOutEvents, 'turn.completed')
    const activeSessions = await service.listActiveRuntimes()
    await service.interruptTurn({ sessionId: input.sessionId, turnId: input.turnId })
    await service.stopRuntime({ sessionId: input.sessionId })
    unsubscribe()

    expect(adapter.startedTurns).toHaveLength(1)
    expect(adapter.startedTurns[0]).toMatchObject({
      messageText: 'Say hello',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      turnId: input.turnId,
    })
    expect(adapter.interruptedSessions).toEqual([input.sessionId, input.sessionId])
    expect(fanOutEvents.map((event) => event.type)).toContain('turn.started')
    expect(fanOutEvents.map((event) => event.type)).toContain('assistant.delta')
    expect(fanOutEvents.map((event) => event.type)).toContain('assistant.complete')
    expect(fanOutEvents.map((event) => event.type)).toContain('turn.completed')
    expect(fanOutEvents.map((event) => event.type).slice(-5)).toEqual([
      'assistant.delta',
      'assistant.complete',
      'usage.totals',
      'conversation.token-usage.updated',
      'turn.completed',
    ])
    expect(activeSessions).toContainEqual(expect.objectContaining({ sessionId: input.sessionId }))
    expect(directory.getBinding(input.sessionId)).not.toHaveProperty('status')
    expect(await service.hasRuntime({ sessionId: input.sessionId })).toBe(false)
    fixture.close()
  })

  it('bounds cleanup and liveness checks by the adapter operation timeout', async () => {
    class UnresponsiveAdapter extends MockProviderAdapter {
      unresponsive = false
      override async stopRuntime() {
        await new Promise(() => {})
      }
      override async hasRuntime(input: { sessionId: ProviderTurnInput['sessionId'] }) {
        if (this.unresponsive) return new Promise<boolean>(() => {})
        return super.hasRuntime(input)
      }
    }
    const fixture = createFixture()
    const adapter = new UnresponsiveAdapter({ operationTimeoutMs: 5 })
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      sessionId: input.sessionId,
      runtimeEpoch: input.runtimeEpoch,
    })
    adapter.unresponsive = true
    await expect(service.stopRuntime({ sessionId: input.sessionId })).rejects.toThrow(
      'The provider operation timed out',
    )
    await expect(service.hasRuntime({ sessionId: input.sessionId })).rejects.toThrow(
      'The provider operation timed out',
    )
    fixture.close()
  })

  it('retains the execution lease across failed stop and releases only after a successful retry', async () => {
    class StopAdapter extends MockProviderAdapter {
      failStop = true
      override async stopRuntime(input: { sessionId: ProviderTurnInput['sessionId'] }) {
        if (this.failStop) throw new TypeError('process still alive')
        return super.stopRuntime(input)
      }
    }
    const fixture = createFixture()
    const adapter = new StopAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const gate = new WorktreeExecutionGate()
    const worktreeId = v.parse(worktreeIdSchema, '10000000-0000-4000-8000-000000000001')
    service.setWorktreeExecution({
      acquire: () => ({ worktreeId, ...gate.acquireShared(worktreeId, 'provider') }),
    })
    const input = providerTurnInput()
    await service.ensureRuntime({
      providerInstanceId: input.providerInstanceId,
      runtimeMode: input.runtimeMode,
      runtimePayload: providerSessionPayload(input),
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })
    await expect(service.stopRuntime({ sessionId: input.sessionId })).rejects.toThrow(
      'process still alive',
    )
    expect(service.hasWorktreeLease(worktreeId)).toBe(true)
    expect(gate.tryAcquireExclusive(worktreeId)).toEqual({
      acquired: false,
      reason: 'active-runtime',
    })
    adapter.failStop = false
    await service.stopRuntime({ sessionId: input.sessionId })
    expect(service.hasWorktreeLease(worktreeId)).toBe(false)
    const cleanup = gate.tryAcquireExclusive(worktreeId)
    expect(cleanup.acquired).toBe(true)
    if (cleanup.acquired) cleanup.release()
    await service.shutdown()
    fixture.close()
  })

  it('stops an ephemeral process even when startup fails after creating its runtime', async () => {
    class LateFailureAdapter extends MockProviderAdapter {
      override async startRuntime(
        input: Parameters<MockProviderAdapter['startRuntime']>[0],
      ): Promise<never> {
        await super.startRuntime(input)
        throw new TypeError('late launch failure')
      }
    }
    const fixture = createFixture()
    const adapter = new LateFailureAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    await expect(
      service.generateText({
        purpose: 'title',
        messageText: 'Describe this diff',
        modelSelection: input.modelSelection,
      }),
    ).rejects.toThrow('late launch failure')
    const started = adapter.startedSessions[0]
    if (!started) throw new TypeError('Missing start')
    expect(await adapter.hasRuntime({ sessionId: started.sessionId })).toBe(false)
    await expect(stat(started.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    await service.shutdown()
    fixture.close()
  })

  it('retains an isolated generation directory when stop remains unconfirmed', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ stopError: 'stop failed' })
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    await service.generateText({
      purpose: 'title',
      messageText: 'Describe this diff',
      modelSelection: input.modelSelection,
    })
    const started = adapter.startedSessions[0]
    if (!started) throw new TypeError('Missing start')
    expect(started.cwd).not.toBe(input.cwd)
    expect((await stat(started.cwd)).isDirectory()).toBe(true)
    expect(await adapter.hasRuntime({ sessionId: started.sessionId })).toBe(true)
    await adapter.stopAll()
    await rm(started.cwd, { recursive: true, force: true })
    await service.shutdown()
    fixture.close()
  })

  it('marks isolated text generation ephemeral without creating a chat binding', async () => {
    const fixture = createFixture()
    const adapter = new MockProviderAdapter({ responseText: 'Generated title' })
    const directory = new ProviderSessionDirectory(fixture.database)
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: directory,
    })
    const input = providerTurnInput()
    const usage: Array<{ purpose: string; runtimeListenerSawIt: boolean }> = []
    const runtimeEventTypes: string[] = []
    service.subscribeRuntimeEvents((event) => {
      runtimeEventTypes.push(event.type)
    })
    service.subscribeUsage((_event, purpose) =>
      usage.push({ purpose, runtimeListenerSawIt: runtimeEventTypes.includes('usage.totals') }),
    )

    const result = await service.generateText({
      purpose: 'title',
      messageText: 'Describe this diff',
      modelSelection: input.modelSelection,
    })

    expect(result).toEqual({ text: 'Generated title' })
    // The generation stays out of chat, but what it cost is still reported, labelled.
    expect(usage).toEqual([{ purpose: 'title', runtimeListenerSawIt: false }])
    expect(runtimeEventTypes).toEqual([])
    expect(adapter.startedSessions).toHaveLength(1)
    expect(path.dirname(adapter.startedSessions[0]!.cwd)).toBe(tmpdir())
    expect(path.basename(adapter.startedSessions[0]!.cwd)).toMatch(/^platform-provider-text-/)
    expect(adapter.startedSessions[0]?.cwd).not.toBe(input.cwd)
    expect(adapter.startedTurns[0]?.cwd).toBe(adapter.startedSessions[0]?.cwd)
    expect(adapter.startedSessions[0]).toMatchObject({
      ephemeral: true,
      runtimeMode: 'approval-required',
    })
    expect(adapter.startedTurns).toHaveLength(1)
    expect(adapter.startedTurns[0]).toMatchObject({
      ephemeral: true,
      runtimeMode: 'approval-required',
    })
    const generatedSessionId = adapter.startedTurns[0]!.sessionId
    expect(directory.getBinding(generatedSessionId)).toBeNull()
    expect(await adapter.hasRuntime({ sessionId: generatedSessionId })).toBe(false)
    fixture.close()
  })

  it('closes an isolated session when cancellation lands before provider completion', async () => {
    const fixture = createFixture()
    const gate = Promise.withResolvers<void>()
    const adapter = new MockProviderAdapter({ beforeComplete: () => gate.promise })
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    const controller = new AbortController()
    const generation = service.generateText({
      purpose: 'title',
      messageText: 'Describe this diff',
      modelSelection: input.modelSelection,
      signal: controller.signal,
    })

    await waitForCondition(() => adapter.startedTurns.length === 1, 'provider turn did not start')
    const generatedSessionId = adapter.startedTurns[0]!.sessionId
    controller.abort()
    await waitForCondition(
      async () => !(await adapter.hasRuntime({ sessionId: generatedSessionId })),
      'cancelled provider session stayed open',
    )
    gate.resolve()

    await expect(generation).rejects.toThrow('Provider text generation was cancelled.')
    expect(adapter.interruptedSessions).toEqual([generatedSessionId, generatedSessionId])
    await service.shutdown()
    fixture.close()
  })

  it('leases an adapter while isolated generation survives settings reconciliation', async () => {
    const fixture = createFixture()
    const gate = Promise.withResolvers<void>()
    const adapter = new MockProviderAdapter({ beforeComplete: () => gate.promise })
    const registry = new ProviderAdapterRegistry([adapter])
    const service = new ProviderService({
      adapterRegistry: registry,
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const input = providerTurnInput()
    const generation = service.generateText({
      purpose: 'title',
      messageText: 'Describe this diff',
      modelSelection: input.modelSelection,
    })

    await waitForCondition(() => adapter.startedTurns.length === 1, 'provider turn did not start')
    await registry.reconcile([])
    expect(registry.adapter(DEFAULT_PROVIDER_INSTANCE_ID)).toBe(adapter)

    gate.resolve()
    await expect(generation).resolves.toEqual({ text: 'Mock response' })
    await waitForCondition(
      () => registry.adapter(DEFAULT_PROVIDER_INSTANCE_ID) === null,
      'deferred provider removal was not replayed after lease release',
    )
    await service.shutdown()
    fixture.close()
  })
})

function providerTurnInput(): ProviderTurnInput {
  const sessionId = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
  const turnId = v.parse(turnIdSchema, 'turn-1')
  const modelSelection = {
    model: 'gpt-5-codex',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  }

  return {
    attachments: [],
    cwd: '/workspace',
    interactionMode: DEFAULT_INTERACTION_MODE,
    messageText: 'Say hello',
    modelSelection,
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    sessionId,
    runtimeEpoch: 'runtime-epoch',
    turnId,
  }
}

async function settleRuntimeEvents() {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForRuntimeEvent(
  events: ProviderRuntimeEvent[],
  type: ProviderRuntimeEvent['type'],
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (events.some((event) => event.type === type)) return
    await settleRuntimeEvents()
  }
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return

    await new Promise((resolve) => setTimeout(resolve, 2))
  }

  expect.unreachable(message)
}

function providerSessionPayload(input: ProviderTurnInput) {
  return {
    cwd: input.cwd,
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
  }
}

function createFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  return {
    close: () => sqlite.close(),
    database,
  }
}

describe('ProviderService adapter streams', () => {
  it('follows an instance whose adapter is replaced in place', async () => {
    const fixture = createFixture()
    const home = await mkdtemp(path.join(tmpdir(), 'provider-stream-'))
    const registry = new ProviderAdapterRegistry({ drivers: [mockDriver] })
    const service = new ProviderService({
      adapterRegistry: registry,
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const seen: ProviderRuntimeEvent[] = []
    service.subscribeRuntimeEvents((event) => {
      seen.push(event)
    })

    try {
      await registry.reconcile([mockInstance({ credentialsPath: path.join(home, 'a.json') })])
      const first = registry.getByInstance(MOCK_INSTANCE)

      // A config change on an idle instance disposes its adapter and builds another under the
      // same id, so the id never leaves the live set and nothing re-points the stream by id alone.
      await registry.reconcile([mockInstance({ credentialsPath: path.join(home, 'b.json') })])
      expect(registry.getByInstance(MOCK_INSTANCE)).not.toBe(first)

      const input = providerTurnInput()
      await service.ensureRuntime({
        providerInstanceId: MOCK_INSTANCE,
        runtimeMode: input.runtimeMode,
        runtimePayload: {
          ...providerSessionPayload(input),
          modelSelection: { ...input.modelSelection, providerInstanceId: MOCK_INSTANCE },
        },
        sessionId: input.sessionId,
        runtimeEpoch: input.runtimeEpoch,
      })
      await service.drainRuntimeEvents()

      expect(seen.length).toBeGreaterThan(0)
    } finally {
      await service.shutdown()
      await rm(home, { force: true, recursive: true })
      fixture.close()
    }
  })
})

describe('ProviderAdapterRegistry leases', () => {
  it('does not replay deferred desired state after disposal begins', async () => {
    const registry = new ProviderAdapterRegistry({ drivers: [mockDriver] })
    await registry.reconcile([mockInstance({ responseText: 'before' })])
    const lease = registry.acquireInstanceLease(MOCK_INSTANCE)
    await registry.reconcile([mockInstance({ responseText: 'after' })])

    const disposal = registry.dispose()
    lease.release()
    await disposal
    await registry.reconcile([mockInstance({ responseText: 'after' })])

    expect(registry.listInstances()).toEqual([])
  })
})

const MOCK_INSTANCE = v.parse(providerInstanceIdSchema, 'mock-work')

function mockInstance(config: Record<string, unknown>) {
  return {
    config,
    displayLabel: MOCK_INSTANCE,
    driverKind: MOCK_DRIVER_KIND,
    providerInstanceId: MOCK_INSTANCE,
  }
}
