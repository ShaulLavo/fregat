import { expect, onTestFinished, test } from 'vitest'
import * as v from 'valibot'
import { sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
} from '../../../test/factories/orchestration'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'

test.each([true, false])(
  'identical native item IDs keep replies in their owning sessions, streaming=%s',
  async (streaming) => {
    const fixture = await createOrchestrationFixture()
    onTestFinished(() => fixture.close())
    const registration = await fixture.register()
    if (!registration.result) throw new TypeError('Missing worktree registration')
    const sessions = [FIXTURE_SESSION_ID, 'dd67f20d-0726-4e18-ad15-a665c10bcddc']
    const ingestion = new ProviderRuntimeIngestion((command) => fixture.engine.dispatch(command))
    for (const [index, sessionId] of sessions.entries()) {
      await fixture.createSession(registration.result.worktreeId, sessionId)
      await fixture.startTurn(sessionId, `turn-${index}`)
      if (!streaming) continue
      await ingestion.ingest({
        type: 'content.delta',
        eventId: `delta-${index}`,
        itemId: 'shared-native-item',
        sessionId: v.parse(sessionIdSchema, sessionId),
        turnId: v.parse(turnIdSchema, `turn-${index}`),
        runtimeEpoch: `epoch-${index}`,
        createdAt: '2026-09-20T14:00:00.000Z',
        payload: { delta: `Owner ${index}`, streamKind: 'assistant_text' },
      })
    }
    for (const [index, sessionId] of sessions.entries()) {
      await ingestion.ingest({
        type: 'item.completed',
        eventId: `complete-${index}`,
        itemId: 'shared-native-item',
        sessionId: v.parse(sessionIdSchema, sessionId),
        turnId: v.parse(turnIdSchema, `turn-${index}`),
        runtimeEpoch: `epoch-${index}`,
        createdAt: '2026-09-20T14:00:01.000Z',
        payload: { itemType: 'assistant_message', detail: `Owner ${index}`, status: 'completed' },
      })
    }
    const replies = await Promise.all(
      sessions.map(async (sessionId) =>
        (await fixture.engine.sessionDetailSnapshot(sessionId)).session.messages.filter(
          (message) => message.role === 'assistant',
        ),
      ),
    )
    expect(replies.map((messages) => messages.map((message) => message.text))).toEqual([
      ['Owner 0'],
      ['Owner 1'],
    ])
    expect(replies[0]![0]!.id).not.toBe(replies[1]![0]!.id)
    expect(replies.map((messages) => messages[0]!.sessionId)).toEqual(sessions)

    await fixture.restart()
    for (const [index, sessionId] of sessions.entries()) {
      const detail = await fixture.engine.sessionDetailSnapshot(sessionId)
      expect(
        detail.session.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.text),
      ).toEqual([`Owner ${index}`])
    }
  },
)
