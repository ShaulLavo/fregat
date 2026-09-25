import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { parseTerminalServerMessage } from '@workspace/contracts'
import { closeApp } from 'server/testing'
import { createSocketProject } from '../../../test/factories/socket-project'
import { expect, test } from '../../../test/socket-fixtures'

test.for([
  '/terminal?worktreeId=00000000-0000-4000-8000-000000000000&terminalId=main',
  '/lsp?root=&path=main.ts&server=typescript',
])(
  'real %s rejects an untrusted Origin before starting a process',
  async (route, { socketServer, pty, lsp }) => {
    const Socket = inProcessServerSocketConstructor({
      app: socketServer.app,
      clientOrigin: 'https://untrusted.example',
    })
    const socket = new Socket(`ws://platform-tui.test${route}`)
    await socket.opening
    expect(socket.closeDetails).toEqual({ code: 1008, reason: 'unauthorized' })
    expect(socket.closeCalls).toBe(1)
    expect(pty.spawns).toEqual([])
    expect(lsp.acquisitions).toEqual([])
  },
)

test.for([
  '/terminal?worktreeId=00000000-0000-4000-8000-000000000000&terminalId=main',
  '/lsp?root=../outside&path=main.ts&server=typescript',
])(
  'real %s refuses a root outside its owned workspace',
  async (route, { socketServer, pty, lsp }) => {
    const Socket = inProcessServerSocketConstructor(socketServer)
    const socket = new Socket(`ws://platform-tui.test${route}`)
    await socket.opening
    expect(socket.closeDetails).toEqual({ code: 1008, reason: 'invalid-root' })
    expect(pty.spawns).toEqual([])
    expect(lsp.acquisitions).toEqual([])
  },
)

test('binary terminal frames reach the PTY and explicit disposal finishes its process', async ({
  socketServer,
  pty,
}) => {
  const { worktreeId } = await createSocketProject(socketServer)
  const Socket = inProcessServerSocketConstructor(socketServer)
  const socket = new Socket(
    `ws://platform-tui.test/terminal?worktreeId=${worktreeId}&terminalId=main`,
  )
  socket.binaryType = 'arraybuffer'
  await socket.opening
  expect(socket.received.map(parseTerminalServerMessage)).toContainEqual({
    type: 'ready',
    cwd: socketServer.root,
    shell: '/bin/sh',
    restoredHistory: false,
  })
  const bytes = new Uint8Array([0, 255, 192, 128, 27, 3, 4])
  socket.send(bytes)
  expect(pty.processes[0]?.writes).toEqual([bytes])
  pty.processes[0]?.emit(bytes)
  expect(socket.received.map(parseTerminalServerMessage)).toContainEqual({
    type: 'output',
    data: bytes,
  })
  socket.send(JSON.stringify({ type: 'dispose' }))
  await expect.poll(() => pty.processes[0]?.killed).toBe(true)
  await expect(pty.processes[0]?.exited).resolves.toMatchObject({ signal: 'SIGHUP' })
  await expect.poll(() => socket.closeCalls).toBe(1)
})

test('LSP frames use real route buffering and client close releases the acquired backend session', async ({
  socketServer,
  lsp,
}) => {
  const Socket = inProcessServerSocketConstructor(socketServer)
  const socket = new Socket('ws://platform-tui.test/lsp?root=&path=main.ts&server=typescript')
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
  socket.addEventListener('open', () => socket.send(JSON.stringify(initialize)))
  await socket.opening
  expect(lsp.acquisitions[0]?.[1].server.id).toBe('typescript')
  expect(lsp.clients[0]?.messages).toEqual([initialize])
  socket.close()
  socket.close()
  expect(lsp.clients[0]?.disposed).toBe(true)
  expect(socket.closeCalls).toBe(1)
})

test('app shutdown detaches terminals, disposes LSP owners and closes their clients', async ({
  socketServer,
  pty,
  lsp,
}) => {
  const { worktreeId } = await createSocketProject(socketServer)
  const Socket = inProcessServerSocketConstructor(socketServer)
  const terminal = new Socket(
    `ws://platform-tui.test/terminal?worktreeId=${worktreeId}&terminalId=main`,
  )
  const language = new Socket('ws://platform-tui.test/lsp?root=&path=main.ts&server=typescript')
  await Promise.all([terminal.opening, language.opening])
  await closeApp(socketServer.app)
  expect(pty.processes[0]?.killed).toBe(false)
  expect(lsp.clients[0]?.disposed).toBe(true)
  expect(terminal.readyState).toBe(3)
  expect(language.readyState).toBe(3)
})
