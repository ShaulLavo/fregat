import { activatedSocket, privateSocket, restrictPrivateSocket, startRelay } from '../../activation'

const port = Number(process.argv[2])
const activated = activatedSocket()
if (!activated) throw new Error('started without an activated socket')
const socket = privateSocket()
const encoder = new TextEncoder()

Bun.serve({
  unix: socket.socketPath,
  maxRequestBodySize: 128 * 1024 * 1024,
  async fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/ws' && server.upgrade(request)) return undefined
    if (url.pathname === '/upload') {
      const bytes = await request.arrayBuffer()
      return Response.json({ bytes: bytes.byteLength })
    }
    if (url.pathname === '/download') return new Response(new Uint8Array(32 * 1024 * 1024).fill(7))
    if (url.pathname === '/sse') {
      let count = 0
      const stream = new ReadableStream({
        async pull(controller) {
          if (count === 3) return controller.close()
          controller.enqueue(encoder.encode(`data: ${count++}\n\n`))
          await Bun.sleep(20)
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }
    return Response.json({ path: url.pathname, socket: socket.socketPath })
  },
  websocket: {
    message(ws, message) {
      ws.send(message)
    },
  },
})
restrictPrivateSocket(socket)
await startRelay(activated, { hostname: '127.0.0.1', port }, socket)
