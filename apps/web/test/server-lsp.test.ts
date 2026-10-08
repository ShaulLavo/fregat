import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { vi } from 'vitest'
import { resolveLspServer } from 'server/testing'
import { expect, test } from './fixtures'

test('the web server fixture keeps JSON editor sockets away from the real installer', async ({
  server,
}) => {
  const match = await resolveLspServer({
    filePath: `${server.root}/.platform/settings.json`,
    serverId: 'json-ls',
    settings: { servers: {}, languageServers: {}, tyForPython: false },
    workspaceRoot: server.root,
  })
  expect(match).not.toBeNull()
  if (!match) return

  // Intercept the external process boundary before it can download or spawn anything.
  const spawn = vi.spyOn(match.server, 'spawn').mockResolvedValue(null)
  const Socket = inProcessServerSocketConstructor({ app: server.app, clientOrigin: server.origin })
  try {
    const socket = new Socket(
      `${server.origin}/lsp?path=.platform/settings.json&root=&server=json-ls`,
    )
    await socket.opening
    expect(socket.readyState).toBe(Socket.CLOSED)
    expect(socket.received).toEqual([
      JSON.stringify({
        jsonrpc: '2.0',
        method: '$/serverExited',
        params: {
          exitCode: null,
          exitSignal: null,
          outcome: 'spawn_failed',
          serverId: 'json-ls',
        },
      }),
    ])
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    spawn.mockRestore()
  }
})
