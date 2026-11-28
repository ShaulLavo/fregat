import type { JsonRpcId } from './proxy-protocol'
import type { LspProxyClientSession, LspProxySocket } from './proxy-session'

type ClientMessage = string | ArrayBuffer | Uint8Array

type ClientBackend = {
  handleClientMessage(connection: LspProxyConnection, message: ClientMessage): Promise<void>
  releaseConnection(connection: LspProxyConnection): void
  adopt(connection: LspProxyConnection): void
}

export class LspProxyConnection implements LspProxyClientSession {
  private readonly documents = new Set<string>()
  private readonly requestIds = new Map<JsonRpcId, JsonRpcId>()
  private session: ClientBackend
  private readonly socket: LspProxySocket
  private closed = false

  constructor(socket: LspProxySocket, session: ClientBackend) {
    this.socket = socket
    this.session = session
  }

  get isClosed(): boolean {
    return this.closed
  }

  async handleClientMessage(message: ClientMessage): Promise<void> {
    if (this.closed) return

    await this.session.handleClientMessage(this, message)
  }

  dispose(): void {
    if (this.closed) return

    this.closed = true
    this.session.releaseConnection(this)
  }

  send(message: string): void {
    if (this.closed) return

    this.socket.send(message)
  }

  /** Only before `initialize` is answered: nothing is registered with the old backend yet. */
  moveTo(session: ClientBackend): void {
    this.session.releaseConnection(this)
    this.session = session
    session.adopt(this)
  }

  closeSocket(): void {
    if (this.closed) return

    this.closed = true
    this.socket.close()
  }

  closeForProtocolError(): void {
    if (this.closed) return

    this.session.releaseConnection(this)
    this.closed = true
    this.socket.close()
  }

  addDocument(uri: string): void {
    this.documents.add(uri)
  }

  deleteDocument(uri: string): void {
    this.documents.delete(uri)
  }

  documentUris(): readonly string[] {
    return Array.from(this.documents)
  }

  trackRequest(clientId: JsonRpcId, backendId: JsonRpcId): void {
    this.requestIds.set(clientId, backendId)
  }

  untrackRequest(clientId: JsonRpcId): void {
    this.requestIds.delete(clientId)
  }

  backendRequestIdFor(clientId: JsonRpcId): JsonRpcId | null {
    return this.requestIds.get(clientId) ?? null
  }
}
