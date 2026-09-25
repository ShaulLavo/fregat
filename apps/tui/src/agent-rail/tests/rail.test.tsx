import type { SessionId } from '@workspace/contracts'
import { failingCommandSocket } from '../../../test/client'
import { submitPaletteSearch } from '../../../test/palette'
import { Application } from '@/components/application'
import { renderTui } from '../../../test/render'
import { openTestChat } from '../../../test/factories/chat'
import { act } from 'react'
import { SelectRenderable } from '@opentui/core'
import {
  createSessionArchiveCommand,
  createSessionPlaceCommand,
} from '@workspace/client-core/chat/commands'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import {
  createRailSession,
  createRailProjects,
  focusRailSession,
} from '../../../test/factories/agent-rail'
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
    await runPaletteCommand(frame, 'Previous tab or chat')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBe(alpha)
    await runPaletteCommand(frame, 'Next tab or chat')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBe(beta)
    await chat.dispatch(createSessionArchiveCommand({ sessionId: beta }))
    await runPaletteCommand(frame, 'Previous tab or chat')
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
    await chat.dispatch(createSessionPlaceCommand({ sessionId: beta, orderKey: 'b' }))
    await chat.dispatch(createSessionPlaceCommand({ sessionId: alpha, orderKey: 'c' }))
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
      .not.toBe('c')
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

test('native current archive opens an owning draft while background archive preserves selection', async ({
  server,
}) => {
  const h = await renderAgentStage(server)
  try {
    const current = await createRailSession(h.chat, h.worktreeId, 'Current archive')
    const background = await createRailSession(h.chat, h.worktreeId, 'Background archive')
    await submitPaletteSearch(h.frame, 'sess Current archive')
    await expect.poll(() => h.chat.getSnapshot().selectedSessionId).toBe(current)
    await focusRailSession(h.frame, 'Background archive')
    await runPaletteCommand(h.frame, 'Archive selected sessions')
    await expect
      .poll(() => h.chat.getSnapshot().projection.sessionById[background]?.archivedAt)
      .not.toBeNull()
    expect(h.chat.getSnapshot().selectedSessionId).toBe(current)
    await focusRailSession(h.frame, 'Current archive')
    await runPaletteCommand(h.frame, 'Archive selected sessions')
    await expect
      .poll(() => h.chat.getSnapshot().projection.sessionById[current]?.archivedAt)
      .not.toBeNull()
    await expect.poll(() => h.chat.getSnapshot().selectedSessionId).toBeNull()
  } finally {
    await h.cleanup()
  }
})

test('native delete skips confirmation when configured and selects the first configured survivor', async ({
  server,
  client,
}) => {
  expect(
    (
      await client.settings.write.post({
        mutationId: crypto.randomUUID(),
        target: 'user',
        operations: [
          { kind: 'set', key: 'chat.confirmSessionDelete', value: false },
          { kind: 'set', key: 'chat.sessionSortOrder', value: 'created_at' },
        ],
      })
    ).error,
  ).toBeNull()
  const h = await renderAgentStage(server)
  try {
    const first = await createRailSession(h.chat, h.worktreeId, 'First survivor')
    const middle = await createRailSession(h.chat, h.worktreeId, 'Delete middle')
    const newest = await createRailSession(h.chat, h.worktreeId, 'Newest survivor')
    await submitPaletteSearch(h.frame, 'sess Delete middle')
    await expect.poll(() => h.chat.getSnapshot().selectedSessionId).toBe(middle)
    await focusRailSession(h.frame, 'Delete middle')
    await runPaletteCommand(h.frame, 'Delete selected item')
    await expect.poll(() => h.chat.getSnapshot().projection.sessionById[middle]).toBeUndefined()
    await expect.poll(() => h.chat.getSnapshot().selectedSessionId).toBe(newest)
    expect(h.chat.getSnapshot().projection.sessionById[first]).toBeDefined()
  } finally {
    await h.cleanup()
  }
})

test('native bulk deletion continues after a failed middle request and retains only its selection', async ({
  server,
}) => {
  let failed: SessionId | undefined
  const h = await renderAgentStage(server, {
    connection: {
      createSocket: failingCommandSocket(
        server,
        (command) => command.type === 'session.delete' && command.sessionId === failed,
      ),
    },
  })
  try {
    await createRailSession(h.chat, h.worktreeId, 'Bulk deletion first')
    failed = await createRailSession(h.chat, h.worktreeId, 'Bulk deletion middle')
    await createRailSession(h.chat, h.worktreeId, 'Bulk deletion last')
    await focusRailSession(h.frame, 'Bulk deletion')
    await runPaletteCommand(h.frame, 'agent.selectAll')
    await runPaletteCommand(h.frame, 'Delete selected item')
    await act(async () => {
      await h.frame.mockInput.typeText('delete')
      h.frame.mockInput.pressEnter()
    })
    await expect.poll(() => h.chat.getSnapshot().projection.sessionIds).toEqual([failed])
    await h.frame.renderOnce()
    expect(h.frame.captureCharFrame()).toContain('1 marked')
    expect(h.frame.captureCharFrame()).toContain('2 deleted, 1 failed')
  } finally {
    await h.cleanup()
  }
})

test('native active reorder materializes visible keyless neighbors without pinning', async ({
  server,
}) => {
  const h = await renderAgentStage(server)
  try {
    const first = await createRailSession(h.chat, h.worktreeId, 'Active first')
    const second = await createRailSession(h.chat, h.worktreeId, 'Active second')
    await focusRailSession(h.frame, 'Active')
    await runPaletteCommand(h.frame, 'Move selected item down')
    await expect
      .poll(() => h.chat.getSnapshot().projection.sessionById[first]?.activeOrderKey)
      .toBeTruthy()
    expect(h.chat.getSnapshot().projection.sessionById[second]?.activeOrderKey).toBeTruthy()
    expect(h.chat.getSnapshot().projection.sessionById[first]?.pinOrderKey).toBeNull()
    expect(h.chat.getSnapshot().projection.sessionById[second]?.pinOrderKey).toBeNull()
  } finally {
    await h.cleanup()
  }
})
