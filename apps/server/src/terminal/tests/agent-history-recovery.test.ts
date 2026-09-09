import { test, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { agentTerminalHandoffs } from '../../db/schema'
import { createInternalError } from '../../observability/structured-errors'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'

test('recovers exited CLI history from the original baseline after reopening the database', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    const original = (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session
      .messages
    fixture.adapter.history = original.flatMap((message, index) =>
      message.role === 'system'
        ? []
        : [{ sourceId: `old-${index}`, role: message.role, text: message.text, createdAt: null }],
    )
    const socket = fixture.socket()
    await socket.open()
    fixture.adapter.history.push({
      sourceId: 'cli-reply',
      role: 'assistant',
      text: 'Recovered after restart',
      createdAt: null,
    })
    fixture.adapter.historyError = 'History temporarily unavailable'
    fixture.pty.ptys[0]?.exit(0)
    await expect.poll(() => socket.messages.some((message) => message.type === 'error')).toBe(true)
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_HISTORY_PENDING',
    })
    fixture.adapter.historyError = null
    await fixture.restart()
    const after = (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.messages
    expect(after).toHaveLength(original.length + 1)
    expect(after.at(-1)?.text).toBe('Recovered after restart')
    expect(fixture.database.select().from(agentTerminalHandoffs).all()).toEqual([])
    expect(fixture.pty.spawns).toHaveLength(1)
    await fixture.restart()
    expect(
      (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.messages,
    ).toEqual(after)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('retains failed recovery across restart and retries from a terminal reconnect', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    const socket = fixture.socket()
    await socket.open()
    fixture.adapter.history = [
      { sourceId: 'retry-reply', role: 'assistant', text: 'Retry this history', createdAt: null },
    ]
    fixture.adapter.historyError = 'History is still unavailable'
    fixture.pty.ptys[0]?.exit(0)
    await expect.poll(() => socket.messages.some((message) => message.type === 'error')).toBe(true)
    await fixture.restart()
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_HISTORY_PENDING',
    })
    expect(fixture.database.select().from(agentTerminalHandoffs).all()).toHaveLength(1)
    expect(
      (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.activities,
    ).toContainEqual(expect.objectContaining({ kind: 'terminal.history.failed', tone: 'error' }))
    const worktree = (await fixture.engine.readModelSnapshot()).worktrees.get(fixture.worktreeId)
    expect(worktree).toMatchObject({ activeTerminalCount: 0, terminalOwnershipUnknown: false })
    fixture.adapter.historyError = null
    const retry = fixture.socket('restart-retry')
    await retry.open()
    expect(fixture.pty.spawns).toHaveLength(2)
    fixture.pty.ptys[1]?.exit(0)
    await expect.poll(() => retry.closes.length).toBe(1)
    expect(
      (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.messages,
    ).toMatchObject([{ text: 'Retry this history' }])
    expect(fixture.database.select().from(agentTerminalHandoffs).all()).toEqual([])
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('restart reuses committed history events when deleting the recovery record failed', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    const socket = fixture.socket()
    await socket.open()
    fixture.adapter.history = [
      {
        sourceId: 'committed-reply',
        role: 'assistant',
        text: 'Saved exactly once',
        createdAt: null,
      },
    ]
    fixture.database.run(
      sql`CREATE TRIGGER retain_terminal_handoff BEFORE DELETE ON agent_terminal_handoffs BEGIN SELECT RAISE(ABORT, 'cleanup temporarily unavailable'); END`,
    )
    fixture.pty.ptys[0]?.exit(0)
    await expect.poll(() => socket.messages.some((message) => message.type === 'error')).toBe(true)
    const before = await fixture.engine.replay({ afterSequence: 0, sessionId: fixture.sessionId })
    const messages = before.events.filter((event) => event.type === 'session.message-sent')
    expect(messages).toHaveLength(1)
    fixture.database.run(sql`DROP TRIGGER retain_terminal_handoff`)
    await fixture.restart()
    const after = await fixture.engine.replay({ afterSequence: 0, sessionId: fixture.sessionId })
    expect(after.events.filter((event) => event.type === 'session.message-sent')).toEqual(messages)
    expect(fixture.database.select().from(agentTerminalHandoffs).all()).toEqual([])
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('an unconfirmed CLI exit survives restart as visible unknown ownership', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    const socket = fixture.socket()
    await socket.open()
    fixture.pty.ptys[0]?.fail(createInternalError('Native process ownership lost'))
    await expect.poll(() => socket.closes.length).toBe(1)
    await fixture.restart()
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_OWNERSHIP_UNKNOWN',
    })
    const retry = fixture.socket('unconfirmed-retry')
    await retry.open()
    expect(retry.messages).toContainEqual({
      type: 'error',
      message: 'The previous terminal process may still own this session',
    })
    expect(fixture.pty.spawns).toHaveLength(1)
    expect(fixture.database.select().from(agentTerminalHandoffs).all()).toMatchObject([
      { phase: 'active' },
    ])
    expect(
      (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session.activities,
    ).toContainEqual(expect.objectContaining({ kind: 'terminal.ownership.unknown', tone: 'error' }))
  } finally {
    await fixture.close()
  }
})
