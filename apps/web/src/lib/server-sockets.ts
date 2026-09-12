import type { TerminalOpenInput } from '@workspace/contracts'
import type { Client } from '@/lib/client'

export type EdenServerSocket = {
  readonly readyState?: number
  send(message: string | Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: keyof WebSocketEventMap,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: keyof WebSocketEventMap,
    handler: EventListener,
    options?: boolean | EventListenerOptions,
  ): void
}

type EdenSocket = {
  ws: WebSocket
  send(data: unknown): unknown
}

type LanguageServerSocketOptions = {
  path: string
  rootPath: string
  serverId?: string | null
}

export function connectTerminalSocket(
  input: TerminalOpenInput,
  client: Client,
  signal: AbortSignal,
): EdenServerSocket {
  signal.throwIfAborted()
  const socket = client.terminal.subscribe({ query: input })
  socket.ws.binaryType = 'arraybuffer'
  return adaptEdenSocket(socket, signal)
}

export function connectLanguageServerSocket(
  { path, rootPath, serverId }: LanguageServerSocketOptions,
  client: Client,
  signal: AbortSignal,
): EdenServerSocket {
  signal.throwIfAborted()
  return adaptEdenSocket(
    client.lsp.subscribe({
      query: { path, root: rootPath, server: serverId ?? undefined },
    }),
    signal,
  )
}

class EdenLanguageServerWebSocket implements EdenServerSocket {
  readonly #socket: EdenServerSocket

  constructor(
    url: string | URL,
    _protocols: string | readonly string[] | undefined,
    client: Client,
    signal: AbortSignal,
  ) {
    void _protocols
    this.#socket = connectLanguageServerSocket(languageServerSocketOptions(url), client, signal)
  }

  get readyState() {
    return this.#socket.readyState
  }

  send(message: string | Uint8Array) {
    this.#socket.send(message)
  }

  close(code?: number, reason?: string) {
    this.#socket.close(code, reason)
  }

  addEventListener(
    type: keyof WebSocketEventMap,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    this.#socket.addEventListener(type, handler, options)
  }

  removeEventListener(
    type: keyof WebSocketEventMap,
    handler: EventListener,
    options?: boolean | EventListenerOptions,
  ) {
    this.#socket.removeEventListener(type, handler, options)
  }
}

export function languageServerWebSocketConstructor(client: Client, signal: AbortSignal) {
  return class extends EdenLanguageServerWebSocket {
    constructor(url: string | URL, protocols?: string | readonly string[]) {
      super(url, protocols, client, signal)
    }
  }
}

function adaptEdenSocket(socket: EdenSocket, signal: AbortSignal): EdenServerSocket {
  const close = () => socket.ws.close(1000, 'environment switched')
  signal.addEventListener('abort', close, { once: true })
  socket.ws.addEventListener('close', () => signal.removeEventListener('abort', close), {
    once: true,
  })
  return {
    get readyState() {
      return socket.ws.readyState
    },
    send: (message) => {
      if (typeof message === 'string') {
        socket.send(message)
        return
      }
      socket.ws.send(browserSocketBytes(message))
    },
    close: (code, reason) => {
      socket.ws.close(code, reason)
    },
    addEventListener: (type, handler, options) => {
      socket.ws.addEventListener(type, handler, options)
    },
    removeEventListener: (type, handler, options) => {
      socket.ws.removeEventListener(type, handler, options)
    },
  }
}

function browserSocketBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer)
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Browser WebSockets cannot send a shared backing buffer.
  return Uint8Array.from(bytes)
}

function languageServerSocketOptions(url: string | URL) {
  const parsed = new URL(url.toString())

  return {
    path: parsed.searchParams.get('path') ?? '',
    rootPath: parsed.searchParams.get('root') ?? '',
    serverId: parsed.searchParams.get('server'),
  }
}
