import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { createInternalError } from '../../observability/structured-errors'
import { terminalAgentLease } from '../agent-launch'

test('resumes the canonical Claude conversation with its configured binary and private instance environment', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    expect(await fixture.adapter.hasRuntime({ sessionId: fixture.sessionId })).toBe(true)
    const first = fixture.socket('first-view')
    const second = fixture.socket('second-view')
    await Promise.all([first.open(), second.open()])
    expect(fixture.pty.spawns).toHaveLength(1)
    expect(fixture.pty.spawns[0]).toMatchObject({
      command: ['/configured/claude', '--resume', fixture.sessionId],
      cwd: fixture.root,
      env: {
        CLAUDE_CONFIG_DIR: path.join(fixture.root, 'account'),
        TERMINAL_ACCOUNT_MARKER: 'private-account',
      },
    })
    expect(await fixture.adapter.hasRuntime({ sessionId: fixture.sessionId })).toBe(false)
    expect(first.messages[0]).toMatchObject({ type: 'ready', shell: '/configured/claude' })
    expect(second.messages[0]).toMatchObject({ type: 'ready' })
    await expect(fixture.turn()).rejects.toMatchObject({ code: 'provider.SESSION_IN_TERMINAL' })
    await expect(
      fixture.engine.dispatchClientCommand({
        type: 'project.delete',
        commandId: 'delete-occupied-project',
        projectId: fixture.projectId,
        force: true,
      }),
    ).rejects.toMatchObject({ code: 'provider.SESSION_IN_TERMINAL' })
    first.detach()
    second.detach()
    const resumed = fixture.socket('third-view')
    await resumed.open()
    expect(fixture.pty.spawns).toHaveLength(1)
    resumed.receive(JSON.stringify({ type: 'dispose' }))
    await expect.poll(() => fixture.pty.ptys[0]?.killed).toBe(true)
    await expect
      .poll(
        async () =>
          (await fixture.engine.readModelSnapshot()).worktrees.get(fixture.worktreeId)
            ?.activeTerminalCount,
      )
      .toBe(0)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('rejects another checkout and non-Claude providers before spawning', async () => {
  const fixture = await createAgentTerminalFixture()
  const unsupported = await createAgentTerminalFixture({ driverKind: 'codex' })
  try {
    const otherPath = path.join(fixture.root, 'other')
    await mkdir(otherPath)
    const other = await fixture.engine.dispatchClientCommand({
      type: 'project.create',
      commandId: 'other-checkout',
      workspaceRoot: otherPath,
      title: 'Other',
      defaultModelSelection: null,
    })
    expect(other.result).toBeDefined()
    if (!other.result) return
    const mismatch = fixture.socket('mismatch', other.result.worktreeId)
    await mismatch.open()
    expect(mismatch.messages).toContainEqual({
      type: 'error',
      message: 'The session cannot open in this terminal',
    })
    expect(fixture.pty.spawns).toHaveLength(0)
    const wrongProvider = unsupported.socket()
    await wrongProvider.open()
    expect(wrongProvider.messages).toContainEqual({
      type: 'error',
      message: 'Terminal resume requires an enabled Claude provider',
    })
    expect(unsupported.pty.spawns).toHaveLength(0)
  } finally {
    await fixture.close()
    await unsupported.close()
  }
})

test('an unavailable configured agent binary never falls back to a shell and releases ownership', async () => {
  const fixture = await createAgentTerminalFixture({
    pty: { failShells: new Set(['/configured/claude']) },
  })
  try {
    const socket = fixture.socket()
    await socket.open()
    expect(fixture.pty.spawns.map((spawn) => spawn.command)).toEqual([
      ['/configured/claude', '--resume', fixture.sessionId],
    ])
    expect(socket.messages.some((message) => message.type === 'error')).toBe(true)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('a detached agent keeps running and retains ownership until its process exits', async () => {
  const fixture = await createAgentTerminalFixture({ pty: { holdUntilExit: true } })
  try {
    const socket = fixture.socket()
    await socket.open()
    socket.detach()
    expect(fixture.pty.ptys[0]?.killed).toBe(false)
    await expect(fixture.turn()).rejects.toMatchObject({ code: 'provider.SESSION_IN_TERMINAL' })
    fixture.pty.ptys[0]?.exit(0)
    await expect
      .poll(
        async () =>
          (await fixture.engine.readModelSnapshot()).worktrees.get(fixture.worktreeId)
            ?.activeTerminalCount,
      )
      .toBe(0)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    fixture.pty.ptys[0]?.exit(0)
    await fixture.close()
  }
})

test('reserves the session before waiting for SDK stop and refuses an active turn', async () => {
  const fixture = await createAgentTerminalFixture()
  const stopping = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>()
  const originalStop = fixture.adapter.stopRuntime.bind(fixture.adapter)
  fixture.adapter.stopRuntime = async (input) => {
    stopping.resolve()
    await stopped.promise
    await originalStop(input)
  }
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    const socket = fixture.socket()
    const opening = socket.open()
    await stopping.promise
    expect(fixture.pty.spawns).toHaveLength(0)
    await expect(fixture.turn()).rejects.toMatchObject({ code: 'provider.SESSION_IN_TERMINAL' })
    stopped.resolve()
    await opening
    expect(fixture.pty.spawns).toHaveLength(1)
  } finally {
    stopped.resolve()
    await fixture.close()
  }
})

test('refuses terminal handoff while the provider is still processing a turn', async () => {
  const blocked = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const fixture = await createAgentTerminalFixture({
    provider: {
      beforeComplete: () => {
        entered.resolve()
        return blocked.promise
      },
    },
  })
  try {
    await fixture.turn()
    await entered.promise
    const socket = fixture.socket()
    await socket.open()
    expect(fixture.pty.spawns).toHaveLength(0)
    expect(socket.messages).toContainEqual({
      type: 'error',
      message: 'The session cannot open in this terminal',
    })
  } finally {
    blocked.resolve()
    await fixture.close()
  }
})

test('a failed SDK stop never starts a competing CLI', async () => {
  const fixture = await createAgentTerminalFixture({ provider: { stopError: 'SDK stop refused' } })
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    const socket = fixture.socket()
    await socket.open()
    expect(fixture.pty.spawns).toHaveLength(0)
    expect(socket.messages).toContainEqual({ type: 'error', message: 'SDK stop refused' })
  } finally {
    await fixture.close()
  }
})

test('CLI history appends once to the same conversation without replacing platform turns, plans, or checkpoints', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    const createdAt = '2026-09-07T12:00:00.000Z'
    await fixture.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.proposed-plan.upsert',
        commandId: 'preserved-plan',
        sessionId: fixture.sessionId,
        createdAt,
        proposedPlan: {
          id: 'platform-plan',
          sessionId: fixture.sessionId,
          turnId: 'turn-1',
          planMarkdown: '# Preserve this plan',
          implementedAt: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    )
    await fixture.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.turn.diff.complete',
        commandId: 'preserved-checkpoint',
        sessionId: fixture.sessionId,
        turnId: 'turn-1',
        completedAt: createdAt,
        checkpointRef: 'refs/platform/checkpoints/turn-1',
        status: 'ready',
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    )
    const original = await fixture.engine.sessionDetailSnapshot(fixture.sessionId)
    const before = original.session
    expect(original.proposedPlans).toHaveLength(1)
    expect(original.checkpoints).toHaveLength(1)
    fixture.adapter.history = before.messages.flatMap((message, index) => {
      if (message.role === 'system') return []
      return [
        {
          sourceId: `provider-old-${index}`,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
        },
      ]
    })
    const socket = fixture.socket()
    await socket.open()
    const cliMessage = {
      sourceId: 'cli-user',
      role: 'user' as const,
      text: 'Continue in the terminal',
      createdAt: '2026-09-07T13:00:00.000Z',
    }
    fixture.adapter.history = [
      ...fixture.adapter.history,
      cliMessage,
      cliMessage,
      { sourceId: 'cli-assistant', role: 'assistant', text: 'Terminal reply', createdAt: null },
    ]
    fixture.pty.ptys[0]?.exit(0)
    await expect.poll(() => socket.closes.length).toBe(1)
    const synchronized = await fixture.engine.sessionDetailSnapshot(fixture.sessionId)
    const after = synchronized.session
    expect(after.messages).toHaveLength(before.messages.length + 2)
    expect(after.messages.filter((message) => !message.id.startsWith('terminal:'))).toEqual(
      before.messages,
    )
    expect(after.messages.filter((message) => message.id.startsWith('terminal:'))).toMatchObject([
      { role: 'user', text: cliMessage.text, turnId: null, streaming: false },
      { role: 'assistant', text: 'Terminal reply', turnId: null, streaming: false },
    ])
    expect(synchronized.proposedPlans).toEqual(original.proposedPlans)
    expect(synchronized.checkpoints).toEqual(original.checkpoints)
    expect(after.latestTurn).toEqual(before.latestTurn)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('failed CLI history remains visible and reconnect retries synchronization without respawning', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    const socket = fixture.socket()
    await socket.open()
    fixture.adapter.history = [
      { sourceId: 'cli-reply', role: 'assistant', text: 'Recovered reply', createdAt: null },
    ]
    fixture.adapter.historyError = 'Provider history is unavailable'
    fixture.pty.ptys[0]?.exit(0)
    await expect
      .poll(() => socket.messages.find((message) => message.type === 'error'))
      .toEqual({
        type: 'error',
        message:
          'Provider history is unavailable Reconnect this terminal to retry synchronization.',
      })
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_HISTORY_PENDING',
    })
    const failed = (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session
    expect(failed.activities).toContainEqual(
      expect.objectContaining({ kind: 'terminal.history.failed', tone: 'error' }),
    )
    expect(failed.messages).toHaveLength(0)
    fixture.adapter.historyError = null
    const retry = fixture.socket('new-viewer')
    await retry.open()
    await expect.poll(() => retry.closes.length).toBe(1)
    expect(retry.messages).toContainEqual({ type: 'exit', exitCode: 0 })
    expect(fixture.pty.spawns).toHaveLength(1)
    const recovered = (await fixture.engine.sessionDetailSnapshot(fixture.sessionId)).session
    expect(recovered.messages).toMatchObject([{ text: 'Recovered reply' }])
    expect(
      (await fixture.engine.readModelSnapshot()).worktrees.get(fixture.worktreeId)
        ?.activeTerminalCount,
    ).toBe(0)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('retry after a committed history append reuses its receipt and message event identities', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    const lease = await fixture.engine.beginTerminalLease(fixture.worktreeId)
    const launch = await fixture.engine.beginAgentTerminal({
      sessionId: fixture.sessionId,
      worktreeId: fixture.worktreeId,
      terminalLeaseId: lease.terminalLeaseId,
      runtimeEpoch: lease.runtimeEpoch,
    })
    let failEnd = true
    const combined = terminalAgentLease(
      {
        ...lease,
        async end() {
          if (failEnd) {
            failEnd = false
            throw createInternalError('Lease completion temporarily unavailable')
          }
          await lease.end()
        },
      },
      launch,
    )
    await combined.activate()
    fixture.adapter.history = [
      { sourceId: 'committed-cli-reply', role: 'assistant', text: 'Saved once', createdAt: null },
    ]
    await expect(combined.end()).rejects.toMatchObject({
      message: 'Lease completion temporarily unavailable',
    })
    const committed = await fixture.engine.replay({
      afterSequence: 0,
      sessionId: fixture.sessionId,
    })
    const original = committed.events.filter((event) => event.type === 'session.message-sent')
    expect(original).toHaveLength(1)
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_HISTORY_PENDING',
    })
    await combined.end()
    const retried = await fixture.engine.replay({ afterSequence: 0, sessionId: fixture.sessionId })
    expect(retried.events.filter((event) => event.type === 'session.message-sent')).toEqual(
      original,
    )
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('a failed initial history read releases ownership before any CLI starts', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    fixture.adapter.historyError = 'History baseline is unavailable'
    const socket = fixture.socket()
    await socket.open()
    expect(socket.messages).toContainEqual({ type: 'error', message: fixture.adapter.historyError })
    expect(fixture.pty.spawns).toHaveLength(0)
    fixture.adapter.historyError = null
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    await fixture.close()
  }
})

test('an unresponsive history reader times out with recoverable ownership instead of blocking cleanup', async () => {
  const fixture = await createAgentTerminalFixture({ provider: { operationTimeoutMs: 30 } })
  const historyRead = Promise.withResolvers<void>()
  try {
    const socket = fixture.socket()
    await socket.open()
    fixture.adapter.historyReadGate = historyRead.promise
    fixture.pty.ptys[0]?.exit(0)
    await expect
      .poll(() => socket.messages.find((message) => message.type === 'error'))
      .toEqual({
        type: 'error',
        message:
          'The provider operation timed out Reconnect this terminal to retry synchronization.',
      })
    await expect(fixture.turn()).rejects.toMatchObject({
      code: 'provider.TERMINAL_HISTORY_PENDING',
    })
    historyRead.resolve()
    const retry = fixture.socket('timeout-retry')
    await retry.open()
    await expect.poll(() => retry.closes.length).toBe(1)
    expect(fixture.pty.spawns).toHaveLength(1)
    await expect(fixture.turn()).resolves.toMatchObject({ deduped: false })
  } finally {
    historyRead.resolve()
    await fixture.close()
  }
})
