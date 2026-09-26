// Attaches every watch; dies once for a root holding `.crash-once`, as a native crash would.
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

declare const self: Worker

self.onmessage = (message: MessageEvent<{ type: string; id: number; path: string }>) => {
  if (message.data.type !== 'watch') return
  postMessage({ type: 'attached', id: message.data.id, attachMs: 0, errors: [] })
  const marker = path.join(message.data.path, '.crash-once')
  if (!existsSync(marker)) return
  rmSync(marker)
  setTimeout(() => {
    throw new Error('watch worker crashed')
  }, 20)
}
