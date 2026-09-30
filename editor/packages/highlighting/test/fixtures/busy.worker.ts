import type { ShikiWorkerOwner } from '@singapore-editor/core/shiki'

self.onmessage = ({
  data: request,
}: MessageEvent<{ id: number; payload: Parameters<ShikiWorkerOwner['request']>[0] }>) => {
  if (request.payload.type === 'highlight') {
    self.postMessage({ busy: true })
    for (;;) {}
  }
  self.postMessage({
    id: request.id,
    ok: true,
    result: { theme: { backgroundColor: 'ready' } },
  })
}
