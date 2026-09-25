type SocketListener<Event> = { handle(event: Event): void }['handle']

export type ServerSocket = {
  readonly readyState?: number
  binaryType?: BinaryType | 'nodebuffer'
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: SocketListener<WebSocketEventMap[K]>,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: SocketListener<WebSocketEventMap[K]>,
    options?: boolean | EventListenerOptions,
  ): void
}
