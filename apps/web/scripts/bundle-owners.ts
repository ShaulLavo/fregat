import path from 'node:path'
import type { BundleStatsChunk } from './bundle-stats-plugin'

export type OwnerRow = {
  readonly owner: string
  /** Post-treeshake, pre-minify bytes in first-load chunks. */
  readonly firstLoadRendered: number
  /** The chunk's gzip split by rendered share: a ranking, not a budget. */
  readonly firstLoadGzip: number
  readonly firstLoadModules: number
  /** Rendered bytes in chunks a cold load does not fetch. */
  readonly lazyRendered: number
}

const FEATURE_DEPTH = 5
const SOURCE_DEPTH = 4
const PACKAGE_DEPTH = 2
type LinkedCheckout = { readonly owner: string; readonly root: string }

/**
 * Folds a module id to who owns its bytes: a feature directory, a source
 * directory, a workspace package, a linked checkout, or `node_modules` whole.
 */
export function moduleOwner(
  rawId: string,
  repoRoot: string,
  linked: readonly LinkedCheckout[] = [],
): string {
  if (rawId.startsWith('\0') || rawId.includes('virtual:')) return 'virtual'
  const id = rawId.split('?')[0] ?? rawId
  // First, so a linked checkout's vendored dependency is not counted as its own code.
  if (id.includes('/node_modules/')) return 'node_modules'

  const relative = path.relative(repoRoot, id)
  if (relative.startsWith('..')) return linkedCheckout(id, repoRoot, linked)

  const segments = relative.split(path.sep)
  if (relative.startsWith('apps/web/src/features/')) return directoryOwner(segments, FEATURE_DEPTH)
  if (relative.startsWith('apps/web/src/')) return directoryOwner(segments, SOURCE_DEPTH)
  return directoryOwner(segments, PACKAGE_DEPTH)
}

// A file sitting directly in the parent belongs to the parent, not to a
// directory named after the file.
function directoryOwner(segments: readonly string[], depth: number): string {
  return segments.slice(0, Math.min(depth, segments.length - 1)).join('/')
}

function linkedCheckout(id: string, repoRoot: string, linked: readonly LinkedCheckout[]): string {
  for (const checkout of linked) {
    if (id === checkout.root || id.startsWith(`${checkout.root}${path.sep}`)) return checkout.owner
  }
  const sibling = path.relative(path.dirname(repoRoot), id)
  if (sibling.startsWith('..')) return 'external'
  return sibling.split(path.sep)[0] ?? 'external'
}

export function attributeOwners(
  chunks: readonly BundleStatsChunk[],
  firstLoadNames: ReadonlySet<string>,
  repoRoot: string,
  linked: readonly LinkedCheckout[] = [],
): OwnerRow[] {
  const rows = new Map<string, Mutable<OwnerRow>>()
  for (const chunk of chunks) {
    const rendered = chunk.modules.reduce((total, module) => total + module.renderedLength, 0)
    if (rendered === 0) continue
    const inFirstLoad = firstLoadNames.has(chunk.fileName)
    for (const module of chunk.modules) {
      const row = rowFor(rows, moduleOwner(module.id, repoRoot, linked))
      if (!inFirstLoad) {
        row.lazyRendered += module.renderedLength
        continue
      }
      row.firstLoadRendered += module.renderedLength
      row.firstLoadGzip += (module.renderedLength / rendered) * chunk.gzipSize
      row.firstLoadModules += 1
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, firstLoadGzip: Math.round(row.firstLoadGzip) }))
    .sort(
      (a, b) =>
        b.firstLoadRendered - a.firstLoadRendered ||
        b.lazyRendered - a.lazyRendered ||
        a.owner.localeCompare(b.owner),
    )
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function rowFor(rows: Map<string, Mutable<OwnerRow>>, owner: string): Mutable<OwnerRow> {
  const existing = rows.get(owner)
  if (existing) return existing
  const created = {
    owner,
    firstLoadRendered: 0,
    firstLoadGzip: 0,
    firstLoadModules: 0,
    lazyRendered: 0,
  }
  rows.set(owner, created)
  return created
}
