import assert from 'node:assert/strict'
import * as v from 'valibot'
import { orchestrationForApp } from 'server/testing'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  orchestrationCommandSchema,
  sessionIdSchema,
} from '@workspace/contracts'
import { createSessionRenameCommand } from '@workspace/client-core/chat/commands'
import {
  selectChatSessionById,
  selectChatSessionHasEarlier,
} from '@workspace/client-core/chat/selectors'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'

import { test, expect } from '../../../test/fixtures'
import { createControlledInProcessTransport } from '../../../test/client'
import { openTestChat } from '../../../test/factories/chat'

test('a newer replay cannot hide a history replacement in the reconciliation snapshot', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const { session, chat } = await openTestChat(server, {
    client,
    createSocket: transport.createSocket,
  })
  let releaseSnapshot: (() => void) | undefined
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const engine = orchestrationForApp(server.app)
    assert(engine)
    const sessionId = v.parse(sessionIdSchema, '08eaf19d-fcdb-4e43-a3f3-5a5985b7375d')
    await engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.discover',
        commandId: 'reconciliation-imported-session',
        sessionId,
        worktreeId,
        title: 'Imported conversation',
        modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
        sourceUpdatedAt: '2026-09-08T00:00:00.000Z',
      }),
    )
    const count = ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 3
    const history: Parameters<typeof engine.importSessionHistory>[1] = Array.from(
      { length: count },
      (_, index) => ({
        sourceId: `source-${index}`,
        role: 'user',
        text: `Original ${index}`,
        createdAt: null,
      }),
    )
    await engine.importSessionHistory(sessionId, history, '2026-09-08T01:00:00.000Z')
    chat.selectSession(sessionId)
    await expect.poll(() => chat.getSnapshot().detailLoading).toBe(false)
    await chat.loadEarlier()
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages).toHaveLength(
      count,
    )
    expect(selectChatSessionHasEarlier(chat.getSnapshot().projection, sessionId)).toBe(false)
    const original = await engine.sessionDetailSnapshot(sessionId)
    chat.selectSession(null)

    const rewritten = history.map((message, index) =>
      index === 0 ? { ...message, text: 'Rewritten first message' } : message,
    )
    await engine.importSessionHistory(sessionId, rewritten, '2026-09-08T02:00:00.000Z')
    expect((await engine.sessionDetailSnapshot(sessionId)).session.messages).toEqual(
      original.session.messages,
    )
    const held = transport.pauseNextResponse('/orchestration/session-detail')
    releaseSnapshot = held.release
    const dispatch = chat.dispatch(createSessionRenameCommand({ sessionId, title: 'First rename' }))
    await held.reached
    await engine.dispatchClientCommand(
      createSessionRenameCommand({ sessionId, title: 'Newest rename' }),
    )
    held.release()
    await dispatch

    // Reselecting would read another snapshot and hide incorrect reconciliation of the cached pages.
    expect(selectChatSessionHasEarlier(chat.getSnapshot().projection, sessionId)).toBe(true)
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages).toHaveLength(
      ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
    )
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.title).toBe(
      'Newest rename',
    )
    chat.selectSession(sessionId)
    await expect.poll(() => chat.getSnapshot().detailLoading).toBe(false)
    await chat.loadEarlier()
    const reconciled = selectChatSessionById(chat.getSnapshot().projection, sessionId)
    expect(reconciled?.messages.map((message) => message.text)).toEqual(
      rewritten.map((message) => message.text),
    )
    expect(reconciled?.title).toBe('Newest rename')
  } finally {
    releaseSnapshot?.()
    session.dispose()
  }
})
