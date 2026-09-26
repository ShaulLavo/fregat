import { describe, expect, expectTypeOf, it } from 'vitest'
import * as v from 'valibot'
import {
  clientOrchestrationCommandSchema,
  type OrchestrationCommand,
  type PreparedProjectCreateCommand,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  ORCHESTRATION_WS_RESULTS,
  modelSelectionSchema,
  orchestrationCommandReceiptSchema,
  orchestrationDispatchResultSchema,
  orchestrationEventSchema,
  providerListResultSchema,
  orchestrationReplayEventsInputSchema,
  orchestrationShellSnapshotSchema,
  orchestrationWsClientMessageSchema,
  orchestrationWsServerMessageSchema,
  sessionTurnStartCommandSchema,
  environmentIdSchema,
  projectIdSchema,
  worktreeIdSchema,
  sessionIdSchema,
  scopedProjectKey,
  scopedWorktreeKey,
  scopedSessionKey,
  preparedProjectCreateCommandSchema,
  internalOrchestrationCommandSchema,
  orchestrationWorktreeSchema,
  sessionRuntimeStateSchema,
} from '../index'
// Not re-exported by the barrel: it has no consumer outside this package, and
// the request variant is reachable there through `orchestrationWsClientMessageSchema`.
import { orchestrationWsRequestSchema } from '../orchestration-ws'
import {
  ORCHESTRATION_EVENT_PAYLOADS,
  type OrchestrationEvent,
  type OrchestrationEventType,
} from '../orchestration-events'

/**
 * Type-derivation gate for the event catalog.
 *
 * These are declarations, not assertions: `tsc --noEmit` is what enforces them.
 * They exist because `orchestrationEventSchema` is derived from
 * `ORCHESTRATION_EVENT_PAYLOADS` through one assertion on an `Object.entries`
 * map, and that assertion is only honest while the union it rebuilds stays
 * discriminated. The 51 `Extract<OrchestrationEvent, { type: '…' }>` narrowings
 * in `apps/server` and `apps/web` are what would silently rot otherwise.
 */
type TypeEquals<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

// The parsed union's discriminator is exactly the catalog's key set.
const _catalogCoversTheUnion: TypeEquals<OrchestrationEvent['type'], OrchestrationEventType> = true

// …and it is still a union of literals, not `string`. If it widened, this
// assignment would start succeeding and tsc would report an unused directive.
// @ts-expect-error 'session.turn-started' is deliberately not an event
const _rejectsSyntheticTurnEvent: OrchestrationEventType = 'session.turn-started'

// Every member still carries the payload its own catalog row names — decorrelate
// them and `PayloadCorrelation` picks up `false`.
type PayloadCorrelation = {
  [TType in OrchestrationEventType]: TypeEquals<
    Extract<OrchestrationEvent, { type: TType }>['payload'],
    v.InferOutput<(typeof ORCHESTRATION_EVENT_PAYLOADS)[TType]>
  >
}[OrchestrationEventType]
const _payloadsStayCorrelated: TypeEquals<PayloadCorrelation, true> = true

void _catalogCoversTheUnion
void _rejectsSyntheticTurnEvent
void _payloadsStayCorrelated

const now = '2026-05-24T00:00:00.000Z'
const modelSelection = {
  providerInstanceId: 'codex',
  model: 'gpt-5-codex',
}

const projectId = v.parse(projectIdSchema, '31b506b8-25e5-5a83-99ee-e3b2c8c028c1')
const worktreeId = v.parse(worktreeIdSchema, '779e2945-261c-5b21-9717-1fccf5814896')
const sessionId = v.parse(sessionIdSchema, '89a91c76-14c6-41b8-9e10-d95abdc1807b')

it('types every internal project registration as a prepared command', () => {
  expectTypeOf<
    Extract<OrchestrationCommand, { type: 'project.create' }>
  >().toExtend<PreparedProjectCreateCommand>()
})

describe('session domain identity and ownership', () => {
  it.each([
    'not-an-id',
    'session-123',
    'claude:89a91c76-14c6-41b8-9e10-d95abdc1807b',
    '../session',
    'a/b',
  ])('rejects invalid domain identity %s', (id) => {
    expect(v.safeParse(projectIdSchema, id).success).toBe(false)
    expect(v.safeParse(worktreeIdSchema, id).success).toBe(false)
    expect(v.safeParse(sessionIdSchema, id).success).toBe(false)
  })

  it('retains raw UUID identity while scoping browser keys by environment', () => {
    const environmentA = v.parse(environmentIdSchema, '8dc1d24a-d26b-4a6c-b5e9-1d4f64747e1b')
    const environmentB = v.parse(environmentIdSchema, 'c4325313-04af-47e1-a14e-f52b489393cf')
    expect(scopedProjectKey({ environmentId: environmentA, projectId })).not.toBe(
      scopedProjectKey({ environmentId: environmentB, projectId }),
    )
    expect(scopedWorktreeKey({ environmentId: environmentA, worktreeId })).not.toBe(
      scopedWorktreeKey({ environmentId: environmentB, worktreeId }),
    )
    expect(scopedSessionKey({ environmentId: environmentA, sessionId })).not.toBe(
      scopedSessionKey({ environmentId: environmentB, sessionId }),
    )
    expect(sessionId).toBe('89a91c76-14c6-41b8-9e10-d95abdc1807b')
  })

  it('keeps registration input public and requires trusted IDs for the engine', () => {
    const intent = {
      type: 'project.create',
      commandId: 'register',
      title: 'Platform',
      workspaceRoot: '/workspace',
    }
    const parsed = v.parse(clientOrchestrationCommandSchema, intent)
    expect(
      v.parse(clientOrchestrationCommandSchema, { ...intent, workspaceRoot: '' }),
    ).toMatchObject({ workspaceRoot: '' })
    expect(parsed).not.toHaveProperty('projectId')
    expect(parsed).not.toHaveProperty('worktreeId')
    expect(
      v.safeParse(clientOrchestrationCommandSchema, { ...intent, projectId, worktreeId }).success,
    ).toBe(false)
    expect(v.safeParse(preparedProjectCreateCommandSchema, intent).success).toBe(false)
    expect(
      v.safeParse(preparedProjectCreateCommandSchema, {
        ...intent,
        projectId,
        worktreeId,
        canonicalPath: '/workspace',
        path: '/workspace',
        branch: null,
        registrationGeneration: 0,
        kind: 'current',
        ownership: 'protected',
        createdAt: now,
        updatedAt: now,
        repositoryKey: 'digest',
        repositoryKind: 'directory',
        repositoryIdentity: { source: 'path', canonical: '/workspace' },
        intentFingerprint: 'fingerprint',
      }).success,
    ).toBe(true)
  })

  it('requires a worktree for session creation and reserves claims for the server', () => {
    const create = {
      type: 'session.create',
      commandId: 'create',
      sessionId,
      title: 'Session',
      modelSelection,
    }
    expect(v.safeParse(clientOrchestrationCommandSchema, create).success).toBe(false)
    expect(
      v.safeParse(clientOrchestrationCommandSchema, {
        ...create,
        worktreeTarget: { kind: 'current', worktreeId },
      }).success,
    ).toBe(true)
    const claim = {
      type: 'session.provider-start.claim',
      commandId: 'claim',
      sessionId,
      turnId: 'turn',
      generation: 1,
      observedSequence: 2,
      runtimeEpoch: 'epoch',
      createdAt: now,
    }
    expect(v.safeParse(clientOrchestrationCommandSchema, claim).success).toBe(false)
    expect(v.safeParse(internalOrchestrationCommandSchema, claim).success).toBe(true)
  })

  it('keeps worktree checkout paths separate from runtime identity', () => {
    expect(
      v.safeParse(orchestrationWorktreeSchema, {
        id: worktreeId,
        projectId,
        registrationGeneration: 0,
        canonicalPath: '/workspace',
        path: '/workspace',
        branch: null,
        kind: 'current',
        ownership: 'protected',
        createdAt: now,
        updatedAt: now,
        retiredAt: null,
        lifecycle: { state: 'ready' },
        operationId: null,
        baseWorktreeId: null,
        baseCommit: null,
        headCommit: null,
        metadataVersion: 0,
        pathKind: 'legacy',
        activeTerminalCount: 0,
        terminalOwnershipUnknown: false,
        externalDriverUnverified: false,
        removedAt: null,
        worktreeCreationCapability: { allowed: true },
        cleanupEligibility: {
          reason: 'protected',
          nonDeletedSessionCount: 0,
          canResolveMissing: false,
        },
      }).success,
    ).toBe(true)
    const runtime = v.parse(sessionRuntimeStateSchema, {
      sessionId,
      status: 'ready',
      providerName: 'claude',
      providerBindingHandle: `claude:${sessionId}`,
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'epoch',
      activeTurnId: null,
      lastError: null,
      updatedAt: now,
    })
    expect(runtime.sessionId).toBe(sessionId)
    expect(runtime.providerBindingHandle).toBe(`claude:${sessionId}`)
  })

  it('requires durable typed registration results, including a zero-event head', () => {
    const receipt = {
      commandId: 'register',
      commandType: 'project.create',
      aggregateKind: 'project',
      aggregateId: projectId,
      acceptedAt: now,
      intentFingerprint: 'fingerprint',
      status: 'accepted',
      resultSequence: 0,
      error: null,
      result: { projectId, worktreeId, disposition: 'existing-worktree' },
    }
    expect(v.parse(orchestrationCommandReceiptSchema, JSON.parse(JSON.stringify(receipt)))).toEqual(
      receipt,
    )
    expect(
      v.safeParse(orchestrationCommandReceiptSchema, { ...receipt, result: null }).success,
    ).toBe(false)
    expect(
      v.safeParse(orchestrationCommandReceiptSchema, { ...receipt, resultSequence: null }).success,
    ).toBe(false)
    expect(
      v.safeParse(orchestrationCommandReceiptSchema, { ...receipt, commandType: 'session.create' })
        .success,
    ).toBe(false)
    expect(
      v.safeParse(orchestrationCommandReceiptSchema, {
        ...receipt,
        status: 'rejected',
        result: null,
        resultSequence: null,
        error: 'Refused',
      }).success,
    ).toBe(true)
  })
})

describe('orchestration contracts', () => {
  it('validates model selection with the Codex default provider instance shape', () => {
    const parsed = v.parse(modelSelectionSchema, modelSelection as unknown)

    expect(parsed.providerInstanceId as string).toBe('codex')
    expect(parsed.model).toBe('gpt-5-codex')
    expect(() =>
      v.parse(modelSelectionSchema, {
        providerInstanceId: 'not a slug',
        model: 'gpt-5-codex',
      } as unknown),
    ).toThrow()
  })

  it('validates Phase 7 provider snapshots with open driver and instance ids', () => {
    const parsed = v.parse(providerListResultSchema, {
      providers: [
        {
          ...DEFAULT_CODEX_PROVIDER_SETTINGS,
          auth: { status: 'unknown' },
          checkedAt: now,
          installed: true,
          models: [
            {
              capabilities: null,
              isCustom: false,
              name: 'GPT-5.5',
              shortName: 'GPT-5.5',
              slug: 'gpt-5.5',
            },
          ],
          status: 'ready',
          version: 'codex-cli 0.130.0',
        },
      ],
    })

    expect(parsed.providers[0]?.providerInstanceId as string).toBe('codex')
    expect(parsed.providers[0]?.driverKind as string).toBe('codex')
    expect(parsed.providers[0]?.traits.supportsStreaming).toBe(true)
  })

  it('validates Phase 1 client commands and defaults empty attachments', () => {
    const command = v.parse(sessionTurnStartCommandSchema, {
      commandId: 'cmd-1',
      type: 'session.turn.start',
      sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      turnId: 'turn-1',
      message: {
        messageId: 'message-1',
        role: 'user',
        text: 'Build the first slice',
      },
      createdAt: now,
    })

    expect(command.message.attachments).toEqual([])
    expect(command.runtimeMode).toBe('full-access')
    expect(command.interactionMode).toBe('default')
  })

  it('validates T3-style turn bootstrap create-session metadata', () => {
    const command = v.parse(sessionTurnStartCommandSchema, {
      commandId: 'cmd-1',
      type: 'session.turn.start',
      sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      turnId: 'turn-1',
      message: {
        messageId: 'message-1',
        role: 'user',
        text: 'Build the first slice',
      },
      bootstrap: {
        createSession: {
          createdAt: now,
          modelSelection,
          worktreeTarget: { kind: 'current', worktreeId: '22755017-f511-5766-8288-8f6328097bd2' },
          title: 'Build the first slice',
        },
      },
      createdAt: now,
    })

    expect(command.bootstrap?.createSession?.worktreeTarget.worktreeId as string).toBe(
      '22755017-f511-5766-8288-8f6328097bd2',
    )
    expect(command.bootstrap?.createSession?.runtimeMode).toBe('full-access')
    expect(command.bootstrap?.createSession?.interactionMode).toBe('default')
  })

  it('leaves project creation unasked about making the workspace root', () => {
    const command = v.parse(clientOrchestrationCommandSchema, {
      commandId: 'cmd-1',
      type: 'project.create',
      title: 'Platform',
      workspaceRoot: '/workspace/platform',
    })

    expect(
      command.type === 'project.create' ? command.createWorkspaceRootIfMissing : 'wrong command',
    ).toBeUndefined()
  })

  it('lets project creation opt in to making the workspace root', () => {
    const command = v.parse(clientOrchestrationCommandSchema, {
      commandId: 'cmd-1',
      type: 'project.create',
      title: 'Platform',
      workspaceRoot: '/workspace/platform',
      createWorkspaceRootIfMissing: true,
    })

    expect(command.type === 'project.create' && command.createWorkspaceRootIfMissing).toBe(true)
  })

  it('rejects proposed-plan client commands deferred beyond Phase 1', () => {
    expect(() =>
      v.parse(clientOrchestrationCommandSchema, {
        commandId: 'cmd-2',
        type: 'session.proposed-plan.accept',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        planId: 'plan-1',
        createdAt: now,
      }),
    ).toThrow()
  })

  it('builds one variant member per catalog row, in catalog order', () => {
    const catalog = Object.entries(ORCHESTRATION_EVENT_PAYLOADS)
    const options = orchestrationEventSchema.options

    expect(options).toHaveLength(catalog.length)

    for (const [index, [type, payload]] of catalog.entries()) {
      expect(options[index]?.entries.type.literal).toBe(type)
      // Identity, not shape: the row's schema object is the one the parser runs.
      expect(options[index]?.entries.payload).toBe(payload)
    }
  })

  it('keeps the catalog free of synthetic turn lifecycle events', () => {
    const eventTypes = Object.keys(ORCHESTRATION_EVENT_PAYLOADS)

    expect(eventTypes).not.toContain('session.turn-started')
    expect(eventTypes).not.toContain('session.turn-completed')
    expect(eventTypes).not.toContain('session.turn-failed')
  })

  it('round-trips domain events through JSON and contract validation', () => {
    const event = {
      sequence: 7,
      eventId: 'event-7',
      aggregateKind: 'session',
      aggregateId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      occurredAt: now,
      commandId: 'cmd-1',
      causationEventId: null,
      correlationId: 'cmd-1',
      actorKind: 'client',
      metadata: {},
      type: 'session.turn-start-requested',
      payload: {
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        turnId: 'turn-1',
        messageId: 'message-1',
        runtimeMode: 'full-access',
        interactionMode: 'default',
        createdAt: now,
      },
    } as const

    const parsed = v.parse(orchestrationEventSchema, event)
    const serialized = JSON.stringify(parsed)

    expect(v.parse(orchestrationEventSchema, JSON.parse(serialized))).toEqual(parsed)
  })

  it('validates shell snapshots for summary lookup paths', () => {
    const snapshot = v.parse(orchestrationShellSnapshotSchema, {
      snapshotSequence: 7,
      projects: [
        {
          id: '22755017-f511-5766-8288-8f6328097bd2',
          title: 'Platform',
          repositoryKey: 'repository-key',
          repositoryKind: 'directory',
          repositoryIdentity: { source: 'path', canonical: '/workspace' },
          defaultModelSelection: modelSelection,
          createdAt: now,
          updatedAt: now,
        },
      ],
      worktrees: [],
      sessions: [
        {
          id: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
          worktreeId: '22755017-f511-5766-8288-8f6328097bd2',
          title: 'Phase 1',
          modelSelection,
          runtimeMode: 'full-access',
          interactionMode: 'default',
          origin: 'platform',
          attentionState: 'settled',
          attentionReason: null,
          acknowledgedFailureThroughSequence: null,
          hasError: false,
          latestTurn: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          runtime: null,
          latestUserMessageAt: now,
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          hasActionableProposedPlan: false,
        },
      ],
      updatedAt: now,
    })

    expect(snapshot.snapshotSequence).toBe(7)
    expect(snapshot.sessions[0]?.pendingApprovalCount).toBe(0)
  })

  it('validates replay input with sequence and optional aggregate filters', () => {
    const replayInput = v.parse(orchestrationReplayEventsInputSchema, {
      afterSequence: 7,
      aggregateKind: 'session',
      aggregateId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
    } as unknown)

    expect(replayInput.afterSequence).toBe(7)
    expect(replayInput.aggregateKind).toBe('session')
    expect(replayInput.aggregateId as string).toBe('35ecdd23-f0b6-593a-8d5b-108982c1126d')
    expect(replayInput.sessionId as string).toBe('35ecdd23-f0b6-593a-8d5b-108982c1126d')
  })

  it('validates command receipts for idempotent dispatch results', () => {
    const receipt = v.parse(orchestrationCommandReceiptSchema, {
      commandId: 'cmd-1',
      commandType: 'session.turn.start',
      aggregateKind: 'session',
      aggregateId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
      acceptedAt: now,
      resultSequence: 7,
      result: null,
      intentFingerprint: 'fingerprint',
      status: 'accepted',
      error: null,
    })

    expect(receipt.commandType).toBe('session.turn.start')
    expect(receipt.resultSequence).toBe(7)
  })

  it('validates T3-style orchestration WebSocket RPC messages', () => {
    const request = v.parse(orchestrationWsClientMessageSchema, {
      kind: 'request',
      requestId: 'request-1',
      method: 'dispatchCommand',
      command: {
        commandId: 'cmd-1',
        type: 'session.turn.start',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        turnId: 'turn-1',
        message: {
          messageId: 'message-1',
          role: 'user',
          text: 'Build the first slice',
        },
        createdAt: now,
      },
    })
    const subscription = v.parse(orchestrationWsClientMessageSchema, {
      afterSequence: 7,
      kind: 'subscribe',
      method: 'subscribeSession',
      subscriptionId: 'subscription-1',
      sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
    })
    const response = v.parse(orchestrationWsServerMessageSchema, {
      data: { deduped: false, sequence: 8 },
      kind: 'response',
      ok: true,
      requestId: 'request-1',
    })

    expect(request.kind).toBe('request')
    expect(subscription.kind).toBe('subscribe')
    expect(response.kind).toBe('response')
  })

  it('carries a backwards page read with or without a boundary', () => {
    const firstPage = v.parse(orchestrationWsClientMessageSchema, {
      kind: 'request',
      requestId: 'request-1',
      method: 'sessionDetailPage',
      input: { sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d' },
    })
    const continuation = v.parse(orchestrationWsClientMessageSchema, {
      kind: 'request',
      requestId: 'request-2',
      method: 'sessionDetailPage',
      input: {
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        beforeMessage: { createdAt: now, id: 'message-1' },
        beforeActivity: null,
        limit: 50,
      },
    })

    expect(firstPage.kind === 'request' && firstPage.method).toBe('sessionDetailPage')
    // No defaults on the wire: the frame says exactly what was asked for, and
    // the server's own input schema is the single place limits are decided.
    expect(
      firstPage.kind === 'request' && firstPage.method === 'sessionDetailPage'
        ? firstPage.input.limit
        : 'unset',
    ).toBeUndefined()
    expect(
      continuation.kind === 'request' && continuation.method === 'sessionDetailPage'
        ? continuation.input.beforeMessage?.id
        : null,
    ).toBe('message-1')
  })

  it('rejects a page read whose limit is past the server ceiling', () => {
    expect(() =>
      v.parse(orchestrationWsClientMessageSchema, {
        kind: 'request',
        requestId: 'request-1',
        method: 'sessionDetailPage',
        input: { sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d', limit: 10_000 },
      }),
    ).toThrow()
  })
})

describe('session lifecycle contracts', () => {
  it('accepts the settle, snooze and pin client commands', () => {
    const commands = [
      {
        commandId: 'cmd-1',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.settle',
      },
      {
        commandId: 'cmd-2',
        reason: 'user',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.unsettle',
      },
      {
        commandId: 'cmd-3',
        snoozedUntil: now,
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.snooze',
      },
      {
        commandId: 'cmd-4',
        reason: 'user',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.unsnooze',
      },
      {
        commandId: 'cmd-5',
        orderKey: 'm',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.pin',
      },
      {
        commandId: 'cmd-6',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.unpin',
      },
      {
        commandId: 'cmd-7',
        orderKey: 'mn',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.pin.reorder',
      },
    ]

    for (const command of commands) {
      expect(v.parse(clientOrchestrationCommandSchema, command as unknown)).toMatchObject({
        type: command.type,
      })
    }
  })

  it('refuses to let a client forge an activity reset', () => {
    expect(() =>
      v.parse(clientOrchestrationCommandSchema, {
        commandId: 'cmd-1',
        reason: 'activity',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        type: 'session.unsettle',
      } as unknown),
    ).toThrow()
  })

  it('refuses a pin order key that would corrupt the arranged order', () => {
    for (const orderKey of ['', 'M', 'm1', 'ma']) {
      expect(() =>
        v.parse(clientOrchestrationCommandSchema, {
          commandId: 'cmd-1',
          orderKey,
          sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
          type: 'session.pin.reorder',
        } as unknown),
      ).toThrow()
    }
  })

  it('round-trips the lifecycle events', () => {
    const payloads = {
      'session.pin-reordered': {
        orderKey: 'm',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
      'session.pinned': {
        pinOrderKey: 'm',
        pinnedAt: now,
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
      'session.settled': {
        acknowledgedFailureThroughSequence: null,
        settledAt: now,
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
      'session.snoozed': {
        snoozedAt: now,
        snoozedUntil: now,
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
      'session.unpinned': { sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d', updatedAt: now },
      'session.unsettled': {
        reason: 'activity',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
      'session.unsnoozed': {
        reason: 'activity',
        sessionId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        updatedAt: now,
      },
    }

    for (const [type, payload] of Object.entries(payloads)) {
      const parsed = v.parse(orchestrationEventSchema, {
        actorKind: 'client',
        aggregateId: '35ecdd23-f0b6-593a-8d5b-108982c1126d',
        aggregateKind: 'session',
        causationEventId: null,
        commandId: 'cmd-1',
        correlationId: 'cmd-1',
        eventId: 'event-1',
        metadata: {},
        occurredAt: now,
        payload,
        sequence: 1,
        type,
      } as unknown)

      expect(parsed.payload).toEqual(payload)
    }
  })

  it('types the dispatch result the wire actually carries', () => {
    const result = v.parse(orchestrationDispatchResultSchema, {
      deduped: false,
      sequence: 8,
      result: null,
    } as unknown)

    expect(result.deduped).toBe(false)
    expect(result.sequence).toBe(8)
    expect(() =>
      v.parse(orchestrationDispatchResultSchema, { deduped: false, sequence: -1 } as unknown),
    ).toThrow()
    expect(() => v.parse(orchestrationDispatchResultSchema, { sequence: 8 } as unknown)).toThrow()
  })

  it('has exactly one result schema per request method', () => {
    // The response envelope carries no method, so this map is the only place
    // the payload shape is pinned. A method added to the request variant
    // without an entry here would ship an unchecked `data` again.
    const methods = orchestrationWsRequestSchema.options.map(
      (option) => option.entries.method.literal,
    )

    expect(methods.toSorted()).toEqual(Object.keys(ORCHESTRATION_WS_RESULTS).sort())
  })
})
