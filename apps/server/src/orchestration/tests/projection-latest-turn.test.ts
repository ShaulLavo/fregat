import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { OrchestrationEngine } from '../engine'
import { orchestrationCommandSchema } from '@workspace/contracts'

const assistantStartedAt = '2026-05-24T00:02:00.000Z'
const assistantCompletedAt = '2026-05-24T00:03:00.000Z'
import {
  createDomainEngine,
  fixtureWorktreeId,
  projectRegistrationCommand,
  sessionCreateCommand,
} from './factories/engine'

describe('projection latest turn snapshots', () => {
  it('returns the canonical latest turn after an assistant turn completes', async () => {
    const engine = createEngine()
    const sourceProposedPlan = {
      planId: 'plan-1',
      sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    }
    const before = new Date().toISOString()

    await dispatchProjectSession(engine)
    await engine.dispatch(proposePlanCommand())
    await engine.dispatch(startTurnCommand({ sourceProposedPlan }))
    await providerStartStep(engine, 'claim')
    await providerStartStep(engine, 'adopt')
    await engine.dispatch(assistantDeltaCommand())
    await engine.dispatch(assistantCompleteCommand())
    await providerStartStep(engine, 'settle')

    const turn = await latestTurn(engine)

    expect(turn).toEqual({
      assistantMessageId: 'message-2',
      // Provider-runtime commands still carry their own event time.
      completedAt: assistantCompletedAt,
      endReason: null,
      requestedAt: turn?.requestedAt,
      sourceProposedPlan,
      startedAt: assistantStartedAt,
      state: 'completed',
      providerStartState: 'settled',
      providerStartGeneration: 1,
      providerStartSequence: expect.any(Number),
      runtimeEpoch: 'fixture-runtime',
      turnId: 'turn-1',
    })
    expectServerStamped(turn?.requestedAt, before)
  })

  it('refuses a turn that cites a plan no session is actually offering', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)

    await expect(
      engine.dispatch(
        startTurnCommand({
          commandId: 'cmd-turn-ghost',
          sourceProposedPlan: {
            planId: 'plan-1',
            sessionId: 'd0000000-0000-4000-8000-000000000099',
          },
        }),
      ),
    ).rejects.toThrow('Session not found')

    // The session exists here, but is offering nothing.
    await expect(
      engine.dispatch(
        startTurnCommand({
          commandId: 'cmd-turn-unoffered',
          sourceProposedPlan: {
            planId: 'plan-1',
            sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
          },
        }),
      ),
    ).rejects.toThrow('no actionable proposed plan')
  })

  it('returns interrupted latest turn state after a turn interrupt', async () => {
    const engine = createEngine()
    const before = new Date().toISOString()

    await dispatchProjectSession(engine)
    await engine.dispatch(startTurnCommand())
    await engine.dispatch(interruptTurnCommand())

    const turn = await latestTurn(engine)

    expect(turn).toEqual({
      assistantMessageId: null,
      completedAt: turn?.completedAt,
      endReason: 'user-stop',
      requestedAt: turn?.requestedAt,
      startedAt: null,
      state: 'interrupted',
      providerStartState: 'interrupted',
      providerStartGeneration: 0,
      providerStartSequence: expect.any(Number),
      runtimeEpoch: null,
      turnId: 'turn-1',
    })
    expectServerStamped(turn?.requestedAt, before)
    // The interrupt is a client command, so the server clock closes the turn.
    expectServerStamped(turn?.completedAt, turn?.requestedAt)
  })

  it('records a stopped session and a harness-reported limit as end reasons', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(startTurnCommand())

    await engine.dispatch(
      command({
        commandId: 'cmd-runtime-stop',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        type: 'session.runtime.stop',
      }),
    )

    expect((await latestTurn(engine))?.endReason).toBe('runtime-stopped')
  })

  it('keeps the first cause when the harness reports its own reason later', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(startTurnCommand())
    await engine.dispatch(interruptTurnCommand())

    await engine.dispatch(turnEndedCommand('turn-limit'))

    expect((await latestTurn(engine))?.endReason).toBe('user-stop')
  })

  it('takes a harness-reported reason when nothing of ours ended the turn', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(startTurnCommand())

    await engine.dispatch(turnEndedCommand('output-limit'))

    expect((await latestTurn(engine))?.endReason).toBe('output-limit')
  })

  it('rejects a nonexistent plan ID even when its session has a plan ready', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(proposePlanCommand())
    await expect(
      engine.dispatch(
        startTurnCommand({
          sourceProposedPlan: {
            sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
            planId: 'missing-plan',
          },
        }),
      ),
    ).rejects.toThrow('no actionable proposed plan')
    expect(
      (await engine.sessionDetailSnapshot('d2b3ea2b-7e36-4549-b0d4-043c00904574')).session.messages,
    ).toHaveLength(0)
  })

  it('rejects a superseded plan while leaving the newest plan actionable', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(proposePlanCommand())
    await engine.dispatch(
      command({
        type: 'session.proposed-plan.upsert',
        commandId: 'newer-plan',
        createdAt: '2026-05-24T00:01:00.000Z',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        proposedPlan: {
          id: 'plan-2',
          sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
          turnId: null,
          planMarkdown: 'Use the revised approach.',
          createdAt: '2026-05-24T00:01:00.000Z',
          updatedAt: '2026-05-24T00:01:00.000Z',
        },
      }),
    )
    const source = { sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574', planId: 'plan-1' }
    await expect(
      engine.dispatchClientCommand(
        startTurnCommand({ commandId: 'old-plan', sourceProposedPlan: source }),
      ),
    ).rejects.toThrow('no actionable proposed plan')
    expect((await engine.sessionDetailSnapshot(source.sessionId)).session.messages).toHaveLength(0)
    await engine.dispatchClientCommand(
      startTurnCommand({
        commandId: 'current-plan',
        sourceProposedPlan: { ...source, planId: 'plan-2' },
      }),
    )
    expect((await latestTurn(engine))?.sourceProposedPlan?.planId).toBe('plan-2')
  })

  it('keeps a correction on the active turn and rejects an obsolete target', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(startTurnCommand())
    await providerStartStep(engine, 'claim')
    await providerStartStep(engine, 'adopt')
    await engine.dispatch(assistantDeltaCommand())
    const before = await latestTurn(engine)
    await engine.dispatch(
      command({
        commandId: 'correct-turn',
        type: 'session.turn.steer',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        turnId: 'turn-1',
        message: {
          messageId: 'correction-message',
          role: 'user',
          text: 'Use the actual package path.',
          attachments: [],
        },
      }),
    )
    expect(await latestTurn(engine)).toEqual(before)
    const snapshot = await engine.sessionDetailSnapshot('d2b3ea2b-7e36-4549-b0d4-043c00904574')
    expect(snapshot.session.messages.at(-1)).toMatchObject({
      id: 'correction-message',
      turnId: 'turn-1',
      text: 'Use the actual package path.',
    })
    await expect(
      engine.dispatch(
        command({
          commandId: 'obsolete-correction',
          type: 'session.turn.steer',
          sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
          turnId: 'obsolete-turn',
          message: {
            messageId: 'obsolete-message',
            role: 'user',
            text: 'Do not send this',
            attachments: [],
          },
        }),
      ),
    ).rejects.toThrow('Your message was not sent')
  })

  it('rejects a plan from another project before creating a user message', async () => {
    const engine = createEngine()
    await dispatchProjectSession(engine)
    await engine.dispatch(proposePlanCommand())
    await engine.dispatch(projectRegistrationCommand(2))
    const targetId = 'd0000000-0000-4000-8000-000000000002'
    await engine.dispatch(
      command({
        ...sessionCreateCommand(targetId, 'create-foreign-session'),
        worktreeTarget: { kind: 'current', worktreeId: fixtureWorktreeId(2) },
      }),
    )
    await expect(
      engine.dispatch(
        command({
          ...startTurnCommand({
            sourceProposedPlan: {
              sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
              planId: 'plan-1',
            },
          }),
          sessionId: targetId,
        }),
      ),
    ).rejects.toThrow('another project')
    expect((await engine.sessionDetailSnapshot(targetId)).session.messages).toHaveLength(0)
  })

  it('keeps a late older-turn assistant message from replacing the latest turn', async () => {
    const engine = createEngine()

    await dispatchProjectSession(engine)
    await engine.dispatch(
      startTurnCommand({
        commandId: 'cmd-turn-old-start',
        messageId: 'message-old',
        turnId: 'turn-old',
      }),
    )
    const oldRequestedAt = (await latestTurn(engine))?.requestedAt
    await engine.dispatch(
      command({
        type: 'session.turn.interrupt',
        commandId: 'interrupt-old',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        turnId: 'turn-old',
      }),
    )
    await engine.dispatch(
      startTurnCommand({
        commandId: 'cmd-turn-latest-start',
        messageId: 'message-latest',
        text: 'Latest request',
        turnId: 'turn-latest',
      }),
    )
    await engine.dispatch(
      assistantCompleteCommand({
        commandId: 'cmd-assistant-old-complete',
        messageId: 'message-old-assistant',
        turnId: 'turn-old',
      }),
    )

    const turn = await latestTurn(engine)

    expect(turn).toEqual({
      assistantMessageId: null,
      completedAt: null,
      endReason: null,
      requestedAt: turn?.requestedAt,
      startedAt: null,
      state: 'running',
      providerStartState: 'queued',
      providerStartGeneration: 0,
      providerStartSequence: expect.any(Number),
      runtimeEpoch: null,
      turnId: 'turn-latest',
    })
    expectServerStamped(turn?.requestedAt, oldRequestedAt)
  })
})

function expectServerStamped(value: string | null | undefined, notBefore: string | undefined) {
  expect(typeof value).toBe('string')
  expect(Number.isNaN(Date.parse(value ?? ''))).toBe(false)
  expect(value! >= notBefore!).toBe(true)
}

async function dispatchProjectSession(engine: OrchestrationEngine) {
  await engine.dispatch(projectRegistrationCommand())
  await engine.dispatch(sessionCreateCommand())
}

function createEngine() {
  return createDomainEngine().engine
}

function proposePlanCommand() {
  return command({
    commandId: 'cmd-propose-plan',
    createdAt: '2026-05-24T00:00:30.000Z',
    proposedPlan: {
      createdAt: '2026-05-24T00:00:30.000Z',
      id: 'plan-1',
      planMarkdown: '1. Do the thing',
      sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
      turnId: null,
      updatedAt: '2026-05-24T00:00:30.000Z',
    },
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    type: 'session.proposed-plan.upsert',
  })
}

function startTurnCommand(input: Partial<StartTurnInput> = {}) {
  return command({
    commandId: input.commandId ?? 'cmd-turn-start',
    interactionMode: 'default',
    message: {
      attachments: [],
      messageId: input.messageId ?? 'message-1',
      role: 'user',
      text: input.text ?? 'Build the first slice',
    },
    runtimeMode: 'full-access',
    sourceProposedPlan: input.sourceProposedPlan,
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    turnId: input.turnId ?? 'turn-1',
    type: 'session.turn.start',
  })
}

type StartTurnInput = {
  commandId: string
  messageId: string
  sourceProposedPlan: { planId: string; sessionId: string }
  text: string
  turnId: string
}

function assistantDeltaCommand() {
  return command({
    commandId: 'cmd-assistant-delta',
    createdAt: assistantStartedAt,
    delta: 'Done',
    messageId: 'message-2',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    turnId: 'turn-1',
    type: 'session.message.assistant.delta',
  })
}

function assistantCompleteCommand(input: Partial<AssistantCompleteInput> = {}) {
  return command({
    commandId: input.commandId ?? 'cmd-assistant-complete',
    completedAt: assistantCompletedAt,
    messageId: input.messageId ?? 'message-2',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    turnId: input.turnId ?? 'turn-1',
    type: 'session.message.assistant.complete',
  })
}

type AssistantCompleteInput = {
  commandId: string
  messageId: string
  turnId: string
}

function interruptTurnCommand() {
  return command({
    commandId: 'cmd-turn-interrupt',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    turnId: 'turn-1',
    type: 'session.turn.interrupt',
  })
}

function turnEndedCommand(endReason: string) {
  return command({
    activity: {
      createdAt: '2026-05-24T00:04:00.000Z',
      id: `turn-ended-${endReason}`,
      kind: 'turn.ended',
      payload: { endReason },
      sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
      summary: 'Turn ended',
      tone: 'info',
      turnId: 'turn-1',
    },
    commandId: `cmd-turn-ended-${endReason}`,
    createdAt: '2026-05-24T00:04:00.000Z',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    type: 'session.activity.append',
  })
}

async function latestTurn(engine: OrchestrationEngine) {
  return (await engine.sessionDetailSnapshot('d2b3ea2b-7e36-4549-b0d4-043c00904574')).session
    .latestTurn
}

function command(value: unknown) {
  return v.parse(orchestrationCommandSchema, value)
}

async function providerStartStep(engine: OrchestrationEngine, step: 'claim' | 'adopt' | 'settle') {
  const turn = (await latestTurn(engine))!
  await engine.dispatch(
    command({
      type: `session.provider-start.${step}`,
      commandId: `provider-${step}`,
      sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
      turnId: turn.turnId,
      observedSequence: turn.providerStartSequence,
      generation: 1,
      runtimeEpoch: 'fixture-runtime',
      createdAt: assistantStartedAt,
    }),
  )
}
