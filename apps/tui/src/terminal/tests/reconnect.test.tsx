import { act } from 'react'
import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { test, expect } from '../../../test/socket-fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { runPaletteCommand } from '../../../test/actions'

test('reconnect terminal reattaches the existing PTY after a dropped connection', async ({
  socketServer,
  pty,
}) => {
  const Socket = inProcessServerSocketConstructor(socketServer)
  const harness = await createWorkbenchFrame(socketServer, {
    location: { kind: 'workbench', rootPath: '', pane: 'terminal' },
    createServiceSocket: (url) => new Socket(url),
  })
  const { frame } = harness
  try {
    await expect.poll(() => pty.processes.length).toBe(1)
    await expect
      .poll(() =>
        Socket.opened[0]?.received.some(
          (data) => typeof data === 'string' && data.includes('"type":"ready"'),
        ),
      )
      .toBe(true)
    await act(async () => {
      Socket.opened[0]?.close()
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Reconnect terminal')
    await runPaletteCommand(frame, 'Reconnect terminal')
    await expect.poll(() => Socket.opened.length).toBe(2)
    await expect
      .poll(() =>
        Socket.opened[1]?.received.some(
          (data) => typeof data === 'string' && data.includes('"type":"ready"'),
        ),
      )
      .toBe(true)
    expect(pty.processes.length).toBe(1)
    await act(async () => {
      await frame.mockInput.typeText('echo reconnected')
      frame.mockInput.pressEnter()
    })
    expect(
      pty.processes[0]?.writes
        .map((data) => (typeof data === 'string' ? data : new TextDecoder().decode(data)))
        .join(''),
    ).toContain('echo reconnected\r')
  } finally {
    await harness.cleanup()
  }
})
