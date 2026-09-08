import { EmbeddedTerminalRenderable, KeyEvent, parseKeypress } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { createSocketProject } from '../../../test/factories/socket-project'
import { expect, test } from '../../../test/socket-fixtures'
import { openTerminalConnection } from '@/terminal/state/connection'

test('binary socket output paints split UTF-8 and alternate screen; native keys and resize reach the PTY', async ({
  socketServer,
  pty,
}) => {
  const { worktreeId } = await createSocketProject(socketServer)
  const Socket = inProcessServerSocketConstructor(socketServer)
  const frame = await createTestRenderer({ width: 50, height: 12 })
  const connection = openTerminalConnection(
    {
      origin: socketServer.origin,
      createServiceSocket: (url) => new Socket(url),
      record: () => {},
    },
    { worktreeId, terminalId: 'embedded' },
  )
  const terminal = new EmbeddedTerminalRenderable(frame.renderer, {
    id: 'embedded',
    width: 50,
    height: 12,
    onData: (data) => connection.send(data),
    onTerminalResize: (cols, rows) => connection.resize(cols, rows),
  })
  frame.renderer.root.add(terminal)
  const output = connection.observeOutput((bytes) => terminal.write(bytes))
  try {
    await expect.poll(() => connection.getSnapshot().kind).toBe('ready')
    const bytes = new TextEncoder().encode('plain 😀 漢字\r\n')
    pty.processes[0]?.emit(bytes.subarray(0, 8))
    pty.processes[0]?.emit(bytes.subarray(8))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('plain 😀 漢字')
    pty.processes[0]?.emit(new TextEncoder().encode('\x1b[?1049h\x1b[2J\x1b[HALTERNATE'))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('ALTERNATE')
    expect(frame.captureCharFrame()).not.toContain('plain')
    pty.processes[0]?.emit(new TextEncoder().encode('\x1b[?1049l'))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('plain 😀 漢字')
    const key = parseKeypress('\x03')
    if (!key) throw new TypeError('Missing parsed key')
    terminal.handleKeyPress(new KeyEvent(key))
    expect(pty.processes[0]?.writes).toContainEqual(new Uint8Array([3]))
    terminal.width = 40
    terminal.height = 10
    await frame.renderOnce()
    expect(pty.processes[0]?.resizes).toContainEqual([40, 10])
    pty.processes[0]?.emit(new TextEncoder().encode('\x1b[?2004h'))
    connection.send(terminal.encodePaste(new TextEncoder().encode('one\n二')))
    expect(pty.processes[0]?.writes).toContainEqual(
      new TextEncoder().encode('\x1b[200~one\n二\x1b[201~'),
    )
    pty.processes[0]?.emit(new TextEncoder().encode('\x1b[?1000h\x1b[?1006h'))
    await frame.renderOnce()
    await frame.mockMouse.click(3, 2)
    expect(pty.processes[0]?.writes).toContainEqual(new TextEncoder().encode('\x1b[<0;4;3M'))
    pty.processes[0]?.emit(new TextEncoder().encode('\x1b[?u'))
    expect(
      pty.processes[0]?.writes.some((data) =>
        (typeof data === 'string' ? data : new TextDecoder().decode(data)).includes('\x1b[?'),
      ),
    ).toBe(true)
  } finally {
    output()
    connection.close(true)
    frame.renderer.destroy()
  }
})
