import { sessionLifecycleUndoEntry } from '@workspace/client-core/chat/rail/lifecycle-undo'
import assert from 'node:assert/strict'
import * as v from 'valibot'
import { sessionIdSchema, scopedSessionKey, scopedProjectKey } from '@workspace/contracts'
import {
  createSessionArchiveCommand,
  createSessionActiveReorderCommand,
  createSessionLifecycleCommand,
  createSessionRenameCommand,
} from '@workspace/client-core/chat/commands'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { createAgentRailState } from '@/agent-rail/state/rail'
import { test, expect } from '../../../test/fixtures'
import { openTestChat, draftChatTurn } from '../../../test/factories/chat'
import { createRailSession } from '../../../test/factories/agent-rail'
import { createControlledInProcessTransport } from '../../../test/client'

test.for([
  { key: 'agent:rail:collapsed', raw: '{' },
  { key: 'agent:rail:collapsed', raw: '[3]' },
  { key: 'agent:rail:collapsed', raw: '' },
  { key: 'agent:rail:seen', raw: '{' },
  { key: 'agent:rail:seen', raw: '[3]' },
  { key: 'agent:rail:seen', raw: '' },
])(
  'deletes corrupt rail state and warns once: $key = $raw',
  async ({ key, raw }, { server, storageWarnings }) => {
    const { session } = await openTestChat(server)
    try {
      const ready = session.getSnapshot()
      assert(ready.kind === 'ready')
      ready.storage.setItem(key, raw)
      const store = createAgentRailState(session, ready)
      expect(store.getSnapshot()).toMatchObject({ collapsed: [], seen: {} })
      expect(ready.storage.getItem(key)).toBeNull()
      store.dispose()
      const reopened = createAgentRailState(session, ready)
      expect(reopened.getSnapshot()).toMatchObject({ collapsed: [], seen: {} })
      reopened.dispose()
      expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: key }])
    } finally {
      session.dispose()
    }
  },
)

test('absent rail state uses empty defaults without warning', async ({
  server,
  storageWarnings,
}) => {
  const { session } = await openTestChat(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const store = createAgentRailState(session, ready)
    expect(store.getSnapshot()).toMatchObject({ collapsed: [], seen: {} })
    store.dispose()
    expect(storageWarnings).toEqual([])
  } finally {
    session.dispose()
  }
})

test('project registration, durable collapse and read stamps, and partial bulk failures use real state', async ({
  server,
}) => {
  const { session, chat } = await openTestChat(server)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const store = createAgentRailState(session, ready)
  try {
    const project = await store.addProject('')
    assert(project)
    const first = await createRailSession(chat, project.worktreeId, 'First session')
    const second = await createRailSession(chat, project.worktreeId, 'Second session')
    const projectKey = scopedProjectKey({
      environmentId: ready.descriptor.environmentId,
      projectId: project.projectId,
    })
    store.toggleCollapsed([projectKey])
    const otherKey = 'second-member-key'
    store.toggleCollapsed([projectKey, otherKey])
    expect(store.getSnapshot().collapsed).toEqual([projectKey, otherKey])
    store.toggleCollapsed([projectKey, otherKey])
    expect(store.getSnapshot().collapsed).toEqual([])
    store.toggleCollapsed([projectKey])
    store.setScope('repository:shared')
    expect(store.getSnapshot().scope).toBe('repository:shared')
    store.markSeen(first, '2026-07-01T12:00:00.000Z')
    const reopened = createAgentRailState(session, ready)
    expect(reopened.getSnapshot().collapsed).toEqual([projectKey])
    expect(
      reopened.getSnapshot().seen[
        scopedSessionKey({ environmentId: ready.descriptor.environmentId, sessionId: first })
      ],
    ).toBe('2026-07-01T12:00:00.000Z')
    reopened.dispose()
    store.markAll([first, second])
    const invalid = v.parse(sessionIdSchema, crypto.randomUUID())
    const accepted = await store.execute(
      [
        createSessionArchiveCommand({ sessionId: first }),
        createSessionRenameCommand({ sessionId: invalid, title: 'Missing' }),
        createSessionArchiveCommand({ sessionId: second }),
      ],
      true,
    )
    expect(accepted).toBeNull()
    expect(store.getSnapshot().marked).toEqual([second])
    expect(store.getSnapshot().error).toBeTruthy()
    expect(chat.getSnapshot().projection.sessionById[first]?.archivedAt).not.toBeNull()
    expect(chat.getSnapshot().projection.sessionById[second]?.archivedAt).toBeNull()
    expect(
      await store.execute([createSessionArchiveCommand({ sessionId: second })], true),
    ).toMatchObject({
      deduped: false,
      lifecycle: { kind: 'session.lifecycle', sessionId: second },
    })
    expect(store.getSnapshot().marked).toEqual([])
  } finally {
    store.dispose()
    session.dispose()
  }
})

test('new transcript query clears and supersedes a delayed old search result', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const { session, chat } = await openTestChat(server, {
    client,
    createSocket: transport.createSocket,
  })
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const store = createAgentRailState(session, ready)
  const gate = transport.pauseNextResponse('/orchestration/session-search')
  try {
    const worktree = await session.ensureWorktree('')
    const first = draftChatTurn(worktree, 'First searchable needle')
    await chat.dispatch(first.command)
    const second = draftChatTurn(worktree, 'Second searchable phrase')
    await chat.dispatch(second.command)
    store.setQuery('needle')
    await gate.reached
    store.setQuery('phrase')
    expect(store.getSnapshot().search).toEqual({})
    await expect.poll(() => store.getSnapshot().searching).toBe(false)
    expect(Object.values(store.getSnapshot().search).map((item) => item.sessionId)).toEqual([
      second.command.sessionId,
    ])
    gate.release()
    await expect
      .poll(
        () =>
          transport.requests.filter(
            (request) => new URL(request.url).pathname === '/orchestration/session-search',
          ).length,
      )
      .toBe(2)
    expect(Object.values(store.getSnapshot().search).map((item) => item.sessionId)).toEqual([
      second.command.sessionId,
    ])
    store.setQuery('x')
    expect(store.getSnapshot().search).toEqual({})
    expect(store.getSnapshot().searching).toBe(false)
  } finally {
    gate.release()
    store.dispose()
    session.dispose()
  }
})

test('reordering clears stale Undo for every successfully changed session', async ({ server }) => {
  const { session, chat } = await openTestChat(server)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const store = createAgentRailState(session, ready)
  try {
    const project = await store.addProject('')
    assert(project)
    const first = await createRailSession(chat, project.worktreeId, 'First')
    const second = await createRailSession(chat, project.worktreeId, 'Second')
    for (const sessionId of [first, second]) {
      await store.execute([
        createSessionLifecycleCommand(sessionId, { type: 'pin', orderKey: 'm' }),
      ])
      const result = await store.execute([
        createSessionLifecycleCommand(sessionId, { type: 'unpin' }),
      ])
      assert(result)
      const entry = sessionLifecycleUndoEntry(
        { environmentId: ready.descriptor.environmentId, sessionId },
        result,
      )!
      store.offerUndo('unpin', [{ ...entry, selected: false }])
    }
    const moved = await store.execute([
      createSessionActiveReorderCommand({ sessionId: first, orderKey: 'm' }),
      createSessionActiveReorderCommand({ sessionId: second, orderKey: 'n' }),
    ])
    expect(moved).not.toBeNull()
    expect(store.getSnapshot().undo).toBeNull()
  } finally {
    store.dispose()
    session.dispose()
  }
})
