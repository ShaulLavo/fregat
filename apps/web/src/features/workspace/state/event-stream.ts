import { errorNumberField, type WatchServerMessage } from '@workspace/contracts'
import { parseEdenSseStream } from '@workspace/client-core/transport/eden'
import { transportErrors } from '@workspace/client-core/transport/structured-errors'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'
import type { Client } from '@/lib/client'
import { clientErrors } from '@/lib/structured-errors'
import { watchServerMessage } from '@/features/workspace/utils/watch-message'

export async function streamWorkspaceEvents(
  client: Client,
  rootPath: string,
  signal: AbortSignal,
  onMessage: (message: WatchServerMessage) => void,
  files: readonly string[] = [],
  scope: 'project' | 'files' = 'project',
) {
  const response = await client.fs.events.get({
    // JSON preserves commas in filenames that query-array decoding would split.
    query: { path: rootPath, files: JSON.stringify(files), scope },
    fetch: { signal },
  })
  signal.throwIfAborted()
  if (response.error)
    throw clientErrors.WATCH_FAILED({
      // A route that fails before its first event answers 503 and carries the real status in the body.
      status: errorNumberField(rpcErrorPayload(response.error), 'status') ?? response.status,
      internal: { scope, fileCount: files.length, httpStatus: response.status },
    })
  if (!response.data)
    throw transportErrors.EDEN_STREAM_MISSING({
      label: 'File watcher',
      internal: { scope, fileCount: files.length },
    })

  for await (const event of parseEdenSseStream(response.data)) {
    const message = watchServerMessage(event.data)
    if (!message) continue

    onMessage(message)
  }
}
