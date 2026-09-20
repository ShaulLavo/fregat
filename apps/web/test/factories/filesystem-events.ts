import type { Client } from '@/lib/client'
import type { WatchServerMessage } from '@workspace/contracts'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'

export function watchFilesystem(client: Client, root: string, files: readonly string[]) {
  const abort = new AbortController()
  const events: WatchServerMessage[] = []
  const errors: unknown[] = []
  const completion = streamWorkspaceEvents(
    client,
    root,
    abort.signal,
    (event) => events.push(event),
    files,
  ).catch((error: unknown) => {
    if (!abort.signal.aborted) errors.push(error)
  })
  return {
    events,
    errors,
    async stop() {
      abort.abort()
      await completion
    },
  }
}
