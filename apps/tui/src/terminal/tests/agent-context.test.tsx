import assert from 'node:assert/strict'
import { act } from 'react'
import type { EmbeddedTerminalRenderable } from '@opentui/core'
import { test, expect } from '../../../test/socket-fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { runPaletteCommand } from '../../../test/actions'

test('selected terminal output reaches the checkout prompt through the durable inbox', async ({
  socketServer,
  pty,
}) => {
  const harness = await createWorkbenchFrame(socketServer, {
    location: { kind: 'workbench', rootPath: '', pane: 'terminal' },
  })
  const { frame } = harness
  try {
    await expect.poll(() => pty.processes.length).toBe(1)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toMatch(/^terminal-/)
    const terminal = frame.renderer.currentFocusedRenderable as
      | EmbeddedTerminalRenderable
      | undefined
    assert(terminal)
    await act(async () => {
      pty.processes[0]?.emit(new TextEncoder().encode('Build failed: missing config\r\n'))
      await frame.renderOnce()
    })
    await act(async () => {
      await frame.mockMouse.drag(terminal.x, terminal.y, terminal.x + 27, terminal.y)
    })
    expect(terminal.getSelectedText()).toContain('Build failed: missing config')
    await runPaletteCommand(frame, 'terminal.askAgent')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('selected excerpt')
    const state = harness.session.getSnapshot()
    assert(state.kind === 'ready')
    const worktree = Object.values(state.chat.getSnapshot().projection.worktreeById).find(
      (item) => item.path === '',
    )
    assert(worktree)
    const saved = state.storage.getItem(`agent.draft.worktree:${worktree.id}`)
    expect(saved).toContain('Build failed: missing config')
  } finally {
    await harness.cleanup()
  }
})
