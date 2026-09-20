import { isRecord } from '@workspace/utils/objects'
import type { createApp } from 'server/testing'
import { createClientError } from '../src/errors'

type InProcessServer = { readonly app: ReturnType<typeof createApp>; readonly clientOrigin: string }
type SocketFrame = string | Uint8Array

export function inProcessServerSocketConstructor(server: InProcessServer) {
  return class InProcessServerSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static readonly opened: InProcessServerSocket[] = []
    readonly url: string
    readonly received: (string | ArrayBuffer | Blob)[] = []
    readonly sent: SocketFrame[] = []
    readonly opening: Promise<void>
    readyState = 0
    binaryType: BinaryType = 'blob'
    closeDetails: { readonly code: number; readonly reason: string } | null = null
    closeCalls = 0
    private readonly hooks: ReturnType<typeof routeHooks>
    private readonly peer: {
      readonly raw: object
      readonly data: {
        readonly headers: { readonly origin: string }
        readonly query: Record<string, string>
      }
      readonly send: (message: SocketFrame) => void
      readonly close: (code?: number, reason?: string) => void
    }

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      const parsed = new URL(this.url)
      this.hooks = routeHooks(server.app, parsed.pathname)
      this.peer = {
        raw: {},
        data: {
          headers: { origin: server.clientOrigin },
          query: Object.fromEntries(parsed.searchParams),
        },
        send: (message) => this.deliver(message),
        close: (code, reason) => this.close(code, reason),
      }
      InProcessServerSocket.opened.push(this)
      this.opening = Promise.resolve().then(() => this.open())
    }

    send(message: SocketFrame) {
      if (this.readyState !== 1)
        throw createClientError({
          code: 'TEST_SOCKET_NOT_OPEN',
          message: 'The in-process socket is not open.',
          status: 409,
          why: 'A client sent a frame before opening or after closing.',
          fix: 'Await the socket open event and stop sending after close.',
        })
      this.sent.push(message)
      Reflect.apply(this.hooks.message, undefined, [this.peer, message])
    }

    close(code = 1000, reason = '') {
      if (this.readyState === 3) return
      this.readyState = 3
      this.closeDetails = { code, reason }
      this.closeCalls += 1
      Reflect.apply(this.hooks.close, undefined, [this.peer])
      this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }))
    }

    private async open() {
      if (this.readyState === 3) return
      this.readyState = 1
      const opening = Reflect.apply(this.hooks.open, undefined, [this.peer])
      if (this.readyState === 1) this.dispatchEvent(new Event('open'))
      await opening
    }

    private deliver(message: SocketFrame) {
      if (this.readyState !== 1) return
      const data = this.incomingFrame(message)
      this.received.push(data)
      this.dispatchEvent(new MessageEvent('message', { data }))
    }

    private incomingFrame(message: SocketFrame) {
      if (typeof message === 'string') return message
      const bytes = Uint8Array.from(message)
      return this.binaryType === 'arraybuffer' ? bytes.buffer : new Blob([bytes])
    }
  }
}

function routeHooks(app: InProcessServer['app'], path: string) {
  const hooks: unknown = app.routes.find((route) => route.path === path)?.hooks
  if (
    (path !== '/terminal' && path !== '/lsp') ||
    !isRecord(hooks) ||
    typeof hooks.open !== 'function' ||
    typeof hooks.message !== 'function' ||
    typeof hooks.close !== 'function'
  ) {
    throw createClientError({
      code: 'TEST_SOCKET_ROUTE_MISSING',
      message: 'The real server must expose the requested terminal or LSP route.',
      status: 500,
      why: 'This fixture forwards frames through real server lifecycle hooks.',
      fix: 'Create the test server with the requested WebSocket route enabled.',
    })
  }
  return { open: hooks.open, message: hooks.message, close: hooks.close }
}
