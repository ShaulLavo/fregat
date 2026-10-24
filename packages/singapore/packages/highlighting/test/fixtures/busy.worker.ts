import { DocumentWorkerReader } from '@singapore-editor/core/internal/document-worker'
import type { ShikiWorkerRequest } from '../../../editor/src/shiki/workerTypes'

const reader = new DocumentWorkerReader()

self.onmessage = ({ data: request }: MessageEvent<ShikiWorkerRequest>) => {
  if (request.payload.type === 'open') {
    self.postMessage({ busy: true })
    for (;;) {}
  }
  self.postMessage({
    id: request.id,
    ok: true,
    result:
      request.payload.type === 'source'
        ? { source: reader.apply(request.payload.command) }
        : { theme: { backgroundColor: 'ready' } },
  })
}
