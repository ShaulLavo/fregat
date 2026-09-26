import { like } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { terminalHistoryChunks } from '../../db/schema'
import { createInProcessTerminalSocket } from '../../../test/terminal-socket'

type Fixture = Awaited<ReturnType<typeof createAgentTerminalFixture>>

// Fake PTY pids start at 10000; the second shell opened runs a program in its foreground.
const BUSY_PID = 10_001

async function openShells(fixture: Fixture) {
  const idle = shell(fixture, 'idle-shell')
  const busy = shell(fixture, 'busy-shell')
  await idle.open()
  await busy.open()
  expect(fixture.pty.ptys.map((pty) => pty.pid)).toEqual([10_000, BUSY_PID])
  fixture.pty.ptys[0]!.emit(new TextEncoder().encode('idle output\r\n'))
  await expect.poll(() => history(fixture, 'idle-shell')).toBeGreaterThan(0)
  return { idle: fixture.pty.ptys[0]!, busy: fixture.pty.ptys[1]! }
}

function shell(fixture: Fixture, terminalId: string) {
  return createInProcessTerminalSocket(
    fixture.app,
    { worktreeId: fixture.worktreeId, terminalId },
    'platform-tui://local',
  )
}

function history(fixture: Fixture, terminalId: string) {
  return fixture.database
    .select()
    .from(terminalHistoryChunks)
    .where(like(terminalHistoryChunks.owner, `%"${terminalId}"%`))
    .all().length
}

function busyForeground(pid: number) {
  return Promise.resolve(pid === BUSY_PID ? 'vim' : null)
}

test('settling the last live session closes its worktree shells at a prompt and keeps their output', async () => {
  const fixture = await createAgentTerminalFixture({ foregroundProcess: busyForeground })
  try {
    const { idle, busy } = await openShells(fixture)

    await fixture.engine.dispatchClientCommand({
      type: 'session.settle',
      commandId: 'settle-last-session',
      sessionId: fixture.sessionId,
    })

    await expect.poll(() => idle.killed).toBe(true)
    await fixture.engine.providerRuntimeIdle()
    expect(busy.killed).toBe(false)
    expect(history(fixture, 'idle-shell')).toBeGreaterThan(0)
  } finally {
    await fixture.close()
  }
})

test('a worktree keeps its shells while another session on it is live', async () => {
  const fixture = await createAgentTerminalFixture({ foregroundProcess: busyForeground })
  try {
    const other = crypto.randomUUID()
    await fixture.engine.dispatchClientCommand({
      type: 'session.create',
      commandId: 'second-session',
      sessionId: other,
      worktreeTarget: { kind: 'current', worktreeId: fixture.worktreeId },
      title: 'Second conversation',
      modelSelection: { providerInstanceId: fixture.instanceId, model: 'gpt-5.5' },
    })
    const { idle, busy } = await openShells(fixture)

    await fixture.engine.dispatchClientCommand({
      type: 'session.settle',
      commandId: 'settle-first-session',
      sessionId: fixture.sessionId,
    })
    await fixture.engine.providerRuntimeIdle()
    expect(idle.killed).toBe(false)

    await fixture.engine.dispatchClientCommand({
      type: 'session.archive',
      commandId: 'archive-second-session',
      sessionId: other,
    })
    await expect.poll(() => idle.killed).toBe(true)
    expect(busy.killed).toBe(false)
  } finally {
    await fixture.close()
  }
})
