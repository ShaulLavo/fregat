import type { createMachineProxySocket } from '../../../server/src/machines/proxy-socket'

type RelayHandlers = ReturnType<typeof createMachineProxySocket>
type RelayClient = Parameters<RelayHandlers['open']>[0]
type RelayOutput = Parameters<RelayClient['send']>[0]

export function machineProxyClient() {
  const messages: RelayOutput[] = []
  const closes: { code: number | undefined; reason: string | undefined }[] = []
  const client: RelayClient = {
    send(frame) {
      messages.push(frame)
      return 1
    },
    close(code, reason) {
      closes.push({ code, reason })
    },
  }
  return { client, messages, closes }
}

export function remoteMachineSocket() {
  const requests: Request[] = []
  const server = Bun.serve<undefined>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      requests.push(request)
      if (server.upgrade(request, { data: undefined })) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      message(socket, frame) {
        socket.send(frame)
      },
    },
  })
  return { server, requests }
}
