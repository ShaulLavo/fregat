import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'

import { createEngineWithSession } from './factories/engine'

describe('decider event envelope', () => {
  it('links a turn start to the message that caused it', async () => {
    const engine = await createEngineWithSession()

    await engine.dispatch(sessionTurnStartCommand())

    const events = (await engine.replay({ afterSequence: 0 })).events
    const message = events.find((event) => event.type === 'session.message-sent')
    const turnStart = events.find((event) => event.type === 'session.turn-start-requested')
    expect(message).toBeDefined()
    expect(turnStart?.causationEventId).toBe(message?.eventId)
  })

  it('lifts the request id into the envelope of an approval response', async () => {
    const engine = await createEngineWithSession()

    await engine.dispatch(
      command({
        commandId: 'cmd-approval-respond',
        createdAt: '2026-05-24T00:02:00.000Z',
        decision: 'accept',
        requestId: 'req-1',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        type: 'session.approval.respond',
      }),
    )

    const responded = (await engine.replay({ afterSequence: 0 })).events.find(
      (event) => event.type === 'session.approval-response-requested',
    )
    expect(responded?.metadata).toEqual({ requestId: 'req-1' })
  })

  it('lifts the request id into the envelope of a user-input response', async () => {
    const engine = await createEngineWithSession()

    await engine.dispatch(
      command({
        answers: { answer: 'yes' },
        commandId: 'cmd-user-input-respond',
        createdAt: '2026-05-24T00:02:00.000Z',
        requestId: 'req-2',
        sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
        type: 'session.user-input.respond',
      }),
    )

    const responded = (await engine.replay({ afterSequence: 0 })).events.find(
      (event) => event.type === 'session.user-input-response-requested',
    )
    expect(responded?.metadata).toEqual({ requestId: 'req-2' })
  })

  it("lifts a request-carrying activity's request id, and leaves other activities bare", async () => {
    const engine = await createEngineWithSession()

    await engine.dispatch(
      activityAppendCommand('activity-approval-1', 'approval.requested', {
        requestId: 'req-3',
      }),
    )
    await engine.dispatch(activityAppendCommand('activity-tool-1', 'tool.started', null))

    const events = (await engine.replay({ afterSequence: 0 })).events
    const request = events.find(
      (event) =>
        event.type === 'session.activity-appended' &&
        event.payload.activity.id === 'activity-approval-1',
    )
    const tool = events.find(
      (event) =>
        event.type === 'session.activity-appended' &&
        event.payload.activity.id === 'activity-tool-1',
    )
    expect(request?.metadata).toEqual({ requestId: 'req-3' })
    expect(tool?.metadata).toEqual({})
  })
})

function activityAppendCommand(id: string, kind: string, payload: unknown) {
  return command({
    activity: {
      createdAt: '2026-05-24T00:02:00.000Z',
      id,
      kind,
      payload,
      summary: kind,
      sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
      tone: 'info',
      turnId: null,
    },
    commandId: `cmd-${id}`,
    createdAt: '2026-05-24T00:02:00.000Z',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    type: 'session.activity.append',
  })
}

function sessionTurnStartCommand() {
  return command({
    commandId: 'cmd-turn-start',
    interactionMode: 'default',
    message: { messageId: 'message-1', role: 'user', text: 'Build the first slice' },
    runtimeMode: 'full-access',
    sessionId: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
    turnId: 'turn-1',
    type: 'session.turn.start',
  })
}

function command(value: unknown) {
  return v.parse(orchestrationCommandSchema, value)
}
