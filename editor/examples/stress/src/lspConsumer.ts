import { createLanguageServerDocument } from '@singapore-editor/lsp-plugin'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { LspWebSocketLike } from '@singapore-editor/lsp'

class ConsumerSocket extends EventTarget implements LspWebSocketLike {
  readyState = 0
  constructor(_url: string | URL, _protocols?: string | readonly string[]) {
    super()
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    })
  }
  send(value: string): void {
    const message: unknown = JSON.parse(value)
    if (
      typeof message !== 'object' ||
      message === null ||
      !('method' in message) ||
      message.method !== 'initialize' ||
      !('id' in message)
    )
      return
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: { capabilities: { textDocumentSync: 2 } },
    }
    queueMicrotask(() => {
      if (this.readyState !== 1) return
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(response) }))
    })
  }
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

export function createLspConsumer(buffer: EditorTextBuffer) {
  const uri = 'file:///consumers.ts'
  const document = createLanguageServerDocument({
    buffer,
    uri,
    languageId: 'typescript',
    lanes: [
      {
        id: 'consumer',
        features: {},
        webSocketRoute: 'ws://consumer/lsp',
        webSocketTransportOptions: { WebSocketCtor: ConsumerSocket },
      },
    ],
  })
  const lane = document.lanes[0]
  const observe = () => {
    const source = lane?.connection.workspace.getDocument(uri)
    const point = buffer.getDocumentSyncPoint()
    return source
      ? {
          version: source.version,
          length: source.textSnapshot.length,
          sourceRevision: source.sourceRevision,
          current:
            source.sourceSegment === point.segment && source.sourceRevision === point.revision,
        }
      : null
  }
  return {
    observe,
    async settle() {
      if (!lane) return
      await lane.connection.ready
      const prepared = lane.connection.workspace.prepareDocumentRequest(uri)
      if (prepared.kind === 'unmanaged')
        throw new DOMException('Consumer source was retired', 'AbortError')
      const read = prepared.kind === 'pending' ? await prepared.ready : prepared.read
      if (!read.isCurrent() || observe()?.current !== true)
        throw new DOMException('Consumer source was superseded', 'AbortError')
    },
    dispose: () => document.dispose(),
  }
}
