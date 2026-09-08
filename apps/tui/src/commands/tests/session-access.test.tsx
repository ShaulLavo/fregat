import assert from 'node:assert/strict'
import { act } from 'react'
import type { SessionId } from '@workspace/contracts'
import { createSessionArchiveCommand } from '@workspace/client-core/chat/commands'
import { test, expect } from '../../../test/fixtures'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { createRailSession } from '../../../test/factories/agent-rail'
import { runPaletteCommand } from '../../../test/actions'
import { openPaletteSearch, submitPaletteSearch } from '../../../test/palette'

test('sess quick access filters archived sessions from workbench and opens the selected conversation', async ({
  server,
}) => {
  const harness = await renderAgentNavigation(server)
  const { frame, ready, worktreeId } = harness
  try {
    let archived: SessionId | undefined
    await act(async () => {
      const id = await createRailSession(ready.chat, worktreeId, 'Archived calibration')
      await ready.chat.dispatch(createSessionArchiveCommand({ sessionId: id }))
      await createRailSession(ready.chat, worktreeId, 'Active correction')
      archived = id
    })
    assert(archived)
    await runPaletteCommand(frame, 'workspace.openWorkbench')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-file-tree')
    await openPaletteSearch(frame, 'sess Archived')
    expect(frame.captureCharFrame()).toContain('Archived calibration')
    expect(frame.captureCharFrame()).toContain('archived')
    expect(frame.captureCharFrame()).not.toContain('Active correction')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => ready.chat.getSnapshot().selectedSessionId).toBe(archived)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await submitPaletteSearch(frame, 'sess Active correction')
    await expect
      .poll(() => {
        const snapshot = ready.chat.getSnapshot()
        if (!snapshot.selectedSessionId) return null
        return snapshot.projection.sessionById[snapshot.selectedSessionId]?.title
      })
      .toBe('Active correction')
  } finally {
    await harness.cleanup()
  }
})

test('sess quick access gives a real empty result and keeps keyboard focus in the palette', async ({
  server,
}) => {
  const harness = await renderAgentNavigation(server)
  const { frame } = harness
  try {
    await openPaletteSearch(frame, 'sess nonexistent')
    expect(frame.captureCharFrame()).toContain('No matching sessions.')
    expect(frame.captureCharFrame()).not.toContain('not available in the TUI')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
  } finally {
    await harness.cleanup()
  }
})
