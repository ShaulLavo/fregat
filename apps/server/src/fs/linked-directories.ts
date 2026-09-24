import type { Dirent } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { isOutsideRoot, watcherIgnoredNames } from './path'

const skipped = new Set<string>(watcherIgnoredNames)

export type LinkedDirectory = {
  /** Where the link sits inside the root. */
  readonly link: string
  /** The real directory outside the root. */
  readonly target: string
}

/**
 * Directories linked into `root` from outside it: workspace packages from another checkout, or
 * `bun link`ed packages. `node_modules` is read one level deep (two under a scope), never below.
 */
export async function linkedDirectories(root: string): Promise<LinkedDirectory[]> {
  const found: LinkedDirectory[] = []
  await walk(root, root, found)
  return found.sort((left, right) => left.link.localeCompare(right.link))
}

/** The fewest directories whose recursive watches cover every target. */
export function outermostTargets(links: readonly LinkedDirectory[]): string[] {
  const sorted = [...new Set(links.map((link) => link.target))].sort()
  return sorted.filter((target, index) =>
    sorted.slice(0, index).every((outer) => isOutsideRoot(path.relative(outer, target))),
  )
}

async function walk(root: string, directory: string, found: LinkedDirectory[]): Promise<void> {
  const entries = await entriesOf(directory)
  await Promise.all(
    entries.map((entry) => {
      const child = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) return collect(root, child, found)
      if (!entry.isDirectory() || skipped.has(entry.name)) return
      if (entry.name === 'node_modules') return modules(root, child, found, true)
      return walk(root, child, found)
    }),
  )
}

async function modules(root: string, directory: string, found: LinkedDirectory[], scopes: boolean) {
  const entries = await entriesOf(directory)
  await Promise.all(
    entries.map((entry) => {
      const child = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) return collect(root, child, found)
      if (scopes && entry.isDirectory() && entry.name.startsWith('@')) {
        return modules(root, child, found, false)
      }
    }),
  )
}

async function collect(root: string, link: string, found: LinkedDirectory[]) {
  try {
    const target = await realpath(link)
    if (!isOutsideRoot(path.relative(root, target))) return
    if ((await stat(target)).isDirectory()) found.push({ link, target })
  } catch {
    // A dangling link has nothing to watch.
  }
}

async function entriesOf(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
