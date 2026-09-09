import { inProcessServerSocketConstructor } from '@workspace/client-core/test/in-process-server-socket'
import { createSocketProject } from '../../../test/factories/socket-project'
import { recordingAttachHost } from '../../../test/factories/terminal-attach'
import { expect, test } from '../../../test/socket-fixtures'
import { createDetachDecoder, runTerminalAttach } from '@/host/attach'
import { openTerminalConnection } from '@/terminal/state/connection'

test.for(['detach', 'abort', 'disconnect'])(
  'raw attach forwards binary I/O and resize and restores host modes after %s',
  async (ending, { socketServer, pty }) => {
    const { worktreeId } = await createSocketProject(socketServer)
    const Socket = inProcessServerSocketConstructor(socketServer)
    const sockets: InstanceType<typeof Socket>[] = []
    const events: Record<string, unknown>[] = []
    const host = recordingAttachHost()
    const signal = new AbortController()
    const task = runTerminalAttach(
      {
        signal: signal.signal,
        open: () =>
          openTerminalConnection(
            {
              origin: socketServer.origin,
              createServiceSocket: (url) => {
                const socket = new Socket(url)
                sockets.push(socket)
                return socket
              },
              record: (event) => {
                events.push(event)
              },
            },
            { worktreeId, terminalId: 'raw' },
          ),
      },
      host.host,
    )
    try {
      await expect.poll(() => pty.processes.length).toBe(1)
      host.input(new Uint8Array([0, 255, 3, 2]))
      expect(pty.processes[0]?.writes).toEqual([new Uint8Array([0, 255, 3, 2])])
      pty.processes[0]?.emit(new Uint8Array([27, 91, 72, 240, 159]))
      expect(host.writes).toContainEqual(new Uint8Array([27, 91, 72, 240, 159]))
      host.resize(101, 37)
      expect(pty.processes[0]?.resizes).toContainEqual([101, 37])
      if (ending === 'detach') {
        host.input(new Uint8Array([29]))
        host.input(new Uint8Array([100, 120]))
        await task
      }
      if (ending === 'abort') {
        signal.abort()
        await expect(task).rejects.toMatchObject({ name: 'AbortError' })
      }
      if (ending === 'disconnect') {
        sockets[0]?.close(1006, 'lost')
        await expect(task).rejects.toThrow('Terminal disconnected')
      }
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        area: 'terminal',
        operation: 'connection',
        terminalId: 'raw',
        worktreeId,
      })
      expect(pty.processes[0]?.killed).toBe(false)
      expect(host.rawModes).toEqual([true, false])
      expect(host.paused).toBe(true)
      expect(host.listeners).toBe(0)
      expect(new TextDecoder().decode(host.writes.at(-1))).toContain('\x1b[?1049l')
    } finally {
      signal.abort()
      await task.catch(() => {})
    }
  },
)

test('detach prefix handles chunk boundaries and allows a quoted Control+]', () => {
  const bytes: number[] = []
  let detached = false
  const decode = createDetachDecoder(
    (data) => bytes.push(...data),
    () => {
      detached = true
    },
  )
  decode(new Uint8Array([65, 29]))
  decode(new Uint8Array([29, 66, 29, 120]))
  expect(bytes).toEqual([65, 29, 66, 29, 120])
  expect(detached).toBe(false)
  decode(new Uint8Array([29]))
  decode(new Uint8Array([100, 65]))
  expect(detached).toBe(true)
  expect(bytes).toEqual([65, 29, 66, 29, 120])
})
