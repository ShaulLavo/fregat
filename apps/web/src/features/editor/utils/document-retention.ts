const DEFAULT_PROJECT_LIMIT = 3

export type RetainedWorkspaceSlice = {
  readonly documentIds: readonly string[]
  readonly lastActiveAt: number
  /** `null` is the rootless active slice; a real root can never collide with it. */
  readonly rootPath: string | null
  readonly tabIds: readonly string[]
}

export type DocumentRetention = {
  readonly documentIds: ReadonlySet<string>
  readonly tabIds: ReadonlySet<string>
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
}: {
  readonly activeRootPath: string | null
  /** UTF-16 code units, not bytes: byte-exact for ASCII, an under-count otherwise. */
  readonly byteBudget: number
  /** Required, and only the document store can produce it — so a caller cannot omit it. */
  readonly documentSizes: ReadonlyMap<string, number>
  readonly projectLimit?: number
  readonly slices: readonly RetainedWorkspaceSlice[]
}): DocumentRetention {
  const retained = retainedSlices({
    activeRootPath,
    byteBudget,
    documentSizes,
    projectLimit,
    slices,
  })

  return {
    documentIds: new Set(retained.flatMap((slice) => slice.documentIds)),
    tabIds: new Set(retained.flatMap((slice) => slice.tabIds)),
  }
}

function retainedSlices({
  activeRootPath,
  byteBudget,
  documentSizes,
  projectLimit,
  slices,
}: {
  activeRootPath: string | null
  byteBudget: number
  documentSizes: ReadonlyMap<string, number>
  projectLimit: number
  slices: readonly RetainedWorkspaceSlice[]
}) {
  const active = slices.filter((slice) => slice.rootPath === activeRootPath)
  const parked = slices
    .filter((slice) => slice.rootPath !== activeRootPath)
    .toSorted((left, right) => right.lastActiveAt - left.lastActiveAt)
    .slice(0, Math.max(0, projectLimit - active.length))

  return [...active, ...withinByteBudget(active, parked, byteBudget, documentSizes)]
}

/** The active project is never trimmed; parked slices are admitted newest-first, each skipped if it would not fit. */
function withinByteBudget(
  active: readonly RetainedWorkspaceSlice[],
  parked: readonly RetainedWorkspaceSlice[],
  byteBudget: number,
  documentSizes: ReadonlyMap<string, number>,
) {
  // A rejected slice must not charge documents a later, kept slice shares.
  // Active slices commit unconditionally — they are never trimmed.
  const charged = new Set<string>()
  let total = 0
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
  documentSizes: ReadonlyMap<string, number>,
  charged: ReadonlySet<string>,
) {
  // `seen` is what mutating `charged` used to provide for free: a document listed
  // twice within one slice must still be charged once.
  const seen = new Set<string>()
  let size = 0
  for (const documentId of slice.documentIds) {
    if (charged.has(documentId)) continue
    if (seen.has(documentId)) continue

    seen.add(documentId)
    size += documentSizes.get(documentId) ?? 0
  }

  return size
}

function commitSliceSize(
  slice: RetainedWorkspaceSlice,
  documentSizes: ReadonlyMap<string, number>,
  charged: Set<string>,
) {
  const size = measureSliceSize(slice, documentSizes, charged)
  commitSlice(slice, charged)
  return size
}

function commitSlice(slice: RetainedWorkspaceSlice, charged: Set<string>) {
  for (const documentId of slice.documentIds) charged.add(documentId)

  return slice
}
