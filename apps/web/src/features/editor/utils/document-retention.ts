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
 * Which documents and views survive a project switch or a tab close. Two
 * ceilings, because either alone is defeated: a project count says nothing about
 * size (one 100MB file per project blows past any count), and a size budget
 * alone would keep an unbounded number of tiny projects alive.
 *
 * The keep set is the UNION over every retained slice, never per-slice. Roots nest
 * (/repo and /repo/apps/web), so one absolute path can be referenced by two slices,
 * and computing per slice would drop a document the other slice still displays.
 *
 * `documentSizes` is required, and the only producer is the document store that
 * owns the documents. It used to be optional, which meant the single production
 * caller omitted it and `withinByteBudget` returned on its first line — the
 * declared ceiling was skipped entirely for the life of the feature. An API that
 * can be called without the input it needs is the defect; a required parameter
 * whose type only one place can produce is the fix.
 *
 * Sizes are UTF-16 code-unit counts taken from each retained snapshot in O(1).
 * That equals the byte count for ASCII and under-counts multi-byte UTF-8, so the
 * budget is a consistent measure of retained text rather than an exact heap
 * figure.
 */
export function retentionForProjects({
  activeRootPath,
  byteBudget,
  documentSizes,
  projectLimit = DEFAULT_PROJECT_LIMIT,
  slices,
}: {
  readonly activeRootPath: string | null
  readonly byteBudget: number
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

/** The active project is never trimmed; parked ones drop oldest-first until it fits. */
function withinByteBudget(
  active: readonly RetainedWorkspaceSlice[],
  parked: readonly RetainedWorkspaceSlice[],
  byteBudget: number,
  documentSizes: ReadonlyMap<string, number>,
) {
  // Charged documents are committed in two places for two different reasons: the
  // active slices always, because they are never trimmed, and a parked slice only
  // once it is kept. Measuring used to commit as a side effect, so a slice that
  // was then rejected still marked its documents charged and a later slice
  // sharing them was charged nothing — undercounting, in the direction that
  // retains too much.
  const charged = new Set<string>()
  let total = 0
  for (const slice of active) total += commitSliceSize(slice, documentSizes, charged)

  const kept: RetainedWorkspaceSlice[] = []
  for (const slice of parked) {
    const size = measureSliceSize(slice, documentSizes, charged)
    if (total + size > byteBudget) continue

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
