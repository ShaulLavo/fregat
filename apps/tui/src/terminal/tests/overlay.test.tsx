import { act } from 'react'
import { expect, test } from '../../../test/socket-fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'

test('the global command dialog keeps typing away from the terminal after an outside click', async ({
  socketServer,
  pty,
}) => {
  const fixture = await createWorkbenchFrame(socketServer, {
    location: { kind: 'workbench', rootPath: '', pane: 'terminal' },
    width: 132,
    height: 40,
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toMatch(/^terminal-/u)
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    await frame.renderOnce()
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await expect.poll(() => pty.processes.length).toBe(1)
    const inputCount = pty.processes[0]?.writes.length
    await act(async () => {
      await frame.mockMouse.click(125, 32)
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      await frame.mockInput.typeText('do not execute')
    })
    expect(pty.processes[0]?.writes.length).toBe(inputCount)
  } finally {
    await fixture.cleanup()
  }
})

test('resizing with the palette open keeps command text and Enter out of the PTY', async ({
  socketServer,
  pty,
}) => {
  const fixture = await createWorkbenchFrame(socketServer, {
    location: { kind: 'workbench', rootPath: '', pane: 'terminal' },
    width: 132,
    height: 40,
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toMatch(/^terminal-/u)
    await expect.poll(() => pty.processes.length).toBe(1)
    const terminalId = frame.renderer.currentFocusedRenderable?.id
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    const inputCount = pty.processes[0]?.writes.length
    await act(async () => {
      frame.resize(60, 26)
      await frame.renderOnce()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      await frame.mockInput.typeText('echo qzxwvv_928471')
      await frame.renderOnce()
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('No matching commands.')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(pty.processes[0]?.writes.length).toBe(inputCount)
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe(terminalId)
    await act(async () => {
      await frame.mockInput.typeText('echo restored')
      frame.mockInput.pressEnter()
    })
    const input = pty.processes[0]?.writes
      .slice(inputCount)
      .map((bytes) => (typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)))
    expect(input?.join('')).toBe('echo restored\r')
  } finally {
    await fixture.cleanup()
  }
})
