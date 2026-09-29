import type { LspTransport, LspTransportHandler } from './types'

export type LspManagedTransport = LspTransport & {
  onDidClose(handler: (error?: unknown) => void): () => void
  close(): void
}

/** A socket close the transport did not ask for: what the socket reported, and how busy it was. */
export class LspTransportClosedError extends Error {
  public readonly code: number | null
  public readonly reason: string
  public readonly wasClean: boolean | null
  public readonly sentCount: number
  public readonly receivedCount: number

  public constructor(close: {
    readonly code: number | null
    readonly reason: string
    readonly wasClean: boolean | null
    readonly sentCount: number
    readonly receivedCount: number
  }) {
    super(close.code === null ? 'LSP transport closed' : `LSP transport closed (${close.code})`)
    this.name = 'LspTransportClosedError'
    this.code = close.code
    this.reason = close.reason
    this.wasClean = close.wasClean
    this.sentCount = close.sentCount
    this.receivedCount = close.receivedCount
  }
}

export type LspWebSocketLike = {
  readonly readyState?: number
  send(message: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open', handler: EventListener): void
  addEventListener(type: 'message', handler: EventListener): void
  addEventListener(type: 'error', handler: EventListener): void
  addEventListener(type: 'close', handler: EventListener): void
  removeEventListener(type: 'open', handler: EventListener): void
  removeEventListener(type: 'message', handler: EventListener): void
  removeEventListener(type: 'error', handler: EventListener): void
  removeEventListener(type: 'close', handler: EventListener): void
}

export type LspWebSocketConstructor = new (
  url: string | URL,
  protocols?: string | readonly string[],
) => LspWebSocketLike

export type LspWebSocketTransportOptions = {
  readonly protocols?: string | readonly string[]
  readonly WebSocketCtor?: LspWebSocketConstructor
}

export type LspWorkerMessageFormat = 'string' | 'json'

export type LspWorkerLike = {
  postMessage(message: unknown): void
  addEventListener(type: 'message', handler: EventListener): void
  addEventListener(type: 'error', handler: EventListener): void
  removeEventListener(type: 'message', handler: EventListener): void
  removeEventListener(type: 'error', handler: EventListener): void
  terminate?(): void
}

export type LspWorkerTransportOptions = {
  readonly messageFormat?: LspWorkerMessageFormat
  readonly terminateOnClose?: boolean
}

const WEB_SOCKET_CONNECTING = 0
const WEB_SOCKET_OPEN = 1
const WEB_SOCKET_CLOSING = 2
const WEB_SOCKET_CLOSED = 3

const mutableProtocols = (
  protocols: string | readonly string[] | undefined,
): string | string[] | undefined => {
  if (typeof protocols === 'string') return protocols
  if (!protocols) return undefined
  return [...protocols]
}

export const createWebSocketLspTransport = (
  url: string | URL,
  options: LspWebSocketTransportOptions = {},
): Promise<LspManagedTransport> => {
  const WebSocketCtor = options.WebSocketCtor ?? globalThis.WebSocket
  if (!WebSocketCtor) return Promise.reject(new Error('WebSocket is not available'))

  const socket = new WebSocketCtor(url, mutableProtocols(options.protocols))
  const transport = new WebSocketLspTransport(socket)
  if (socket.readyState === WEB_SOCKET_OPEN) return Promise.resolve(transport)

  return waitForWebSocketOpen(socket, transport)
}

export const createWorkerLspTransport = (
  worker: LspWorkerLike,
  options: LspWorkerTransportOptions = {},
): LspManagedTransport => new WorkerLspTransport(worker, options)

class WebSocketLspTransport implements LspManagedTransport {
  private readonly handlers = new Set<LspTransportHandler>()
  private readonly closeHandlers = new Set<(error?: unknown) => void>()
  private closed = false
  private sentCount = 0
  private receivedCount = 0

  public constructor(private readonly socket: LspWebSocketLike) {
    this.socket.addEventListener('message', this.handleMessage)
    this.socket.addEventListener('close', this.handleClose)
  }

  public send(message: string): void {
    if (this.closed || isWebSocketClosingOrClosed(this.socket)) {
      throw new Error('WebSocket LSP transport is closed')
    }
    if (!isWebSocketOpen(this.socket)) {
      throw new Error('WebSocket LSP transport is not open')
    }

    this.socket.send(message)
    this.sentCount += 1
  }

  public subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  public unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  public onDidClose(handler: (error?: unknown) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  public close(): void {
    if (this.closed) return

    this.closed = true
    this.detachSocketListeners()
    if (canCloseWebSocket(this.socket)) this.socket.close()
  }

  private readonly handleMessage = (event: Event): void => {
    const message = messageEventData(event)
    if (message === null) return
    this.receivedCount += 1
    for (const handler of this.handlers) handler(message)
  }

  private readonly handleClose = (event: Event): void => {
    if (this.closed) return

    this.closed = true
    this.detachSocketListeners()
    const error = new LspTransportClosedError({
      ...closeEventDetails(event),
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
    })
    for (const handler of this.closeHandlers) handler(error)
    this.closeHandlers.clear()
  }

  private detachSocketListeners(): void {
    this.handlers.clear()
    this.socket.removeEventListener('message', this.handleMessage)
    this.socket.removeEventListener('close', this.handleClose)
  }
}

class WorkerLspTransport implements LspManagedTransport {
  private readonly handlers = new Set<LspTransportHandler>()
  private readonly closeHandlers = new Set<(error?: unknown) => void>()
  private readonly messageFormat: LspWorkerMessageFormat
  private readonly terminateOnClose: boolean
  private closed = false

  public constructor(
    private readonly worker: LspWorkerLike,
    options: LspWorkerTransportOptions,
  ) {
    this.messageFormat = options.messageFormat ?? 'string'
    this.terminateOnClose = options.terminateOnClose ?? false
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  public send(message: string): void {
    this.worker.postMessage(this.encodeMessage(message))
  }

  public subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  public unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  public onDidClose(handler: (error?: unknown) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  public close(): void {
    if (this.closed) return

    this.closed = true
    this.handlers.clear()
    this.closeHandlers.clear()
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    if (this.terminateOnClose) this.worker.terminate?.()
  }

  private encodeMessage(message: string): unknown {
    if (this.messageFormat === 'string') return message
    return JSON.parse(message) as unknown
  }

  private readonly handleMessage = (event: Event): void => {
    const message = messageEventData(event)
    if (message === null) return
    for (const handler of this.handlers) handler(message)
  }

  private readonly handleError = (event: Event): void => {
    if (this.closed) return

    this.closed = true
    this.handlers.clear()
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    if (this.terminateOnClose) this.worker.terminate?.()
    const error = workerError(event)
    for (const handler of this.closeHandlers) handler(error)
    this.closeHandlers.clear()
  }
}

function workerError(event: Event): unknown {
  if ('error' in event && event.error !== undefined && event.error !== null) return event.error
  if ('message' in event && typeof event.message === 'string' && event.message.length > 0) {
    return new Error(event.message)
  }

  return new Error('LSP worker transport failed')
}

const waitForWebSocketOpen = (
  socket: LspWebSocketLike,
  transport: LspManagedTransport,
): Promise<LspManagedTransport> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('close', handleClose)
    }
    const handleOpen = (): void => {
      cleanup()
      resolve(transport)
    }
    const handleError = (): void => {
      cleanup()
      reject(new Error('WebSocket LSP transport failed to connect'))
    }
    const handleClose = (): void => {
      cleanup()
      reject(new Error('WebSocket LSP transport closed before opening'))
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('error', handleError)
    socket.addEventListener('close', handleClose)
  })

const messageEventData = (event: Event): string | null => {
  const data = (event as MessageEvent).data
  if (typeof data === 'string') return data
  if (data === undefined) return null
  return JSON.stringify(data)
}

const isWebSocketOpen = (socket: LspWebSocketLike): boolean =>
  socket.readyState === undefined || socket.readyState === WEB_SOCKET_OPEN

const isWebSocketClosingOrClosed = (socket: LspWebSocketLike): boolean =>
  socket.readyState === WEB_SOCKET_CLOSING || socket.readyState === WEB_SOCKET_CLOSED

const canCloseWebSocket = (socket: LspWebSocketLike): boolean =>
  socket.readyState === undefined ||
  socket.readyState === WEB_SOCKET_CONNECTING ||
  socket.readyState === WEB_SOCKET_OPEN

/** Read structurally: a socket-like adapter may dispatch a plain `Event` without close fields. */
const closeEventDetails = (event: Event) => {
  const close = event as Partial<Pick<CloseEvent, 'code' | 'reason' | 'wasClean'>>
  return {
    code: typeof close.code === 'number' ? close.code : null,
    reason: typeof close.reason === 'string' ? close.reason : '',
    wasClean: typeof close.wasClean === 'boolean' ? close.wasClean : null,
  }
}
