import { act } from 'react'
import { createTestSettingsSession } from '../../../test/factories/session'
import { TerminalPreview } from '../../../test/factories/terminal-preview'
import { expect, test } from '../../../test/socket-fixtures'
import { renderTui } from '../../../test/render'

test('terminal pane paints the real service stream, routes inner keys, and manages independent sessions', async ({
  socketServer,
  pty,
}) => {
  const session = createTestSettingsSession(socketServer)
  await session.refresh()
  const frame = await renderTui(<TerminalPreview session={session} rootPath='' />, {
    width: 100,
    height: 25,
    exitOnCtrlC: false,
  })
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return pty.processes.length
      })
      .toBe(1)
    pty.processes[0]?.emit(new TextEncoder().encode('FIRST SESSION'))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('FIRST SESSION')
    await act(async () => {
      await frame.mockMouse.click(5, 3)
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toMatch(/^terminal-/u)
    await act(async () => {
      frame.mockInput.pressKey('c', { ctrl: true })
    })
    expect(pty.processes[0]?.writes).toContainEqual(new Uint8Array([3]))
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('n')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return pty.processes.length
      })
      .toBe(2)
    pty.processes[1]?.emit(new TextEncoder().encode('SECOND SESSION'))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('SECOND SESSION')
    expect(frame.captureCharFrame()).not.toContain('FIRST SESSION')
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('w')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return pty.processes[1]?.killed
      })
      .toBe(true)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('FIRST SESSION')
    expect(pty.processes[0]?.killed).toBe(false)
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('w')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('terminal-empty')
    expect(frame.captureCharFrame()).toContain('No terminal sessions')
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('n')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return pty.processes.length
      })
      .toBe(3)
    expect(frame.renderer.currentFocusedRenderable?.id).toMatch(/^terminal-/u)
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
