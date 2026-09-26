import { realpath } from 'node:fs/promises'
import path from 'node:path'

// Long enough for the watcher event of the write; a later edit back to the same content still reloads.
const APP_WRITE_TTL_MS = 10_000

/**
 * The content version of the last app write to each file. The dev server asks with the version it
 * read, so an outside edit to a file the app also saved is never mistaken for the app's own save.
 */
export class AppWrites {
  private readonly versions = new Map<string, { version: string; at: number }>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  // Recorded before the write starts, so a watcher that fires mid-write already finds it.
  async record(absolutePath: string, version: string) {
    this.versions.set(await canonicalPath(absolutePath), { version, at: this.now() })
  }

  async forget(absolutePath: string, version: string) {
    const key = await canonicalPath(absolutePath)
    if (this.versions.get(key)?.version === version) this.versions.delete(key)
  }

  async matches(absolutePath: string, version: string) {
    if (!path.isAbsolute(absolutePath)) return false

    const write = this.versions.get(await canonicalPath(absolutePath))
    if (!write || this.now() - write.at > APP_WRITE_TTL_MS) return false
    return write.version === version
  }
}

// The app may save through a symlinked root while the watcher reports the real path.
async function canonicalPath(absolutePath: string) {
  const resolved = path.resolve(absolutePath)
  const directory = await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved))
  return path.join(directory, path.basename(resolved))
}
