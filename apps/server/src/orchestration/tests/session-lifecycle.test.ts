import { OrchestrationCommandReceipts } from '../command-receipts'
import archivePolicy from '../../../../../test/parity/t3code/archive.json'
import { Database } from 'bun:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as v from 'valibot'
import {
  orderKeyBetween,
  orchestrationCommandSchema,
  type OrchestrationCommand,
} from '@workspace/contracts'
import { initializePlatformDatabase } from '../../db/initialize'
import * as schema from '../../db/schema'
import { projectionSessions } from '../../db/schema'
import { OrchestrationEngine } from '../engine'

const modelSelection = { model: 'gpt-5-codex', providerInstanceId: 'codex' }
const fixtures: Array<{ close: () => void }> = []
let commandCounter = 0

afterEach(() => {
  vi.useRealTimers()
  for (const fixture of fixtures.splice(0)) fixture.close()
  commandCounter = 0
})

describe('approval admission', () => {
  const sessionId = '00000000-0000-4000-8000-000000000001'

  function respond(decision: string) {
    return command({
      decision,
      requestId: 'request-1',
      sessionId,
      type: 'session.approval.respond',
    })
  }

  async function engineWithOpenApproval() {
    const fixture = await createEngineWithSession()
    const turn = turnStartCommand()
    await fixture.engine.dispatch(turn)
    const turnId = (turn as { turnId: string }).turnId
    await fixture.engine.dispatch(
      activityCommand('approval.requested', 'approval', { requestId: 'request-1' }, turnId),
    )
    return { ...fixture, turnId }
  }

  async function activityKinds(engine: OrchestrationEngine) {
    const snapshot = await engine.sessionDetailSnapshot(sessionId)
    return snapshot.session.activities.map((activity) => activity.kind)
  }

  it('closes evicted approvals on stop and rejects late answers after rebuilding', async () => {
    const { database, engine, turnId } = await engineWithOpenApproval()
    for (let index = 0; index < 501; index += 1) {
      await engine.dispatch(activityCommand('tool.completed', 'info', { index }, turnId))
    }
    expect(
      (await engine.readModelSnapshot()).sessions.get(sessionId)?.activities,
    ).not.toContainEqual(expect.objectContaining({ kind: 'approval.requested' }))
    const restarted = new OrchestrationEngine(database)
    await restarted.dispatch(command({ sessionId, turnId, type: 'session.turn.interrupt' }))
    expect(sessionRow(database).pendingApprovalCount).toBe(0)
    await expect(restarted.dispatch(respond('accept'))).rejects.toMatchObject({
      code: 'orchestration.APPROVAL_REQUEST_ENDED',
    })
  })

  it('rejects unknown approval requests', async () => {
    const { engine } = await createEngineWithSession()
    await expect(engine.dispatch(respond('accept'))).rejects.toMatchObject({
      code: 'orchestration.APPROVAL_REQUEST_UNKNOWN',
    })
  })

  it('turns a repeated identical answer into a no-op', async () => {
    const { engine } = await engineWithOpenApproval()

    await engine.dispatch(respond('accept'))
    await engine.dispatch(respond('accept'))

    const kinds = await activityKinds(engine)
    expect(kinds.filter((kind) => kind === 'approval.answer-submitted')).toHaveLength(1)
  })

  it('refuses a different answer once one was admitted', async () => {
    const { engine } = await engineWithOpenApproval()
    await engine.dispatch(respond('accept'))

    await expect(engine.dispatch(respond('decline'))).rejects.toMatchObject({
      code: 'orchestration.APPROVAL_ALREADY_DECIDED',
    })
  })

  it('refuses a different answer after the agent resolved the request', async () => {
    const { engine } = await engineWithOpenApproval()
    await engine.dispatch(
      activityCommand('approval.resolved', 'approval', {
        decision: 'accept',
        requestId: 'request-1',
      }),
    )

    await expect(engine.dispatch(respond('decline'))).rejects.toMatchObject({
      code: 'orchestration.APPROVAL_ALREADY_DECIDED',
    })
  })

  it('lets the user answer again after a transient respond failure', async () => {
    const { engine } = await engineWithOpenApproval()
    await engine.dispatch(respond('accept'))
    await engine.dispatch(
      activityCommand('provider.approval.respond.failed', 'error', {
        detail: 'Provider socket hung up',
        requestId: 'request-1',
      }),
    )

    await engine.dispatch(respond('decline'))

    const kinds = await activityKinds(engine)
    expect(kinds.filter((kind) => kind === 'approval.answer-submitted')).toHaveLength(2)
  })

  it('closes an open approval when its turn is interrupted and refuses a later answer', async () => {
    const { engine, turnId } = await engineWithOpenApproval()

    await engine.dispatch(command({ sessionId, turnId, type: 'session.turn.interrupt' }))

    const snapshot = await engine.sessionDetailSnapshot(sessionId)
    expect(snapshot.session.activities).toContainEqual(
      expect.objectContaining({
        kind: 'approval.resolved',
        payload: expect.objectContaining({ requestId: 'request-1', resolution: 'ended' }),
        turnId,
      }),
    )
    await expect(engine.dispatch(respond('accept'))).rejects.toMatchObject({
      code: 'orchestration.APPROVAL_REQUEST_ENDED',
    })
  })

  it('closes an open approval when the runtime leaves running', async () => {
    const { database, engine } = await engineWithOpenApproval()

    await engine.dispatch(sessionSetCommand('interrupted'))

    const kinds = await activityKinds(engine)
    expect(kinds.filter((kind) => kind === 'approval.resolved')).toHaveLength(1)
    await engine.dispatch(settleCommand())
    expect(sessionRow(database).settledOverride).toBe('settled')
  })

  it('leaves an approval of another turn open when one turn is interrupted', async () => {
    const { engine } = await engineWithOpenApproval()

    await engine.dispatch(
      command({ sessionId, turnId: 'turn-other', type: 'session.turn.interrupt' }),
    )

    expect(await activityKinds(engine)).not.toContain('approval.resolved')
  })
})

it('publishes persisted turn reasons after another turn starts', async () => {
  const { database, engine } = await createEngineWithSession()
  const turn = turnStartCommand()
  await engine.dispatch(turn)
  const sessionId = '00000000-0000-4000-8000-000000000001'
  const first = (await engine.sessionDetailSnapshot(sessionId)).session.latestTurn!
  await engine.dispatch(
    command({ type: 'session.turn.interrupt', sessionId, turnId: first.turnId }),
  )
  await engine.dispatch(turnStartCommand())
  const restarted = new OrchestrationEngine(database)
  const snapshot = await restarted.sessionDetailSnapshot(sessionId)
  expect(snapshot.session).toMatchObject({
    turns: { [first.turnId]: { state: 'interrupted', endReason: 'user-stop' } },
  })
})

describe('settle guards', () => {
  it.each(['queued', 'claimed', 'runtime-live'] as const)(
    'archives a session with %s work without stopping it',
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

      await engine.dispatch(command({ sessionId, type: 'session.archive' }))
      expect(sessionRow(database).archivedAt).toEqual(expect.any(String))
      const after = await engine.shellSnapshot()
      expect(after.sessions[0]?.runtime).toEqual(before.sessions[0]?.runtime)
      expect(after.sessions[0]?.latestTurn).toEqual(before.sessions[0]?.latestTurn)
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
        code: 'provider.REQUEST_GONE',
        detail: 'The agent no longer holds this request. Restart the turn to continue.',
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

  it.each(['claimed', 'adopted', 'started'] as const)(
    'snooze distinguishes durable provider start stage %s',
    async (stage) => {
      const { database, engine } = await createEngineWithSession()
      const sessionId = '00000000-0000-4000-8000-000000000001'
      await engine.dispatch(turnStartCommand())
      const turn = (await engine.readModelSnapshot()).sessions.get(sessionId)!.latestTurn!
      const claim = await engine.dispatch(
        command({
          type: 'session.provider-start.claim',
          sessionId,
          turnId: turn.turnId,
          observedSequence: turn.providerStartSequence,
          generation: 1,
          runtimeEpoch: 'epoch-fixture',
          createdAt: '2026-09-05T12:00:00.000Z',
        }),
      )
      if (stage !== 'claimed')
        await engine.dispatch(
          command({
            type: 'session.provider-start.adopt',
            sessionId,
            turnId: turn.turnId,
            observedSequence: claim.sequence,
            generation: 1,
            runtimeEpoch: 'epoch-fixture',
            createdAt: '2026-09-05T12:00:01.000Z',
          }),
        )
      if (stage !== 'started') {
        await expect(engine.dispatch(snoozeCommand())).rejects.toMatchObject({
          code: 'orchestration.SESSION_QUEUED_TURN_START',
        })
        return
      }
      await engine.dispatch(sessionSetCommand('running', sessionId, turn.turnId))
      await engine.dispatch(snoozeCommand())
      expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime())
      expect((await engine.readModelSnapshot()).sessions.get(sessionId)?.latestTurn?.state).toBe(
        'running',
      )
    },
  )

  it('allows a running session to be snoozed without interrupting it', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(sessionSetCommand('running'))
    await engine.dispatch(snoozeCommand())
    expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime())
    expect((await engine.shellSnapshot()).sessions[0]?.runtime?.status).toBe('running')
  })

  it('refuses a conditional provider stop after settlement was superseded', async () => {
    const { engine } = await createEngineWithSession()
    await engine.dispatch(settleCommand())
    await engine.dispatch(
      command({
        type: 'session.unsettle',
        sessionId: '00000000-0000-4000-8000-000000000001',
        reason: 'user',
      }),
    )
    await expect(
      engine.dispatch(
        command({
          type: 'session.runtime.stop',
          sessionId: '00000000-0000-4000-8000-000000000001',
          onlyIfSettled: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'orchestration.SESSION_NOT_SETTLED' })
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

  it('settlement clears pin and snooze and dismisses only optional message questions', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand())
    await engine.dispatch(snoozeCommand())
    await engine.dispatch(
      activityCommand('user-input.requested', 'info', {
        requestId: 'optional-question',
        responseMode: 'message',
        questions: [],
      }),
    )
    await engine.dispatch(settleCommand())
    const row = sessionRow(database)
    expect(row.settledOverride).toBe('settled')
    expect(row.pinnedAt).toBeNull()
    expect(row.snoozedUntil).toBeNull()
    const session = (await engine.readModelSnapshot()).sessions.get(row.sessionId)!
    expect(session.pendingUserInputCount).toBe(0)
    expect(session.activities).toContainEqual(
      expect.objectContaining({
        kind: 'user-input.resolved',
        payload: { requestId: 'optional-question', responseMode: 'message' },
      }),
    )
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

  it('retains snooze when a runtime starts new work', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(snoozeCommand())

    await engine.dispatch(sessionSetCommand('starting'))

    expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime())
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

describe('archive and activity policy', () => {
  it.each(archivePolicy.activityTransitions)(
    'keeps archive and snooze through $kind, duplicate delivery and explicit restore',
    async ({ kind, resetsSettlement }) => {
      const { database, engine } = await createEngineWithSession()
      const sessionId = '00000000-0000-4000-8000-000000000001'
      await engine.dispatch(settleCommand())
      await engine.dispatch(snoozeCommand())
      await engine.dispatch(command({ type: 'session.archive', sessionId }))
      const archivedAt = sessionRow(database).archivedAt
      const activity = activityCommand(kind, kind === 'provider.error' ? 'error' : 'info')
      await engine.dispatch(activity)
      await engine.dispatch(activity)
      expect(sessionRow(database)).toMatchObject({
        archivedAt,
        snoozedUntil: futureWakeTime(),
        settledOverride: resetsSettlement ? null : 'settled',
      })
      expect((await engine.shellSnapshot()).sessions[0]?.archivedAt).toBe(archivedAt)
      expect(
        (await engine.replay({ afterSequence: 0 })).events.filter(
          (event) => event.type === 'session.unarchived',
        ),
      ).toEqual([])
      const before = await engine.sessionDetailSnapshot(sessionId)
      await engine.dispatch(command({ type: 'session.unarchive', sessionId }))
      const after = await engine.sessionDetailSnapshot(sessionId)
      expect(after.session.archivedAt).toBeNull()
      expect(after.session.activities).toEqual(before.session.activities)
      expect(after.session.messages).toEqual(before.session.messages)
      expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime())
    },
  )

  it.each(archivePolicy.runtimeTransitions)(
    'keeps archive and snooze when runtime becomes $status',
    async ({ status, resetsSettlement }) => {
      const { database, engine } = await createEngineWithSession()
      await engine.dispatch(settleCommand())
      await engine.dispatch(snoozeCommand())
      await engine.dispatch(
        command({ type: 'session.archive', sessionId: '00000000-0000-4000-8000-000000000001' }),
      )
      const archivedAt = sessionRow(database).archivedAt
      await engine.dispatch(sessionSetCommand(status))
      expect(sessionRow(database)).toMatchObject({
        archivedAt,
        snoozedUntil: futureWakeTime(),
        settledOverride: resetsSettlement ? null : 'settled',
      })
    },
  )

  it.each(['approval.requested', 'user-input.requested'])(
    'archives a pending %s request without discarding it',
    async (kind) => {
      const { engine } = await createEngineWithSession()
      const sessionId = '00000000-0000-4000-8000-000000000001'
      await engine.dispatch(activityCommand(kind, 'info'))
      const before = await engine.sessionDetailSnapshot(sessionId)
      const archive = command({ type: 'session.archive', sessionId })
      await engine.dispatch(archive)
      expect((await engine.dispatch(archive)).deduped).toBe(true)
      await expect(
        engine.dispatch(command({ type: 'session.archive', sessionId })),
      ).rejects.toMatchObject({ code: 'orchestration.SESSION_ARCHIVED' })
      const after = await engine.sessionDetailSnapshot(sessionId)
      expect(after.session.activities).toEqual(before.session.activities)
      expect(after.session.archivedAt).toEqual(expect.any(String))
    },
  )

  it('retains archive, settlement and snooze through plan arrival and runtime recovery', async () => {
    const { database, engine } = await createEngineWithSession()
    const sessionId = '00000000-0000-4000-8000-000000000001'
    await engine.dispatch(settleCommand())
    await engine.dispatch(snoozeCommand())
    await engine.dispatch(sessionSetCommand('stopped'))
    await engine.dispatch(command({ type: 'session.archive', sessionId }))
    const archivedAt = sessionRow(database).archivedAt
    await engine.dispatch(
      command({
        type: 'session.proposed-plan.upsert',
        sessionId,
        createdAt: '2026-06-01T00:00:00.000Z',
        proposedPlan: {
          id: 'late-plan',
          sessionId,
          turnId: null,
          planMarkdown: '# Retained plan',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      }),
    )
    const observedSequence = (await engine.readModelSnapshot()).sessions.get(
      sessionId,
    )?.runtimeSequence
    await engine.dispatch(
      command({
        type: 'session.runtime.recover',
        sessionId,
        observedSequence,
        runtimeEpoch: 'epoch-fixture',
        message: 'Recover interrupted runtime',
        createdAt: '2026-06-01T00:01:00.000Z',
      }),
    )
    expect(sessionRow(database)).toMatchObject({
      archivedAt,
      settledOverride: 'settled',
      snoozedUntil: futureWakeTime(),
    })
    const before = await engine.sessionDetailSnapshot(sessionId)
    expect(before.proposedPlans[0]?.planMarkdown).toBe('# Retained plan')
    await engine.dispatch(command({ type: 'session.unarchive', sessionId }))
    expect((await engine.sessionDetailSnapshot(sessionId)).proposedPlans).toEqual(
      before.proposedPlans,
    )
  })

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
      settledOverride: 'settled',
      acknowledgedFailureThroughSequence: acknowledged,
    })
  })
})

describe('active ordering', () => {
  it('retains active keys during snooze, preserves duplicate timestamps, and clears them on settlement', async () => {
    const { database, engine } = await createEngineWithSession()
    const sessionId = '00000000-0000-4000-8000-000000000001'
    await engine.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'm' }))
    const ordered = sessionRow(database)
    await tick()
    await engine.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'm' }))
    expect(sessionRow(database).updatedAt).toBe(ordered.updatedAt)
    await engine.dispatch(
      command({ type: 'session.snooze', sessionId, snoozedUntil: futureWakeTime() }),
    )
    await engine.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'n' }))
    expect(sessionRow(database)).toMatchObject({
      activeOrderKey: 'n',
      snoozedUntil: futureWakeTime(),
    })
    expect((await engine.shellSnapshot()).sessions[0]?.activeOrderKey).toBe('n')
    await engine.dispatch(settleCommand())
    expect(sessionRow(database)).toMatchObject({ activeOrderKey: null, unsettledAt: null })
    await engine.dispatch(command({ type: 'session.unsettle', sessionId, reason: 'user' }))
    const active = sessionRow(database)
    expect(active.unsettledAt).toBe(active.updatedAt)
    await tick()
    await engine.dispatch(command({ type: 'session.unsettle', sessionId, reason: 'user' }))
    expect(sessionRow(database).unsettledAt).toBe(active.unsettledAt)
    await engine.dispatch(turnStartCommand())
    expect(sessionRow(database)).toMatchObject({
      unsettledAt: active.unsettledAt,
      settledOverride: null,
    })
  })

  it('loads active order and re-entry anchors after restarting the engine', async () => {
    const { database, engine } = await createEngineWithSession()
    const sessionId = '00000000-0000-4000-8000-000000000001'
    await engine.dispatch(command({ type: 'session.unsettle', sessionId, reason: 'user' }))
    await engine.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'k' }))
    const before = (await engine.shellSnapshot()).sessions[0]!
    const restarted = new OrchestrationEngine(database)
    const after = (await restarted.shellSnapshot()).sessions[0]!
    expect(after).toMatchObject({
      activeOrderKey: 'k',
      unsettledAt: before.unsettledAt,
      updatedAt: before.updatedAt,
    })
    await restarted.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'k' }))
    expect((await restarted.shellSnapshot()).sessions[0]?.updatedAt).toBe(before.updatedAt)
  })

  it.each(['session.pin', 'session.settle', 'session.archive'] as const)(
    'refuses active reorder after %s',
    async (type) => {
      const { database, engine } = await createEngineWithSession()
      const sessionId = '00000000-0000-4000-8000-000000000001'
      await engine.dispatch(command({ type, sessionId }))
      await expect(
        engine.dispatch(command({ type: 'session.active.reorder', sessionId, orderKey: 'm' })),
      ).rejects.toThrow()
      expect(sessionRow(database).activeOrderKey).toBeNull()
    },
  )
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

function sessionSetCommand(
  status: string,
  sessionId = '00000000-0000-4000-8000-000000000001',
  activeTurnId: string | null = null,
) {
  return command({
    createdAt: '2026-06-01T00:00:00.000Z',
    runtime: {
      activeTurnId,
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
  turnId: string | null = null,
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
      turnId,
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
  initializePlatformDatabase(database)
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

describe('atomic lifecycle history', () => {
  it('rejects Undo after another client changes the wake time', async () => {
    const { database, engine } = await createEngineWithSession()
    const first = await engine.dispatch(snoozeCommand())
    await engine.dispatch(snoozeCommand({ snoozedUntil: futureWakeTime(2) }))
    expect(first.lifecycle).toMatchObject({
      kind: 'session.lifecycle',
      before: { snoozedUntil: null },
    })
    if (!first.lifecycle || !('before' in first.lifecycle))
      throw new Error('Missing lifecycle receipt')
    await expect(
      engine.dispatch(
        command({
          type: 'session.lifecycle.restore',
          sessionId: '00000000-0000-4000-8000-000000000001',
          expectedRevision: first.sequence,
          restoreCommandId: first.lifecycle.commandId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'orchestration.LIFECYCLE_CONFLICT', status: 409 })
    expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime(2))
  })

  it('restores every lifecycle field atomically from the authoritative receipt and supports redo', async () => {
    const { database, engine } = await createEngineWithSession()
    await engine.dispatch(pinCommand({ orderKey: 'm' }))
    await engine.dispatch(snoozeCommand())
    const before = sessionRow(database)
    const action = settleCommand()
    const settled = await engine.dispatch(action)
    expect(settled.lifecycle).toMatchObject({
      kind: 'session.lifecycle',
      before: { pinnedAt: before.pinnedAt },
    })
    if (!settled.lifecycle || !('before' in settled.lifecycle))
      throw new Error('Missing lifecycle receipt')
    expect(await engine.dispatch(action)).toMatchObject({ ...settled, deduped: true })
    const restore = command({
      type: 'session.lifecycle.restore',
      sessionId: before.sessionId,
      expectedRevision: settled.sequence,
      restoreCommandId: settled.lifecycle.commandId,
    })
    const undone = await engine.dispatch(restore)
    expect(undone.sequence).toBe(settled.sequence + 1)
    expect(sessionRow(database)).toMatchObject(settled.lifecycle.before)
    if (!undone.lifecycle || !('before' in undone.lifecycle))
      throw new Error('Missing inverse receipt')
    await engine.dispatch(
      command({
        type: 'session.lifecycle.restore',
        sessionId: before.sessionId,
        expectedRevision: undone.sequence,
        restoreCommandId: undone.lifecycle.commandId,
      }),
    )
    expect(sessionRow(database).settledOverride).toBe('settled')
    await expect(
      engine.dispatch(command({ ...restore, commandId: 'stale-restore' })),
    ).rejects.toMatchObject({ code: 'orchestration.LIFECYCLE_CONFLICT' })
  })
})

it('persists the restore guard across restart and permits only one concurrent inverse', async () => {
  const { database, engine } = await createEngineWithSession()
  const action = await engine.dispatch(snoozeCommand())
  if (!action.lifecycle) throw new Error('Missing lifecycle receipt')
  await engine.close()
  const restarted = new OrchestrationEngine(database)
  const restore = {
    type: 'session.lifecycle.restore',
    sessionId: action.lifecycle.sessionId,
    expectedRevision: action.sequence,
    restoreCommandId: action.lifecycle.commandId,
  }
  const outcomes = await Promise.allSettled([
    restarted.dispatch(command(restore)),
    restarted.dispatch(command(restore)),
  ])
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const refused = outcomes.find((result) => result.status === 'rejected')
  expect(refused).toMatchObject({ reason: { code: 'orchestration.LIFECYCLE_CONFLICT' } })
  expect(sessionRow(database).snoozedUntil).toBeNull()
  await restarted.close()
})

it('refuses redo after a new pending request arrives', async () => {
  const { database, engine } = await createEngineWithSession()
  const settled = await engine.dispatch(settleCommand())
  if (!settled.lifecycle) throw new Error('Missing lifecycle receipt')
  const undone = await engine.dispatch(
    command({
      type: 'session.lifecycle.restore',
      sessionId: settled.lifecycle.sessionId,
      expectedRevision: settled.sequence,
      restoreCommandId: settled.lifecycle.commandId,
    }),
  )
  await engine.dispatch(activityCommand('approval.requested', 'approval'))
  await expect(
    engine.dispatch(
      command({
        type: 'session.lifecycle.restore',
        sessionId: settled.lifecycle.sessionId,
        expectedRevision: undone.sequence,
        restoreCommandId: undone.lifecycle?.commandId,
      }),
    ),
  ).rejects.toMatchObject({ code: 'orchestration.LIFECYCLE_CONFLICT' })
  expect(sessionRow(database).settledOverride).toBeNull()
})

it('checks the persisted revision inside the restore transaction when a decision cache is stale', async () => {
  const { database, engine } = await createEngineWithSession()
  const action = await engine.dispatch(snoozeCommand())
  if (!action.lifecycle) throw new Error('Missing lifecycle receipt')
  const stale = new OrchestrationEngine(database)
  await stale.readModelSnapshot()
  await engine.dispatch(snoozeCommand({ snoozedUntil: futureWakeTime(2) }))
  await expect(
    stale.dispatch(
      command({
        type: 'session.lifecycle.restore',
        sessionId: action.lifecycle.sessionId,
        expectedRevision: action.sequence,
        restoreCommandId: action.lifecycle.commandId,
      }),
    ),
  ).rejects.toMatchObject({ code: 'orchestration.LIFECYCLE_CONFLICT' })
  expect(sessionRow(database).snoozedUntil).toBe(futureWakeTime(2))
  await stale.close()
})

it('does not reinstate a snooze whose deadline passed while settled', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'))
  const { database, engine } = await createEngineWithSession()
  await engine.dispatch(snoozeCommand({ snoozedUntil: '2030-01-01T12:01:00.000Z' }))
  const settled = await engine.dispatch(settleCommand())
  if (!settled.lifecycle) throw new Error('Missing lifecycle receipt')
  vi.setSystemTime(new Date('2030-01-01T12:02:00.000Z'))
  await engine.dispatch(
    command({
      type: 'session.lifecycle.restore',
      sessionId: settled.lifecycle.sessionId,
      expectedRevision: settled.sequence,
      restoreCommandId: settled.lifecycle.commandId,
    }),
  )
  expect(sessionRow(database)).toMatchObject({ snoozedUntil: null, snoozedAt: null })
})

it('refuses to restore another session receipt and rejects client-provided snapshots', async () => {
  const { engine } = await createEngineWithSession()
  const other = '00000000-0000-4000-8000-000000000002'
  await engine.dispatch(sessionCreateCommand(other))
  const foreign = await engine.dispatch(snoozeCommand({ sessionId: other }))
  const action = await engine.dispatch(snoozeCommand())
  if (!action.lifecycle || !foreign.lifecycle) throw new Error('Missing lifecycle receipt')
  await expect(
    engine.dispatch(
      command({
        type: 'session.lifecycle.restore',
        sessionId: action.lifecycle.sessionId,
        expectedRevision: action.sequence,
        restoreCommandId: foreign.lifecycle.commandId,
      }),
    ),
  ).rejects.toMatchObject({ code: 'orchestration.LIFECYCLE_RESTORE_UNAVAILABLE' })
  expect(() =>
    command({
      type: 'session.lifecycle.restore',
      sessionId: action.lifecycle!.sessionId,
      expectedRevision: action.sequence,
      restoreCommandId: action.lifecycle!.commandId,
      state: action.lifecycle!.before,
    }),
  ).toThrow()
})

it('keeps snooze Undo valid while ordinary tool activity continues', async () => {
  const { database, engine } = await createEngineWithSession()
  await engine.dispatch(sessionSetCommand('running'))
  const action = await engine.dispatch(snoozeCommand())
  if (!action.lifecycle) throw new Error('Missing lifecycle receipt')
  await engine.dispatch(activityCommand('tool.started', 'info', null))
  await engine.dispatch(
    command({
      type: 'session.lifecycle.restore',
      sessionId: action.lifecycle.sessionId,
      expectedRevision: action.sequence,
      restoreCommandId: action.lifecycle.commandId,
    }),
  )
  expect(sessionRow(database).snoozedUntil).toBeNull()
})

it.each(['session.archive', 'session.settle', 'session.pin'] as const)(
  'deduplicates historical %s receipts without rewriting stored data',
  async (type) => {
    const { database, engine } = await createEngineWithSession()
    const action = command({
      type,
      sessionId: '00000000-0000-4000-8000-000000000001',
      orderKey: 'm',
    })
    const accepted = await engine.dispatch(action)
    database
      .update(schema.orchestrationCommandReceipts)
      .set({ resultJson: null })
      .where(eq(schema.orchestrationCommandReceipts.commandId, action.commandId))
      .run()
    const restarted = new OrchestrationEngine(database)
    const repeated = await restarted.dispatch(action)
    expect(repeated).toEqual({ sequence: accepted.sequence, deduped: true, result: null })
    const persisted = database
      .select()
      .from(schema.orchestrationCommandReceipts)
      .where(eq(schema.orchestrationCommandReceipts.commandId, action.commandId))
      .get()
    expect(persisted?.resultJson).toBeNull()
    expect(persisted?.resultSequence).toBe(accepted.sequence)
  },
)

it('requires the durable lifecycle result before writing a new accepted receipt', async () => {
  const { database } = await createEngineWithSession()
  const action = command({
    type: 'session.archive',
    sessionId: '00000000-0000-4000-8000-000000000001',
  })
  const receipts = new OrchestrationCommandReceipts(database)
  expect(() => receipts.recordAccepted(action, 99, null)).toThrow()
  expect(receipts.find(action.commandId)).toBeNull()
})
