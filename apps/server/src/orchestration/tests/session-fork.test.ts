import { afterEach, expect, test } from 'vitest'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { decideOrchestrationCommand } from '../decider'
import { OrchestrationEngine } from '../engine'
import {
  applyIncrementally,
  createProjectionFixture,
  messageSentEvent,
  SESSION_ID,
  sessionBootstrapEvents,
  turnStartEvent,
} from './factories/projection'

const FORK_ID = '00000000-0000-4000-8000-00000000f0f0'
let fixture: ReturnType<typeof createProjectionFixture> | null = null

afterEach(() => {
  fixture?.close()
  fixture = null
})

function setup(options: { runningTurn?: string } = {}) {
  fixture = createProjectionFixture()
  const messages = ['turn-1', 'turn-2', 'turn-3'].flatMap((turnId, index) => [
    messageSentEvent({
      createdAt: `2026-05-24T00:0${index + 1}:00.000Z`,
      messageId: `user-${turnId}`,
      role: 'user',
      streaming: false,
      text: `Question ${index + 1}`,
      turnId,
    }),
    messageSentEvent({
      createdAt: `2026-05-24T00:0${index + 1}:30.000Z`,
      messageId: `assistant-${turnId}`,
      streaming: false,
      text: `Answer ${index + 1}`,
      turnId,
    }),
  ])
  const running = options.runningTurn
    ? [turnStartEvent(options.runningTurn, '2026-05-24T00:03:00.000Z')]
    : []
  const model = applyIncrementally(fixture, [...sessionBootstrapEvents(), ...messages, ...running])
  return { fixture, model }
}

function fork(throughTurnId: string) {
  return v.parse(orchestrationCommandSchema, {
    commandId: crypto.randomUUID(),
    sessionId: FORK_ID,
    sourceSessionId: SESSION_ID,
    throughTurnId,
    type: 'session.fork',
  })
}

test('a fork carries the conversation through the chosen turn and counts what it leaves', () => {
  const { fixture, model } = setup()
  const events = decideOrchestrationCommand(fork('turn-2'), model)

  expect(events.map((event) => event.type)).toEqual(['session.created', 'session.history-imported'])
  expect(events[0]?.payload).toMatchObject({
    forkedFrom: { droppedPrompts: 1, sessionId: SESSION_ID, turnId: 'turn-2' },
    origin: 'platform',
    sessionId: FORK_ID,
    title: 'Projection (fork)',
  })

  fixture.pipeline.applyEvents(fixture.append(events))
  const detail = fixture.snapshots.sessionDetailSnapshot(FORK_ID)
  expect(detail.session.forkedFrom).toEqual({
    droppedPrompts: 1,
    sessionId: SESSION_ID,
    turnId: 'turn-2',
  })
  expect(detail.session.messages.map((message) => message.text)).toEqual([
    'Question 1',
    'Answer 1',
    'Question 2',
    'Answer 2',
  ])
  expect(fixture.snapshots.sessionDetailSnapshot(SESSION_ID).session.messages).toHaveLength(6)
})

test('a running turn and an unknown turn cannot be forked', () => {
  const { model } = setup({ runningTurn: 'turn-4' })

  expect(() => decideOrchestrationCommand(fork('turn-4'), model)).toThrow(
    'A turn still running cannot be forked.',
  )
  expect(() => decideOrchestrationCommand(fork('turn-9'), model)).toThrow(
    'That turn is not in the session any more.',
  )
})

test.each([
  ['long-turn-1000', 2008],
  ['turn-1', 2],
] as const)(
  'forks %s from the full durable conversation',
  async (turnId, count) => {
    const { fixture } = setup()
    const messages = Array.from({ length: 2002 }, (_, index) =>
      messageSentEvent({
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
        messageId: `long-${index}`,
        turnId: `long-turn-${Math.floor(index / 2)}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        streaming: false,
        text: `Long message ${index}`,
      }),
    )
    fixture.pipeline.applyEvents(fixture.append(messages))
    const engine = new OrchestrationEngine(fixture.database, { providerRuntime: false })
    try {
      await engine.dispatch(fork(turnId))
      expect((await engine.sessionTranscript(FORK_ID)).session.messages).toHaveLength(count)
    } finally {
      await engine.close()
    }
  },
  60_000,
)

test('a session keeps the agent it started as, and its fork runs as the same agent', () => {
  const { fixture, model } = setup()
  const created = decideOrchestrationCommand(fork('turn-1'), {
    ...model,
    sessions: new Map([
      ...model.sessions,
      [SESSION_ID, { ...model.sessions.get(SESSION_ID)!, agent: 'reviewer' }],
    ]),
  })
  expect(created[0]?.payload).toMatchObject({ agent: 'reviewer' })

  fixture.pipeline.applyEvents(fixture.append(created))
  expect(fixture.snapshots.sessionDetailSnapshot(FORK_ID).session.agent).toBe('reviewer')
})

test('a compaction turn needs an idle conversation and records its kind', () => {
  const { fixture: idle, model } = setup()
  const compact = (sessionId: string) =>
    v.parse(orchestrationCommandSchema, {
      commandId: crypto.randomUUID(),
      interactionMode: 'default',
      kind: 'compact',
      message: { messageId: crypto.randomUUID(), role: 'user', text: '/compact' },
      runtimeMode: 'full-access',
      sessionId,
      turnId: 'turn-compact',
      type: 'session.turn.start',
    })

  const events = decideOrchestrationCommand(compact(SESSION_ID), model)
  expect(
    events.find((event) => event.type === 'session.turn-start-requested')?.payload,
  ).toMatchObject({
    kind: 'compact',
  })
  expect(() => decideOrchestrationCommand(compact(FORK_ID), model)).toThrow(
    'There is no conversation to compact yet.',
  )
  idle.close()
  const busy = setup({ runningTurn: 'turn-4' }).model
  expect(() => decideOrchestrationCommand(compact(SESSION_ID), busy)).toThrow()
})
