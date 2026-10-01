import { afterEach, expect, test } from 'vitest'
import * as v from 'valibot'
import { approvalRequestIdSchema } from '@workspace/contracts'
import { createAcpAppFixture } from '../../../test/factories/acp-app'
import { closeTestApps } from '../../../test/server'
import { cursorDriver } from '../drivers/cursor'

const fixtures: Awaited<ReturnType<typeof createAcpAppFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('real app routes settle Cursor answers and advertised permission decisions in the read model', async () => {
  const fixture = await createAcpAppFixture(cursorDriver)
  fixtures.push(fixture)
  const sessionId = fixture.input.sessionId
  const created = await fixture.command({
    type: 'session.create',
    commandId: 'cursor-app-session',
    sessionId,
    title: 'Cursor app acceptance',
    worktreeTarget: { kind: 'current', worktreeId: fixture.registration.worktreeId },
    modelSelection: fixture.input.modelSelection,
    runtimeMode: 'approval-required',
  })
  expect(created.status, await created.clone().text()).toBe(200)
  const answer = await fixture.command({
    type: 'session.turn.start',
    runtimeMode: 'approval-required',
    commandId: 'cursor-app-answer',
    sessionId,
    turnId: 'cursor-app-answer-turn',
    message: {
      messageId: 'cursor-app-answer-message',
      role: 'user',
      text: 'hello',
      attachments: [],
    },
  })
  expect(answer.status, await answer.clone().text()).toBe(200)
  await expect
    .poll(async () => {
      const snapshot = await fixture.engine.sessionDetailSnapshot(sessionId)
      return snapshot.session.latestTurn?.state
    })
    .toBe('completed')
  const answered = await fixture.engine.sessionDetailSnapshot(sessionId)
  expect(answered.session.messages).toContainEqual(
    expect.objectContaining({
      role: 'assistant',
      text: expect.stringContaining('fixture:hello:'),
      turnId: 'cursor-app-answer-turn',
    }),
  )
  const permission = await fixture.command({
    type: 'session.turn.start',
    runtimeMode: 'approval-required',
    commandId: 'cursor-app-permission',
    sessionId,
    turnId: 'cursor-app-permission-turn',
    message: {
      messageId: 'cursor-app-permission-message',
      role: 'user',
      text: 'permission',
      attachments: [],
    },
  })
  expect(permission.status, await permission.clone().text()).toBe(200)
  await expect
    .poll(async () =>
      (await fixture.records()).some(
        (entry) =>
          entry.method === 'session/prompt' && entry.params.prompt[0].text === 'permission',
      ),
    )
    .toBe(true)
  await expect
    .poll(async () => {
      const snapshot = await fixture.engine.sessionDetailSnapshot(sessionId)
      return snapshot.session.activities.find((activity) => activity.kind === 'approval.requested')
    })
    .toBeDefined()
  const awaiting = await fixture.engine.sessionDetailSnapshot(sessionId)
  const { requestId } = v.parse(
    v.object({ requestId: approvalRequestIdSchema }),
    awaiting.session.activities.find((activity) => activity.kind === 'approval.requested')?.payload,
  )
  const decision = await fixture.command({
    type: 'session.approval.respond',
    commandId: 'cursor-app-allow',
    sessionId,
    requestId,
    decision: 'accept',
  })
  expect(decision.status, await decision.clone().text()).toBe(200)
  await expect
    .poll(
      async () => (await fixture.engine.sessionDetailSnapshot(sessionId)).session.latestTurn?.state,
    )
    .toBe('completed')
  const records = await fixture.records()
  expect(records.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
  expect(records.filter((entry) => entry.id === 'permission-1')).toMatchObject([
    { result: { outcome: { outcome: 'selected', optionId: 'yes' } } },
  ])
})
