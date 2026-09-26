import { like } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { terminalHistoryChunks } from '../../db/schema'
import { createInProcessTerminalSocket } from '../../../test/terminal-socket'

test('deleting a session removes its ended agent terminal history and leaves the worktree shell', async () => {
  const fixture = await createAgentTerminalFixture()
  try {
    await fixture.turn()
    await fixture.engine.providerRuntimeIdle()
    const agent = fixture.socket('agent-view')
    const shell = createInProcessTerminalSocket(
      fixture.app,
      { worktreeId: fixture.worktreeId, terminalId: 'shell-view' },
      'platform-tui://local',
    )
    await agent.open()
    await shell.open()
    const agentIndex = fixture.pty.spawns.findIndex((spawn) =>
      spawn.command.includes('/configured/claude'),
    )
    const shellIndex = fixture.pty.spawns.findIndex(
      (spawn) => !spawn.command.includes('/configured/claude'),
    )
    expect(agentIndex).toBeGreaterThanOrEqual(0)
    expect(shellIndex).toBeGreaterThanOrEqual(0)
    fixture.pty.ptys[agentIndex]!.emit(new TextEncoder().encode('agent output\r\n'))
    await expect.poll(() => agentHistory(fixture)).toBeGreaterThan(0)
    // A live agent terminal refuses deletion (SESSION_IN_TERMINAL); its saved history outlives it.
    fixture.pty.ptys[agentIndex]!.exit(0)
    agent.detach()
    await expect
      .poll(
        async () =>
          (await fixture.engine.readModelSnapshot()).worktrees.get(fixture.worktreeId)
            ?.activeTerminalCount,
      )
      .toBe(1)
    expect(agentHistory(fixture)).toBeGreaterThan(0)

    await fixture.engine.dispatchClientCommand({
      type: 'session.delete',
      commandId: 'delete-terminal-session',
      sessionId: fixture.sessionId,
    })

    await expect.poll(() => agentHistory(fixture)).toBe(0)
    expect(fixture.pty.ptys[shellIndex]?.killed).toBe(false)
  } finally {
    await fixture.close()
  }
})

function agentHistory(fixture: Awaited<ReturnType<typeof createAgentTerminalFixture>>) {
  const suffix = JSON.stringify(['agent', fixture.sessionId]).slice(1)
  return fixture.database
    .select()
    .from(terminalHistoryChunks)
    .where(like(terminalHistoryChunks.owner, `%,${suffix}`))
    .all().length
}
