/**
 * Deterministic inputs and an independent oracle for the path store's
 * visible-row bookkeeping.
 *
 * Nothing here imports `@workspace/tree`. That independence is the only reason
 * the assertions built on it are evidence: an oracle that called the chunked
 * prefix-sum code it is checking would agree with every bug that code has.
 */

/** Deterministic 32-bit LCG (numerical recipes). Same seed → same tree, forever. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 0x100000000
  }
}

export interface GeneratePathsOptions {
  maxDepth?: number
  maxChildren?: number
  fileCount?: number
}

/**
 * Builds a path list of the shape `FileTreeController` accepts: directories end
 * in `/`, every ancestor directory is present, and the list is deduplicated.
 *
 * Names are lowercase and their counters zero-padded on purpose. The tree sorts
 * directories before files and then by name, with a natural (numeric-aware)
 * collation — `f41` before `f151`. Fixed-width lowercase names order identically
 * under natural and plain lexicographic comparison, so the oracle's comparator
 * can stay trivially readable and a sort disagreement can never be an artifact
 * of the fixture's name shape.
 */
export function generatePaths(rng: () => number, options: GeneratePathsOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? 4
  const maxChildren = options.maxChildren ?? 4
  const fileCount = options.fileCount ?? 24
  const paths = new Set<string>()
  const directories = ['']

  for (let index = 0; index < fileCount; index += 1) {
    const parent = directories[Math.floor(rng() * directories.length)] ?? ''
    const depth = parent === '' ? 0 : parent.split('/').length - 1

    if (rng() < 0.4 && depth < maxDepth) {
      const directory = `${parent}d${padded(index)}${pick(rng, maxChildren)}/`
      directories.push(directory)
      paths.add(directory)
      continue
    }

    paths.add(`${parent}f${padded(index)}${pick(rng, maxChildren)}.ts`)
  }

  return Array.from(paths).sort()
}

/**
 * THE ORACLE: a plain depth-first walk that returns the visible paths in order.
 *
 * Deliberately slow and deliberately dumb — no chunking, no prefix sums, no
 * caching, no memoization. It is meant to be verified by reading it, in under a
 * minute. Do not optimize it; its only job is to be obviously right.
 */
export function naiveVisiblePaths(
  paths: readonly string[],
  expanded: ReadonlySet<string>,
): string[] {
  const visible: string[] = []

  walk('', paths, expanded, visible)

  return visible
}

/** Every directory in `paths`, i.e. the expanded set for a fully open tree. */
export function allDirectories(paths: readonly string[]): Set<string> {
  return new Set(paths.filter((path) => path.endsWith('/')))
}

function walk(
  parent: string,
  paths: readonly string[],
  expanded: ReadonlySet<string>,
  visible: string[],
): void {
  for (const child of childrenOf(parent, paths)) {
    visible.push(child)
    if (!child.endsWith('/')) continue
    if (!expanded.has(child)) continue

    walk(child, paths, expanded, visible)
  }
}

/** Direct children of `parent`, directories first, then files, each by name. */
function childrenOf(parent: string, paths: readonly string[]): string[] {
  const children = paths.filter((path) => isChildOf(parent, path))

  return children.sort(compareSiblings)
}

function isChildOf(parent: string, path: string): boolean {
  if (!path.startsWith(parent)) return false

  const rest = path.slice(parent.length)
  if (rest === '') return false

  const withoutTrailingSlash = rest.endsWith('/') ? rest.slice(0, -1) : rest

  return !withoutTrailingSlash.includes('/')
}

function compareSiblings(left: string, right: string): number {
  const leftIsDirectory = left.endsWith('/')
  const rightIsDirectory = right.endsWith('/')
  if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1

  return nameOf(left) < nameOf(right) ? -1 : 1
}

function nameOf(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path

  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

function padded(index: number): string {
  return String(index).padStart(4, '0')
}

function pick(rng: () => number, maxChildren: number): string {
  return String(Math.floor(rng() * maxChildren))
}
