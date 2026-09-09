import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  commandIdSchema,
  sessionIdSchema,
} from '@workspace/contracts'
import type { ProviderHistoryMessage } from '../../provider/types'
import { discoveryHistory, sessionImportFixture } from './factories/discovery'

test('startup updates only imported chats and manual import selects one provider', async () => {
  const fixture = await sessionImportFixture()
  const { reconciler, source, row, sessionId, instance, otherInstance } = fixture
  const unseen = v.parse(sessionIdSchema, 'c92e79b6-c6cb-4b58-ae17-2a77a5bf721e')
  source.rows.push({ ...row, providerInstanceId: otherInstance, sessionId: unseen })
  try {
    reconciler.start()
    await reconciler.refresh()
    expect((await fixture.engine.shellSnapshot()).sessions).toEqual([])
    expect(source.reads).toEqual([])

    source.scans.length = 0
    expect(await reconciler.scan(instance)).toMatchObject({ imported: 1, messages: 2 })
    expect(source.scans).toEqual([instance])
    expect((await fixture.engine.shellSnapshot()).sessions.map((session) => session.id)).toEqual([
      sessionId,
    ])

    source.messages = discoveryHistory('External update')
    row.sourceUpdatedAt = '2026-09-05T01:00:00.000Z'
    expect(await reconciler.refresh()).toMatchObject({ imported: 0, refreshed: 1 })
    expect((await fixture.engine.shellSnapshot()).sessions.map((session) => session.id)).toEqual([
      sessionId,
    ])
    expect((await fixture.engine.sessionDetailSnapshot(sessionId)).session.messages[0]?.text).toBe(
      'External update',
    )
    expect(source.reads).not.toContain(unseen)
  } finally {
    await fixture.close()
  }
})

test('imports long conversation text into SQL pagination and search without running a turn', async () => {
  const fixture = await sessionImportFixture()
  const { source, reconciler, sessionId, instance } = fixture
  const count = ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 3
  source.messages = Array.from({ length: count }, (_, index): ProviderHistoryMessage => ({
    sourceId: `source-${count - index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: index === 0 ? 'Buried kingfisher decision' : `Historical message ${index}`,
    createdAt: null,
  }))
  try {
    expect(await reconciler.scan(instance)).toMatchObject({ imported: 1, messages: count })
    const detail = await fixture.engine.sessionDetailSnapshot(sessionId)
    expect(detail.session.messages).toHaveLength(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
    expect(detail.session.latestTurn).toBeNull()
    expect(detail.session.runtime).toBeNull()
    const first = detail.session.messages[0]
    expect(first).toBeDefined()
    if (!first) return
    const earlier = await fixture.engine.sessionDetailPage({
      sessionId,
      beforeMessage: { id: first.id, createdAt: first.createdAt },
    })
    expect(
      [...earlier.messages, ...detail.session.messages].map((message) => message.text),
    ).toEqual(source.messages.map((message) => message.text))
    expect(fixture.search.search({ query: 'kingfisher' }).matches).toMatchObject([
      { sessionId, source: 'user', snippet: 'Buried kingfisher decision' },
    ])
    const events = (await fixture.engine.replay({ afterSequence: 0 })).events
    expect(events.some((event) => event.type === 'session.turn-start-requested')).toBe(false)
    const sequence = (await fixture.engine.shellSnapshot()).snapshotSequence
    expect(await reconciler.scan(instance)).toMatchObject({
      imported: 0,
      refreshed: 0,
      messages: 0,
    })
    expect((await fixture.engine.shellSnapshot()).snapshotSequence).toBe(sequence)
    expect(source.reads).toEqual([sessionId])
  } finally {
    await fixture.close()
  }
})

test('replaces rewritten history and accepts source A again after source B', async () => {
  const fixture = await sessionImportFixture()
  const { source, row, reconciler, sessionId, instance } = fixture
  const original = source.messages
  const originalUpdatedAt = row.sourceUpdatedAt
  try {
    await reconciler.scan(instance)
    const originalDetail = await fixture.engine.sessionDetailSnapshot(sessionId)
    source.messages = discoveryHistory('Replacement conversation').slice(0, 1)
    row.sourceUpdatedAt = '2026-09-05T02:00:00.000Z'
    await reconciler.refresh()
    expect(
      (await fixture.engine.sessionDetailSnapshot(sessionId)).session.messages.map(
        (message) => message.text,
      ),
    ).toEqual(['Replacement conversation'])
    expect(fixture.search.search({ query: 'Existing answer' }).matches).toEqual([])

    source.messages = original
    row.sourceUpdatedAt = originalUpdatedAt
    expect(await reconciler.refresh()).toMatchObject({ refreshed: 1, messages: 2 })
    expect((await fixture.engine.sessionDetailSnapshot(sessionId)).session.messages).toEqual(
      originalDetail.session.messages,
    )
    const events = (await fixture.engine.replay({ afterSequence: 0 })).events
    expect(events.filter((event) => event.type === 'session.history-imported')).toHaveLength(3)
  } finally {
    await fixture.close()
  }
})

test('stops external updates at the first Platform message even when source reading races it', async () => {
  const fixture = await sessionImportFixture()
  const { source, row, reconciler, sessionId, instance } = fixture
  try {
    await reconciler.scan(instance)
    source.messages = discoveryHistory('External text that must not replace Platform text')
    row.sourceUpdatedAt = '2026-09-05T03:00:00.000Z'
    source.beforeRead = async () => {
      await fixture.engine.dispatchClientCommand({
        type: 'session.turn.start',
        commandId: 'continue-imported-session',
        sessionId,
        turnId: 'platform-turn',
        message: { messageId: 'platform-message', role: 'user', text: 'Continue here' },
      })
    }
    expect(await reconciler.refresh()).toMatchObject({ refreshed: 0, messages: 0 })
    const texts = (await fixture.engine.sessionDetailSnapshot(sessionId)).session.messages.map(
      (message) => message.text,
    )
    expect(texts).toEqual(['Existing conversation', 'Existing answer', 'Continue here'])
    expect(fixture.engine.canImportSessionHistory(sessionId)).toBe(false)
    expect(await reconciler.scan(instance)).toMatchObject({
      skipped: { 'continued-in-platform': 1 },
    })

    await fixture.engine.dispatch({
      type: 'session.revert.complete',
      commandId: v.parse(commandIdSchema, 'revert-imported-turn'),
      sessionId,
      turnCount: 0,
      createdAt: '2026-09-05T04:00:00.000Z',
    })
    expect((await fixture.engine.sessionDetailSnapshot(sessionId)).session.latestTurn).toBeNull()
    expect(fixture.engine.canImportSessionHistory(sessionId)).toBe(false)
    expect(
      await fixture.engine.importSessionHistory(sessionId, source.messages, row.sourceUpdatedAt),
    ).toBe(false)
  } finally {
    await fixture.close()
  }
})

test('does not create empty chat rows when a source has no conversation text', async () => {
  const fixture = await sessionImportFixture()
  try {
    fixture.source.messages = []
    expect(await fixture.reconciler.scan(fixture.instance)).toMatchObject({
      imported: 0,
      skipped: { 'no-conversation-text': 1 },
    })
    expect((await fixture.engine.shellSnapshot()).sessions).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('history replacement sends a bounded snapshot to live and reconnecting session readers', async () => {
  const fixture = await sessionImportFixture()
  const { source, row, reconciler, sessionId, instance } = fixture
  const abort = new AbortController()
  await reconciler.scan(instance)
  const stream = fixture.engine.sessionDetailStream(sessionId, { signal: abort.signal })
  try {
    expect((await stream.next()).value).toMatchObject({ kind: 'snapshot' })
    const synchronized = (await stream.next()).value
    expect(synchronized).toMatchObject({ kind: 'synchronized' })
    if (!synchronized || synchronized.kind !== 'synchronized') return
    const incoming = stream.next()
    source.messages = Array.from(
      { length: ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 5 },
      (_, index): ProviderHistoryMessage => ({
        sourceId: `stream-message-${index}`,
        role: 'assistant',
        text: `Replacement ${index}`,
        createdAt: null,
      }),
    )
    row.sourceUpdatedAt = '2026-09-05T05:00:00.000Z'
    await reconciler.refresh()
    const live = (await incoming).value
    expect(live).toMatchObject({ kind: 'snapshot' })
    if (!live || live.kind !== 'snapshot') return
    expect(live.snapshot.session.messages).toHaveLength(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)
    expect(live.snapshot.session.messages[0]?.text).toBe('Replacement 5')

    const resumed = fixture.engine.sessionDetailStream(sessionId, {
      afterSequence: synchronized.sequence,
      signal: abort.signal,
    })
    try {
      expect((await resumed.next()).value).toEqual(live)
    } finally {
      await resumed.return()
    }
  } finally {
    abort.abort()
    await stream.return()
    await fixture.close()
  }
})
