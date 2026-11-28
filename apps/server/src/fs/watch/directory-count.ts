import { readdir } from 'node:fs/promises'
import path from 'node:path'

const DIRECTORY_COUNT_CONCURRENCY = 64

export type DirectoryCount = {
  /** The root plus every directory below it, or the tally when the walk stopped at `limit`. */
  readonly count: number
  /** False when the walk stopped because `count` passed `limit`. */
  readonly complete: boolean
}

/**
 * Counts what a native recursive watch would register: every real directory, `node_modules` and
 * `.git` included, since Bun's watch cannot skip a subtree. Symlinks are not followed, and an
 * unreadable directory counts once, the way the watch fails on it once.
 */
export function countDirectories(root: string, limit: number): Promise<DirectoryCount> {
  const pending = [root]
  let count = 1
  let running = 0
  const done = Promise.withResolvers<DirectoryCount>()

  function pump() {
    if (count > limit) {
      if (running === 0) done.resolve({ count, complete: false })
      return
    }
    while (running < DIRECTORY_COUNT_CONCURRENCY && pending.length > 0) {
      const directory = pending.pop()
      if (directory === undefined) break
      running += 1
      void readSubdirectories(directory).then(settle)
    }
    if (running === 0) done.resolve({ count, complete: true })
  }

  function settle(children: readonly string[]) {
    running -= 1
    count += children.length
    for (const child of children) pending.push(child)
    pump()
  }

  pump()
  return done.promise
}

async function readSubdirectories(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name))
  } catch {
    return []
  }
}
