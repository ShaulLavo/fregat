import { Database } from 'bun:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  orderKeyBetween,
  orchestrationCommandSchema,
  type OrchestrationCommand,
} from '@workspace/contracts'
import { migrateOrchestrationDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { projectionSessions } from '../../db/schema'
import { OrchestrationEngine } from '../engine'

const modelSelection = { model: 'gpt-5-codex', providerInstanceId: 'codex' }
const fixtures: Array<{ close: () => void }> = []
let commandCounter = 0

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
  commandCounter = 0
})

describe('settle guards', () => {
  it.each(['queued', 'claimed', 'runtime-live'] as const)(
    'refuses to archive a session with %s work',
    async (state) => {
      const { database, engine } = await createEngineWithSession()
      const sessionId = '00000000-0000-4000-8000-000000000001'
      if (state === 'runtime-live') await engine.dispatch(sessionSetCommand('running'))
      if (state !== 'runtime-live') await engine.dispatch(turnStartCommand())
      if (state === 'claimed') {
        const turn = (await engine.readModelSnapshot()).sessions.get(sessionId)?.latestTurn
        if (!turn) throw new TypeError('Missing queued turn')
        await engine.dispatch(
          command({
            type: 'session.provider-start.claim',
            sessionId,
            turnId: turn.turnId,
            observedSequence: turn.providerStartSequence,
            generation: 1,
            runtimeEpoch: 'epoch-claimed',
            createdAt: '2026-09-05T12:00:00.000Z',
          }),
        )
      }
      const before = await engine.shellSnapshot()

      await expect(
        engine.dispatch(command({ sessionId, type: 'session.archive' })),
      ).rejects.toMatchObject({
        code:
          state === 'runtime-live'
            ? 'orchestration.SESSION_RUNTIME_ACTIVE'
            : 'orchestration.SESSION_QUEUED_TURN_START',
        status: 409,
      })

      expect(sessionRow(database).archivedAt).toBeNull()
      expect(await engine.shellSnapshot()).toEqual(before)
    },
  )

  it('refuses to settle a session whose session is alive', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(sessionSetCommand('running'))

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_RUNTIME_ACTIVE',
      status: 409,
    })
  })

  it('refuses to settle a session with an open approval request', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(activityCommand('approval.requested', 'approval'))

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_BLOCKING_REQUEST',
      status: 409,
    })
  })

  it('keeps refusing to settle while unrelated activity traffic flows', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(activityCommand('approval.requested', 'approval'))
    for (let index = 0; index < 20; index += 1) {
      await engine.dispatch(activityCommand('tool.started', 'tool', null))
    }

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_BLOCKING_REQUEST',
      status: 409,
    })
  })

  it('settles once the request resolves', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(activityCommand('approval.requested', 'approval'))
    await engine.dispatch(activityCommand('approval.resolved', 'info'))

    await engine.dispatch(settleCommand())

    expect(sessionRow(database).settledOverride).toBe('settled')
  })

  it('settles once a respond failure proves the request is gone', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(activityCommand('user-input.requested', 'info'))
    await engine.dispatch(
      activityCommand('provider.user-input.respond.failed', 'error', {
        detail: 'Stale pending user-input request: request-1. Restart the turn to continue.',
        requestId: 'request-1',
      }),
    )

    await engine.dispatch(settleCommand())

    expect(sessionRow(database).settledOverride).toBe('settled')
  })

  it('keeps refusing when the respond failure was merely transient', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(activityCommand('user-input.requested', 'info'))
    await engine.dispatch(
      activityCommand('provider.user-input.respond.failed', 'error', {
        detail: 'Provider socket hung up',
        requestId: 'request-1',
      }),
    )

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_BLOCKING_REQUEST',
    })
  })

  it('refuses to settle or snooze a session whose turn is queued but unadopted', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(turnStartCommand())

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_QUEUED_TURN_START',
      status: 409,
    })
    await expect(engine.dispatch(snoozeCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_QUEUED_TURN_START',
    })
  })

  it('refuses snooze while a queued prompt has a live runtime', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(turnStartCommand())
    await engine.dispatch(sessionSetCommand('running'))

    await expect(engine.dispatch(snoozeCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_QUEUED_TURN_START',
    })

    expect(sessionRow(database).snoozedUntil).toBeNull()
  })

  it('refuses a snooze whose wake time is not in the future', async () => {
    const { engine } = await createEngineWithSession()

    await expect(
      engine.dispatch(snoozeCommand({ snoozedUntil: '1999-01-01T00:00:00.000Z' })),
    ).rejects.toMatchObject({ code: 'orchestration.SESSION_SNOOZE_NOT_FUTURE', status: 400 })
    await expect(
      engine.dispatch(snoozeCommand({ snoozedUntil: 'not-a-timestamp' })),
    ).rejects.toMatchObject({ code: 'orchestration.SESSION_SNOOZE_NOT_FUTURE' })
  })

  it('refuses to reorder a session that is not pinned', async () => {
    const { engine } = await createEngineWithSession()

    await expect(engine.dispatch(pinReorderCommand('m'))).rejects.toMatchObject({
      code: 'orchestration.SESSION_NOT_PINNED',
      status: 409,
    })
  })

  it('refuses every lifecycle command on an archived session', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(
      command({ sessionId: '00000000-0000-4000-8000-000000000001', type: 'session.archive' }),
    )

    await expect(engine.dispatch(settleCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_ARCHIVED',
    })
    await expect(engine.dispatch(snoozeCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_ARCHIVED',
    })
    await expect(engine.dispatch(pinCommand())).rejects.toMatchObject({
      code: 'orchestration.SESSION_ARCHIVED',
    })
  })
})

describe('settle and snooze projection', () => {
  it('projects a settle and then clears it on unsettle', async () => {
    const { database, engine } = await createEngineWithSession()

    await engine.dispatch(settleCommand())
    const settled = sessionRow(database)

    expect(settled.settledOverride).toBe('settled')
    expect(settled.settledAt).toEqual(expect.any(String))

    await engine.dispatch(
      command({
        reason: 'user',
        sessionId: '00000000-0000-4000-8000-000000000001',
        type: 'session.unsettle',
      }),
    )
    const unsettled = sessionRow(database)

    expect(unsettled.settledOverride).toBe('active')
    expect(unsettled.settledAt).toBeNull()
  })

  it('projects a duplicate settle as a no-op', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())
    const first = sessionRow(database)
    await tick()

    await engine.dispatch(settleCommand())
    const second = sessionRow(database)

    expect(second.settledAt).toBe(first.settledAt)
    expect(second.updatedAt).toBe(first.updatedAt)
    const settledEvents = (await engine.replay({ afterSequence: 0 })).events.filter(
      (event) => event.type === 'session.settled',
    )
    expect(settledEvents).toHaveLength(2)
  })

  it('projects a duplicate snooze to the same wake time as a no-op', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())
    const first = sessionRow(database)
    await tick()

    await engine.dispatch(snoozeCommand())
    const second = sessionRow(database)

    expect(second.snoozedAt).toBe(first.snoozedAt)
    expect(second.updatedAt).toBe(first.updatedAt)
  })

  it('stamps fresh timestamps when the snooze moves to a different wake time', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())
    const first = sessionRow(database)
    await tick()

    await engine.dispatch(snoozeCommand({ snoozedUntil: futureWakeTime(2) }))
    const second = sessionRow(database)

    expect(second.snoozedUntil).toBe(futureWakeTime(2))
    expect(second.snoozedAt).not.toBe(first.snoozedAt)
  })

  it('clears the snooze on unsnooze', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())

    await engine.dispatch(
      command({
        reason: 'user',
        sessionId: '00000000-0000-4000-8000-000000000001',
        type: 'session.unsnooze',
      }),
    )

    expect(sessionRow(database).snoozedUntil).toBeNull()
    expect(sessionRow(database).snoozedAt).toBeNull()
  })
})

describe('activity auto-unsettles', () => {
  it('wakes a settled session when a session comes alive, with reason activity', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())

    await engine.dispatch(sessionSetCommand('starting'))

    expect(sessionRow(database).settledOverride).toBeNull()
    expect(await unsettledReasons(engine)).toEqual(['activity'])
  })

  it('leaves a settled session alone when the session merely reports a late status', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())

    await engine.dispatch(sessionSetCommand('stopped'))

    expect(sessionRow(database).settledOverride).toBe('settled')
    expect(await unsettledReasons(engine)).toEqual([])
  })

  it('clears snooze when a runtime starts new work', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())

    await engine.dispatch(sessionSetCommand('starting'))

    expect(sessionRow(database).snoozedUntil).toBeNull()
  })

  it('wakes a settled session when an approval request arrives', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())

    await engine.dispatch(activityCommand('approval.requested', 'approval'))

    expect(sessionRow(database).settledOverride).toBeNull()
    expect(await unsettledReasons(engine)).toEqual(['activity'])
  })

  it('leaves a settled session alone for ordinary activity', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())

    await engine.dispatch(activityCommand('tool.call', 'tool'))

    expect(sessionRow(database).settledOverride).toBe('settled')
  })

  it('spends both the settle and the snooze when the user sends a message', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())
    await engine.dispatch(
      command({
        reason: 'user',
        sessionId: '00000000-0000-4000-8000-000000000001',
        type: 'session.unsettle',
      }),
    )

    await engine.dispatch(turnStartCommand())
    const row = sessionRow(database)

    expect(row.settledOverride).toBeNull()
    expect(row.snoozedUntil).toBeNull()
    expect(await unsettledReasons(engine)).toEqual(['user', 'activity'])
  })
})

describe('pinning', () => {
  it('promotes a settled, snoozed session and clears both with reason user', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())
    await engine.dispatch(settleCommand())

    await engine.dispatch(pinCommand({ orderKey: 'm' }))
    const row = sessionRow(database)

    expect(row.pinnedAt).toEqual(expect.any(String))
    expect(row.pinOrderKey).toBe('m')
    expect(row.settledOverride).toBe('active')
    expect(row.snoozedUntil).toBeNull()
    expect(await unsettledReasons(engine)).toEqual(['user'])
  })

  it('keeps the key the user already placed when a re-pin races in', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand({ orderKey: 'm' }))
    const first = sessionRow(database)
    await tick()

    await engine.dispatch(pinCommand({ orderKey: 'c' }))
    const second = sessionRow(database)

    expect(second.pinOrderKey).toBe('m')
    expect(second.pinnedAt).toBe(first.pinnedAt)
    expect(second.updatedAt).toBe(first.updatedAt)
  })

  it('clears the pin when the session is settled by hand', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand({ orderKey: 'm' }))

    await engine.dispatch(settleCommand())
    const row = sessionRow(database)

    expect(row.pinnedAt).toBeNull()
    expect(row.pinOrderKey).toBeNull()
    expect(row.settledOverride).toBe('settled')
  })

  it('drops the key on unpin so a later pin starts from the tail', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand({ orderKey: 'm' }))

    await engine.dispatch(
      command({ sessionId: '00000000-0000-4000-8000-000000000001', type: 'session.unpin' }),
    )
    const row = sessionRow(database)

    expect(row.pinnedAt).toBeNull()
    expect(row.pinOrderKey).toBeNull()
  })

  it('writes exactly one key to one row for a drag across three pinned sessions', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(sessionCreateCommand('19e557ea-fa7c-515a-9051-e990f8aa54c6'))
    await engine.dispatch(sessionCreateCommand('287d7571-b9f0-5489-8ea1-7dc0decb92ee'))
    await engine.dispatch(
      pinCommand({ orderKey: 'b', sessionId: '00000000-0000-4000-8000-000000000001' }),
    )
    await engine.dispatch(
      pinCommand({ orderKey: 'd', sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6' }),
    )
    await engine.dispatch(
      pinCommand({ orderKey: 'f', sessionId: '287d7571-b9f0-5489-8ea1-7dc0decb92ee' }),
    )
    const before = pinnedOrder(database)
    expect(before).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '19e557ea-fa7c-515a-9051-e990f8aa54c6',
      '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
    ])

    const orderKey = orderKeyBetween('b', 'd')
    expect(orderKey).not.toBeNull()
    await engine.dispatch(pinReorderCommand(orderKey!, '287d7571-b9f0-5489-8ea1-7dc0decb92ee'))

    expect(pinnedOrder(database)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
      '19e557ea-fa7c-515a-9051-e990f8aa54c6',
    ])
    expect(
      pinnedRows(database).filter(
        (row) => row.sessionId !== '287d7571-b9f0-5489-8ea1-7dc0decb92ee',
      ),
    ).toEqual([
      expect.objectContaining({
        pinOrderKey: 'b',
        sessionId: '00000000-0000-4000-8000-000000000001',
      }),
      expect.objectContaining({
        pinOrderKey: 'd',
        sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6',
      }),
    ])
    expect(
      (await engine.replay({ afterSequence: 0 })).events.filter(
        (e) => e.type === 'session.pin-reordered',
      ),
    ).toHaveLength(1)
  })

  it('keeps the order stable across repeated splits of the same gap', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(sessionCreateCommand('19e557ea-fa7c-515a-9051-e990f8aa54c6'))
    await engine.dispatch(
      pinCommand({ orderKey: 'b', sessionId: '00000000-0000-4000-8000-000000000001' }),
    )
    await engine.dispatch(
      pinCommand({ orderKey: 'd', sessionId: '19e557ea-fa7c-515a-9051-e990f8aa54c6' }),
    )

    // Twenty drags onto the same edge: the fractional key keeps splitting the
    // gap, and the row that was dragged is on top every single time.
    for (let step = 0; step < 20; step += 1) {
      const rows = pinnedRows(database)
      const moved = rows.at(-1)!
      const orderKey = orderKeyBetween(null, rows[0]!.pinOrderKey)
      expect(orderKey).not.toBeNull()

      await engine.dispatch(pinReorderCommand(orderKey!, moved.sessionId))

      expect(pinnedOrder(database)[0]).toBe(moved.sessionId)
    }
  })

  it('projects a duplicate reorder onto the same key as a no-op', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand({ orderKey: 'm' }))
    await engine.dispatch(pinReorderCommand('n'))
    const first = sessionRow(database)
    await tick()

    await engine.dispatch(pinReorderCommand('n'))

    expect(sessionRow(database).updatedAt).toBe(first.updatedAt)
  })
})

describe('actionable work clears lifecycle overlays', () => {
  it.each(['settle', 'snooze', 'archive'] as const)(
    'an approval clears %s in the same committed batch',
    async (overlay) => {
      const { database, engine } = await createEngineWithSession()
      const parked = {
        type: `session.${overlay}`,
        sessionId: '00000000-0000-4000-8000-000000000001',
        snoozedUntil: futureWakeTime(),
      }
      await engine.dispatch(command(parked))
      const before = (await engine.replay({ afterSequence: 0 })).events.at(-1)?.sequence ?? 0
      await engine.dispatch(activityCommand('approval.requested', 'approval'))
      expect(sessionRow(database)).toMatchObject({
        archivedAt: null,
        settledOverride: null,
        snoozedUntil: null,
        attentionState: 'needs-input',
        attentionReason: 'approval',
      })
      const events = (await engine.replay({ afterSequence: before })).events
      expect(new Set(events.map((event) => event.commandId)).size).toBe(1)
    },
  )

  it('settling acknowledges one failure while a later failure raises attention again', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(sessionSetCommand('error'))
    await engine.dispatch(settleCommand())
    const acknowledged = sessionRow(database).acknowledgedFailureThroughSequence
    expect(acknowledged).toBeGreaterThan(0)
    await engine.dispatch(activityCommand('tool.started', 'tool', null))
    expect(sessionRow(database)).toMatchObject({ attentionState: 'settled', hasError: false })
    await engine.dispatch(sessionSetCommand('error'))
    expect(sessionRow(database)).toMatchObject({
      attentionState: 'needs-input',
      attentionReason: 'failure',
      hasError: true,
      settledOverride: null,
      acknowledgedFailureThroughSequence: acknowledged,
    })
  })
})

async function unsettledReasons(engine: OrchestrationEngine) {
  return (await engine.replay({ afterSequence: 0 })).events.flatMap((event) =>
    event.type === 'session.unsettled' ? [event.payload.reason] : [],
  )
}

function sessionRow(database: TestDatabase, sessionId = '00000000-0000-4000-8000-000000000001') {
  return database
    .select()
    .from(projectionSessions)
    .where(eq(projectionSessions.sessionId, sessionId))
    .get()!
}

/** The pinned block as the client renders it: keys compared as plain strings. */
function pinnedRows(database: TestDatabase) {
  return database
    .select()
    .from(projectionSessions)
    .all()
    .filter((row) => row.pinnedAt !== null)
    .toSorted((left, right) => comparePinOrderKeys(left.pinOrderKey, right.pinOrderKey))
}

function comparePinOrderKeys(left: string | null, right: string | null) {
  if ((left ?? '') < (right ?? '')) return -1
  if ((left ?? '') > (right ?? '')) return 1

  return 0
}

function pinnedOrder(database: TestDatabase) {
  return pinnedRows(database).map((row) => row.sessionId)
}

/**
 * Server-clock stamps have millisecond resolution, so two dispatches in the
 * same tick are indistinguishable. Advancing the clock is what makes
 * "re-emitted the original timestamp" a real observation instead of a
 * coincidence.
 */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function futureWakeTime(days = 1) {
  return `2099-01-0${days}T00:00:00.000Z`
}

function settleCommand(sessionId = '00000000-0000-4000-8000-000000000001') {
  return command({ sessionId, type: 'session.settle' })
}

function snoozeCommand(input: { snoozedUntil?: string; sessionId?: string } = {}) {
  return command({
    snoozedUntil: input.snoozedUntil ?? futureWakeTime(),
    sessionId: input.sessionId ?? '00000000-0000-4000-8000-000000000001',
    type: 'session.snooze',
  })
}

function pinCommand(input: { orderKey?: string; sessionId?: string } = {}) {
  return command({
    ...(input.orderKey ? { orderKey: input.orderKey } : {}),
    sessionId: input.sessionId ?? '00000000-0000-4000-8000-000000000001',
    type: 'session.pin',
  })
}

function pinReorderCommand(orderKey: string, sessionId = '00000000-0000-4000-8000-000000000001') {
  return command({ orderKey, sessionId, type: 'session.pin.reorder' })
}

function sessionSetCommand(status: string, sessionId = '00000000-0000-4000-8000-000000000001') {
  return command({
    createdAt: '2026-06-01T00:00:00.000Z',
    runtime: {
      activeTurnId: null,
      lastError: null,
      providerInstanceId: 'codex',
      providerName: 'codex',
      providerBindingHandle: 'provider-session-1',
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'epoch-fixture',
      runtimeMode: 'full-access',
      status,
      sessionId,
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    sessionId,
    type: 'session.runtime.set',
  })
}

function activityCommand(
  kind: string,
  tone: string,
  payload: unknown = { requestId: 'request-1' },
) {
  return command({
    activity: {
      createdAt: '2026-06-01T00:00:00.000Z',
      id: `activity-${(commandCounter += 1)}`,
      kind,
      payload,
      summary: kind,
      sessionId: '00000000-0000-4000-8000-000000000001',
      tone,
      turnId: null,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    sessionId: '00000000-0000-4000-8000-000000000001',
    type: 'session.activity.append',
  })
}

function turnStartCommand(sessionId = '00000000-0000-4000-8000-000000000001') {
  return command({
    interactionMode: 'default',
    message: { messageId: `message-${(commandCounter += 1)}`, role: 'user', text: 'Ship it' },
    runtimeMode: 'full-access',
    sessionId,
    turnId: `turn-${commandCounter}`,
    type: 'session.turn.start',
  })
}

function sessionCreateCommand(sessionId: string) {
  return command({
    worktreeTarget: { kind: 'current', worktreeId: '20000000-0000-4000-8000-000000000001' },

    interactionMode: 'default',
    modelSelection,

    runtimeMode: 'full-access',
    sessionId,
    title: 'Phase 2',
    type: 'session.create',
  })
}

/** Every command needs its own id; the engine dedupes by receipt otherwise. */
function command(value: Record<string, unknown>) {
  commandCounter += 1

  return v.parse(orchestrationCommandSchema, {
    commandId: `cmd-${commandCounter}`,
    ...value,
  }) as OrchestrationCommand
}

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

async function createEngineWithSession() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)
  fixtures.push({ close: () => sqlite.close() })
  const engine = new OrchestrationEngine(database)

  await engine.dispatch(
    command({
      worktreeId: '20000000-0000-4000-8000-000000000001',
      repositoryKey: 'fixture-repository',
      repositoryKind: 'directory',
      repositoryIdentity: { source: 'path', canonical: '/workspace' },
      canonicalPath: '/workspace',
      path: '/workspace',
      branch: null,
      registrationGeneration: 0,
      kind: 'current',
      ownership: 'protected',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
      intentFingerprint: 'fixture-intent',
      defaultModelSelection: null,
      projectId: '10000000-0000-4000-8000-000000000001',
      title: 'Platform',
      type: 'project.create',
      workspaceRoot: '/workspace',
    }),
  )
  await engine.dispatch(sessionCreateCommand('00000000-0000-4000-8000-000000000001'))

  return { database, engine }
}
