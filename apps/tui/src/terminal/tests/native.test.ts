import { EmbeddedTerminalRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { createSocketProject } from '../../../test/factories/socket-project'
import { expect, test } from '../../../test/fixtures'
import { openTerminalConnection } from '@/terminal/state/connection'

test.runIf(Bun.which('nvim'))(
  'native PTY runs Neovim in EmbeddedTerminal and repaints after a second viewer attaches',
  async ({ server }) => {
    const { worktreeId } = await createSocketProject(server)
    const Socket = inProcessServerSocketConstructor(server)
    const session = {
      origin: server.origin,
      createServiceSocket: (url: string) => new Socket(url),
      record: () => {},
    }
    const frame = await createTestRenderer({ width: 80, height: 24 })
    const connection = openTerminalConnection(session, { worktreeId, terminalId: 'native' })
    const terminal = new EmbeddedTerminalRenderable(frame.renderer, {
      width: 80,
      height: 24,
      onData: (bytes) => connection.send(bytes),
    })
    frame.renderer.root.add(terminal)
    const output = connection.observeOutput((bytes) => terminal.write(bytes))
    const replay = new EmbeddedTerminalRenderable(frame.renderer, {
      width: 60,
      height: 20,
      position: 'absolute',
      top: 0,
      left: 0,
      onData: (bytes) => second?.send(bytes),
    })
    frame.renderer.root.add(replay)
    let replayOutput: (() => void) | null = null
    let second: ReturnType<typeof openTerminalConnection> | null = null
    try {
      await expect.poll(() => connection.getSnapshot().kind).toBe('ready')
      connection.send(
        new TextEncoder().encode(
          "nvim --clean -n +'call setline(1, \"NATIVE TUI 😀\")'; printf '\\nRETURNED_TO_SHELL\\n'\r",
        ),
      )
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return terminal.screen().lines[0]
        })
        .toBe('NATIVE TUI 😀')
      second = openTerminalConnection(session, {
        worktreeId,
        terminalId: 'native',
        cols: 60,
        rows: 20,
      })
      replayOutput = second.observeOutput((bytes) => replay.write(bytes))
      await expect.poll(() => second?.getSnapshot().kind).toBe('ready')
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return replay.screen().lines[0]
        })
        .toBe('NATIVE TUI 😀')
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return terminal.screen().lines[0]
        })
        .toBe('NATIVE TUI 😀')
      second.close()
      connection.resize(80, 24)
      connection.send(new TextEncoder().encode('\x1b:qa!\r'))
      await expect
        .poll(
          async () => {
            await frame.renderOnce()
            return terminal.screen().lines
          },
          { timeout: 5_000 },
        )
        .toContain('RETURNED_TO_SHELL')
    } finally {
      replayOutput?.()
      second?.close()
      output()
      connection.close(true)
      frame.renderer.destroy()
    }
  },
)
