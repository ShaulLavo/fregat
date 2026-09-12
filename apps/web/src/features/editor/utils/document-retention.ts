import type { DocumentKey, FilesystemPath, TabId } from '@/lib/documents/utils/types'

const DEFAULT_PROJECT_LIMIT = 3

export type RetainedWorkspaceSlice = {
  readonly documentKeys: readonly DocumentKey[]
  readonly lastActiveAt: number
  /** `null` is the rootless active slice; a real root can never collide with it. */
  readonly rootPath: FilesystemPath | null
  readonly tabIds: readonly TabId[]
}

export type DocumentRetention = {
  readonly documentKeys: ReadonlySet<DocumentKey>
  readonly tabIds: ReadonlySet<TabId>
}

/**
 * Which documents and views survive a project switch or a tab close.
 *
 * Two ceilings, because either alone is defeated: a count ignores size, a size
 * budget keeps unboundedly many tiny projects. The keep set is the UNION over
 * retained slices — roots nest, so per-slice drops a document another still shows.
 */
export function retentionForProjects({
  activeRootPath,
  byteBudget,
  documentSizes,
  projectLimit = DEFAULT_PROJECT_LIMIT,
  slices,
  unevictableDocumentKeys,
}: {
  readonly activeRootPath: FilesystemPath | null
  /** UTF-16 code units, not bytes: byte-exact for ASCII, an under-count otherwise. */
  readonly byteBudget: number
  /** Required, and only the document store can produce it — so a caller cannot omit it. */
  readonly documentSizes: ReadonlyMap<DocumentKey, number>
  readonly projectLimit?: number
  readonly slices: readonly RetainedWorkspaceSlice[]
  /** Documents `retain` keeps regardless of the keep set; their text is unavoidable. */
  readonly unevictableDocumentKeys: ReadonlySet<DocumentKey>
}): DocumentRetention {
  const retained = retainedSlices({
    activeRootPath,
    byteBudget,
    documentSizes,
    projectLimit,
    slices,
    unevictableDocumentKeys,
  })

  return {
    documentKeys: new Set(retained.flatMap((slice) => slice.documentKeys)),
    tabIds: new Set(retained.flatMap((slice) => slice.tabIds)),
  }
}

function retainedSlices({
  activeRootPath,
  byteBudget,
  documentSizes,
  projectLimit,
  slices,
  unevictableDocumentKeys,
}: {
  activeRootPath: FilesystemPath | null
  byteBudget: number
  documentSizes: ReadonlyMap<DocumentKey, number>
  projectLimit: number
  slices: readonly RetainedWorkspaceSlice[]
  unevictableDocumentKeys: ReadonlySet<DocumentKey>
}) {
  const active = slices.filter((slice) => slice.rootPath === activeRootPath)
  const parked = slices
    .filter((slice) => slice.rootPath !== activeRootPath)
    .toSorted((left, right) => right.lastActiveAt - left.lastActiveAt)
    .slice(0, Math.max(0, projectLimit - active.length))

  return [
    ...active,
    ...withinByteBudget(active, parked, byteBudget, documentSizes, unevictableDocumentKeys),
  ]
}

/** The active project is never trimmed; parked slices are admitted newest-first, each skipped if it would not fit. */
function withinByteBudget(
  active: readonly RetainedWorkspaceSlice[],
  parked: readonly RetainedWorkspaceSlice[],
  byteBudget: number,
  documentSizes: ReadonlyMap<DocumentKey, number>,
  unevictableDocumentKeys: ReadonlySet<DocumentKey>,
) {
  // Unevictable text is charged first and once, wherever it lives. Rejecting a
  // slice does not evict its dirty or non-file documents, so leaving them out of
  // the total let optional parked text be admitted on top of them and overshoot.
  // Seeding `charged` also makes a slice that merely contains one cost nothing
  // extra, which is correct — keeping it frees no text either.
  const charged = new Set<DocumentKey>(unevictableDocumentKeys)
  let total = 0
  for (const documentKey of unevictableDocumentKeys) {
    total += documentSizes.get(documentKey) ?? 0
  }

  // A rejected slice must not charge documents a later, kept slice shares.
  // Active slices commit unconditionally — they are never trimmed.
  for (const slice of active) total += commitSliceSize(slice, documentSizes, charged)

  const kept: RetainedWorkspaceSlice[] = []
  for (const slice of parked) {
    const size = measureSliceSize(slice, documentSizes, charged)
    // A fully-charged slice cannot move `total`, so dropping it frees no text and
    // only costs its views. This is the nested-root case.
    if (size > 0 && total + size > byteBudget) continue

    total += size
    kept.push(commitSlice(slice, charged))
  }

  return kept
}

/** Shared documents are charged once — `charged` carries across slices deliberately. */
function measureSliceSize(
  slice: RetainedWorkspaceSlice,
  documentSizes: ReadonlyMap<DocumentKey, number>,
  charged: ReadonlySet<DocumentKey>,
) {
  // `seen` is what mutating `charged` used to provide: a document listed twice in
  // one slice must still be charged once.
  const seen = new Set<DocumentKey>()
  let size = 0
  for (const documentKey of slice.documentKeys) {
    if (charged.has(documentKey)) continue
    if (seen.has(documentKey)) continue

    seen.add(documentKey)
    size += documentSizes.get(documentKey) ?? 0
  }

  return size
}

function commitSliceSize(
  slice: RetainedWorkspaceSlice,
  documentSizes: ReadonlyMap<DocumentKey, number>,
  charged: Set<DocumentKey>,
) {
  const size = measureSliceSize(slice, documentSizes, charged)
  commitSlice(slice, charged)
  return size
}

function commitSlice(slice: RetainedWorkspaceSlice, charged: Set<DocumentKey>) {
  for (const documentKey of slice.documentKeys) charged.add(documentKey)

  return slice
}
