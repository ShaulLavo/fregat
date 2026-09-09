import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'

test('choosing the current checkout restores composer focus and retains its prompt', async ({
  server,
}) => {
  const { frame, cleanup } = await renderAgentStage(server)
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => frame.mockInput.typeText('Keep this checkout prompt'))
    await runPaletteCommand(frame, 'Choose existing checkout')
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('worktree-picker-filter')
    await act(async () => frame.mockInput.pressEnter())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Keep this checkout prompt')

    await runPaletteCommand(frame, 'Manage project worktrees')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')

    await runPaletteCommand(frame, 'Manage project worktrees')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
    await act(async () => frame.mockInput.pressEnter())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    await act(async () => frame.mockInput.pressEnter())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Keep this checkout prompt')
  } finally {
    await cleanup()
  }
})
