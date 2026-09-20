import { afterEach, expect, test } from 'vitest'
import * as v from 'valibot'
import { orchestrationCommandSchema, orchestrationLatestTurnSchema } from '@workspace/contracts'
import { decideOrchestrationCommand } from '../decider'
import { pendingMessageQuestions } from '../message-questions'
import { MAX_SESSION_ACTIVITIES } from '../read-model'
import {
  activityAppendedEvent,
  applyIncrementally,
  createProjectionFixture,
  sessionBootstrapEvents,
  SESSION_ID,
} from './factories/projection'

const fixtures: ReturnType<typeof createProjectionFixture>[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()))
function setup(responseMode = 'message') {
  const fixture = createProjectionFixture()
  fixtures.push(fixture)
  const model = applyIncrementally(fixture, [
    ...sessionBootstrapEvents(),
    activityAppendedEvent({
      id: 'question-event',
      kind: 'user-input.requested',
      payload: {
        requestId: 'codex-async:session:question',
        responseMode,
        questions: [
          {
            id: '0',
            prompt: 'Choose a language?',
            answerKind: 'text',
            options: [],
            allowOther: true,
            secret: false,
          },
        ],
      },
    }),
  ])
  return { fixture, model }
}
function command(type: string, answers?: unknown) {
  return v.parse(orchestrationCommandSchema, {
    type,
    commandId: crypto.randomUUID(),
    sessionId: SESSION_ID,
    requestId: 'codex-async:session:question',
    answers,
  })
}

test('message answers resolve atomically with a normal user turn; empty answers fail', () => {
  const { model } = setup()
  expect(() =>
    decideOrchestrationCommand(command('session.user-input.respond', { '0': ' ' }), model),
  ).toThrow('Answer each question')
  const events = decideOrchestrationCommand(
    command('session.user-input.respond', { '0': ' Rust ' }),
    model,
  )
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      'session.activity-appended',
      'session.message-sent',
      'session.turn-start-requested',
    ]),
  )
  expect(events.find((event) => event.type === 'session.message-sent')?.payload).toMatchObject({
    text: 'Choose a language?\nRust',
    attachments: [],
  })
  expect(events.some((event) => event.type === 'session.user-input-response-requested')).toBe(false)
})

test('dismiss produces only resolution and never dismisses a native callback', () => {
  const { model } = setup()
  const events = decideOrchestrationCommand(command('session.user-input.dismiss'), model)
  expect(events).toHaveLength(1)
  expect(events[0]?.payload).toMatchObject({
    activity: { kind: 'user-input.resolved', payload: { responseMode: 'message' } },
  })
  expect(() =>
    decideOrchestrationCommand(command('session.user-input.dismiss'), setup('native').model),
  ).toThrow('cannot be dismissed')
})

test('old questions survive trimming and reload without changing timeline pagination', () => {
  const { fixture, model } = setup()
  const batch = fixture.append(
    Array.from({ length: MAX_SESSION_ACTIVITIES + 20 }, (_, index) =>
      activityAppendedEvent({
        id: `noise-${index}`,
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
      }),
    ),
  )
  fixture.pipeline.applyEvents(batch)
  fixture.snapshots.refreshReadModel(model, batch)
  expect(pendingMessageQuestions(model.sessions.get(SESSION_ID)!.activities)).toHaveLength(1)
  expect(
    pendingMessageQuestions(fixture.snapshots.fullReadModel().sessions.get(SESSION_ID)!.activities),
  ).toHaveLength(1)
  const detail = fixture.snapshots.sessionDetailSnapshot(SESSION_ID)
  expect(detail.session.pendingMessageQuestions).toHaveLength(1)
  expect(detail.session.activities.some((activity) => activity.id === 'question-event')).toBe(false)
  expect(detail.session.activities).toHaveLength(200)
})

test('answers steer an adopted running turn while native requests remain blockers', () => {
  const { model } = setup()
  const session = model.sessions.get(SESSION_ID)!
  session.latestTurn = v.parse(orchestrationLatestTurnSchema, {
    turnId: 'running-turn',
    state: 'running',
    requestedAt: '2026-05-24T00:00:00.000Z',
    startedAt: '2026-05-24T00:00:00.000Z',
    completedAt: null,
    assistantMessageId: null,
    providerStartState: 'adopted',
    providerStartGeneration: 1,
    providerStartSequence: 1,
    runtimeEpoch: 'epoch-test',
  })
  const events = decideOrchestrationCommand(
    command('session.user-input.respond', { '0': 'Rust' }),
    model,
  )
  expect(events.map((event) => event.type)).toEqual([
    'session.activity-appended',
    'session.message-sent',
    'session.turn-steer-requested',
  ])
  session.pendingUserInputCount += 1
  expect(() =>
    decideOrchestrationCommand(command('session.user-input.respond', { '0': 'Rust' }), model),
  ).toThrow()
})

test('a committed dismissal cannot be answered again or resurrected by a snapshot', () => {
  const { fixture, model } = setup()
  const events = fixture.append(
    decideOrchestrationCommand(command('session.user-input.dismiss'), model),
  )
  fixture.pipeline.applyEvents(events)
  fixture.snapshots.refreshReadModel(model, events)
  expect(() =>
    decideOrchestrationCommand(command('session.user-input.respond', { '0': 'Rust' }), model),
  ).toThrow('already been answered or dismissed')
  expect(
    fixture.snapshots.sessionDetailSnapshot(SESSION_ID).session.pendingMessageQuestions,
  ).toEqual([])
})
