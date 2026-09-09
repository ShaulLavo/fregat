import { Application } from '@/components/application'
import { renderTui } from '../../../test/render'
import { openTestChat } from '../../../test/factories/chat'
import { act } from 'react'
import { SelectRenderable } from '@opentui/core'
import { createSessionArchiveCommand } from '@workspace/client-core/chat/commands'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { createRailSession, createRailProjects } from '../../../test/factories/agent-rail'
import { runPaletteCommand } from '../../../test/actions'

test('native session rail filters, marks, renames, archives, restores and deletes real sessions', async ({
  server,
}) => {
  const harness = await renderAgentStage(server)
  const { frame, chat, worktreeId } = harness
  try {
    const alpha = await createRailSession(chat, worktreeId, 'Alpha')
    const beta = await createRailSession(chat, worktreeId, 'Beta')
    await runPaletteCommand(frame, 'Filter sessions')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-filter')
    await act(async () => {
      await frame.mockInput.typeText('Alpha')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await act(async () => {
      frame.mockInput.pressKey('j')
    })
    expect(
      (frame.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.name,
    ).toContain('Alpha')
    await act(async () => {
      frame.mockInput.pressKey('m')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('1 marked')
    await runPaletteCommand(frame, 'Rename selected item')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-dialog')
    await act(async () => {
      frame.mockInput.pressKey('END')
      await frame.mockInput.typeText(' revised')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(() => chat.getSnapshot().projection.sessionById[alpha]?.title)
      .toBe('Alpha revised')
    await runPaletteCommand(frame, 'Archive selected sessions')
    await expect
      .poll(() => chat.getSnapshot().projection.sessionById[alpha]?.archivedAt)
      .not.toBeNull()
    expect(chat.getSnapshot().projection.sessionById[beta]?.archivedAt).toBeNull()
    await runPaletteCommand(frame, 'Show archived sessions')
    await act(async () => {
      await frame.renderOnce()
      frame.mockInput.pressArrow('down')
    })
    await runPaletteCommand(frame, 'Archive selected sessions')
    await expect.poll(() => chat.getSnapshot().projection.sessionById[alpha]?.archivedAt).toBeNull()
    await runPaletteCommand(frame, 'Show archived sessions')
    await act(async () => {
      await frame.renderOnce()
      frame.mockInput.pressArrow('down')
    })
    await runPaletteCommand(frame, 'Delete selected item')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-dialog')
    await act(async () => {
      await frame.mockInput.typeText('delete')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => chat.getSnapshot().projection.sessionById[alpha]).toBeUndefined()
    expect(chat.getSnapshot().projection.sessionById[beta]?.title).toBe('Beta')
  } finally {
    await harness.cleanup()
  }
})

test('native previous-session navigation from a draft selects the last visible session and keys remain text in the composer', async ({
  server,
}) => {
  const harness = await renderAgentStage(server, { width: 72 })
  const { frame, chat, worktreeId } = harness
  try {
    const alpha = await createRailSession(chat, worktreeId, 'Alpha')
    const beta = await createRailSession(chat, worktreeId, 'Beta')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      await frame.mockInput.typeText('jkm/')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('jkm/')
    await runPaletteCommand(frame, 'Previous session')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBe(alpha)
    await runPaletteCommand(frame, 'Next session')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBe(beta)
    await chat.dispatch(createSessionArchiveCommand({ sessionId: beta }))
    await runPaletteCommand(frame, 'Previous session')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBe(alpha)
  } finally {
    await harness.cleanup()
  }
})

test('reordering keeps the moved session selected so the next action targets the same session', async ({
  server,
}) => {
  const harness = await renderAgentStage(server)
  const { frame, chat, worktreeId } = harness
  try {
    const alpha = await createRailSession(chat, worktreeId, 'Alpha')
    const beta = await createRailSession(chat, worktreeId, 'Beta')
    await runPaletteCommand(frame, 'Filter sessions')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressArrow('down')
    })
    expect(
      (frame.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.name,
    ).toContain('Alpha')
    await runPaletteCommand(frame, 'Move selected item up')
    await expect
      .poll(() => chat.getSnapshot().projection.sessionById[alpha]?.pinOrderKey)
      .not.toBeNull()
    await act(async () => {
      await frame.renderOnce()
    })
    expect(
      (frame.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.name,
    ).toContain('Alpha')
    await runPaletteCommand(frame, 'Archive selected sessions')
    await expect
      .poll(() => chat.getSnapshot().projection.sessionById[alpha]?.archivedAt)
      .not.toBeNull()
    expect(chat.getSnapshot().projection.sessionById[beta]?.archivedAt).toBeNull()
  } finally {
    await harness.cleanup()
  }
})

test.for(['composer palette', 'composer shortcut', 'rail palette', 'rail shortcut'])(
  'New session uses the project owned by %s',
  async (entry, { server }) => {
    const { session, chat } = await openTestChat(server)
    const projects = await createRailProjects({ session, chat, server })
    const frame = await renderTui(
      <Application
        session={session}
        noColor
        onExit={() => {}}
        initialLocation={{
          kind: 'agent',
          projectId: projects.projectId,
          sessionId: projects.sessionId,
        }}
      />,
      { width: 72, height: 40, useThread: false, kittyKeyboard: true },
    )
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      const rail = entry.startsWith('rail')
      if (rail) {
        await runPaletteCommand(frame, 'Filter sessions')
        await act(async () => {
          frame.mockInput.pressEnter()
        })
        await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
      }
      if (entry.endsWith('palette')) await runPaletteCommand(frame, 'New session')
      if (entry.endsWith('shortcut'))
        await act(async () => {
          frame.mockInput.pressKey('n', { ctrl: true })
        })
      await expect.poll(() => chat.getSnapshot().selectedSessionId).toBeNull()
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await act(async () => {
        await frame.mockInput.typeText('New request')
        frame.mockInput.pressEnter()
      })
      await expect
        .poll(() =>
          Object.values(chat.getSnapshot().projection.sessionById).find(
            (item) => item.title === 'New request',
          ),
        )
        .toBeTruthy()
      const created = Object.values(chat.getSnapshot().projection.sessionById).find(
        (item) => item.title === 'New request',
      )
      expect(created?.worktreeId).toBe(rail ? projects.alpha : projects.beta)
    } finally {
      await frame.cleanup()
      session.dispose()
    }
  },
)
