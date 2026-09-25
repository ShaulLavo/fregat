import { act } from 'react'
import { rememberedWorkbench } from '@/workbench/utils/location'
import { recentCommands } from '@/storage/recent-commands-policy'
import { test, expect } from '../../../test/socket-fixtures'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { runPaletteCommand } from '../../../test/actions'

for (const projectRoot of ['', 'nested/project']) {
  test(`global Open workbench opens registered '${projectRoot}' and its actual file tree`, async ({
    server,
  }) => {
    const harness = await renderAgentNavigation(server, { rootPath: projectRoot })
    const { frame, ready, transport, rootPath } = harness
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await runPaletteCommand(frame, 'workspace.openWorkbench')
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('workbench-file-tree')
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('inside-project.txt')
      if (rootPath) expect(frame.captureCharFrame()).not.toContain('outside-project.txt')
      expect(rememberedWorkbench(ready.storage)).toMatchObject({ rootPath, pane: 'files' })
      expect(recentCommands.read(ready.storage)[0]).toBe('workspace.openWorkbench')
      const stats = transport.requests
        .map((request) => new URL(request.url))
        .filter((url) => url.pathname === '/fs/stat')
      expect(stats.at(-1)?.searchParams.get('path')).toBe(rootPath)
    } finally {
      await harness.cleanup()
    }
  })
}

for (const delayedPath of ['/health', '/fs/stat']) {
  test(`a delayed ${delayedPath} result cannot replace a newer Show chat navigation`, async ({
    server,
  }) => {
    const harness = await renderAgentNavigation(server)
    const { frame, transport, ready } = harness
    const gate = transport.pauseNextResponse(delayedPath)
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await act(async () => {
        await frame.mockInput.typeText('Keep this newer chat')
      })
      await runPaletteCommand(frame, 'workspace.openWorkbench')
      await gate.reached
      await runPaletteCommand(frame, 'workspace.revealChat')
      await expect.poll(() => recentCommands.read(ready.storage)[0]).toBe('workspace.revealChat')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await act(async () => {
        gate.release()
      })
      await expect.poll(() => recentCommands.read(ready.storage)[0]).toBe('workspace.openWorkbench')
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      expect(frame.captureCharFrame()).toContain('Keep this newer chat')
      expect(rememberedWorkbench(ready.storage)).toBeNull()
    } finally {
      gate.release()
      await harness.cleanup()
    }
  })
}

test('a narrow shell stage returns from the session rail to the same live terminal', async ({
  socketServer,
  pty,
}) => {
  const harness = await renderAgentNavigation(socketServer, { width: 60 })
  const { frame, worktreeId } = harness
  const terminalId = `terminal-chat-terminal:${worktreeId}`
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Open session terminal')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe(terminalId)
    await expect.poll(() => pty.processes.length).toBe(1)
    await runPaletteCommand(frame, 'Toggle session rail')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await runPaletteCommand(frame, 'Toggle session rail')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe(terminalId)
    await act(async () => {
      await frame.mockInput.typeText('echo roundtrip')
      frame.mockInput.pressEnter()
    })
    expect(pty.processes).toHaveLength(1)
    expect(
      pty.processes[0]?.writes
        .map((bytes) => (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)))
        .join(''),
    ).toContain('echo roundtrip\r')
  } finally {
    await harness.cleanup()
  }
})
