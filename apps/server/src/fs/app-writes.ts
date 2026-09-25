import { realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * The content version of the last app write to each file. The dev server asks with the version it
 * read, so an outside edit to a file the app also saved is never mistaken for the app's own save.
 */
export class AppWrites {
  private readonly versions = new Map<string, string>()

  // Recorded before the write starts, so a watcher that fires mid-write already finds it.
  async record(absolutePath: string, version: string) {
    this.versions.set(await canonicalPath(absolutePath), version)
  }

  async forget(absolutePath: string, version: string) {
    const key = await canonicalPath(absolutePath)
    if (this.versions.get(key) === version) this.versions.delete(key)
  }

  async matches(absolutePath: string, version: string) {
    if (!path.isAbsolute(absolutePath)) return false

    return this.versions.get(await canonicalPath(absolutePath)) === version
  }
}

// The app may save through a symlinked root while the watcher reports the real path.
async function canonicalPath(absolutePath: string) {
  const resolved = path.resolve(absolutePath)
  const directory = await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved))
  return path.join(directory, path.basename(resolved))
}
