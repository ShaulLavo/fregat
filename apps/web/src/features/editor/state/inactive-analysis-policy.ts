import type { EditorDocumentAnalysis } from '@singapore-editor/core/editor'

type RetentionEntry = ReturnType<EditorDocumentAnalysis['inspectLeases']>[number]
type Reclamation = ReturnType<EditorDocumentAnalysis['reclaimInactive']>

export type InactiveAnalysisDisposition = 'warm' | 'obsolete' | 'abandoned'

type Census = {
  readonly analysisCount: number
  readonly entryCount: number
  readonly inactiveEntryCount: number
  readonly protectedEntryCount: number
}

type Candidate = {
  readonly analysis: EditorDocumentAnalysis
  readonly entry: RetentionEntry
}

type SelectedCandidate = Candidate & {
  readonly disposition: InactiveAnalysisDisposition
}

type Enumeration = {
  readonly census: Census
  readonly candidates: readonly Candidate[]
}

export function reconcileInactiveAnalysis({
  enumerate,
  classify,
  limit,
}: {
  readonly enumerate: () => Iterable<EditorDocumentAnalysis>
  readonly classify: (
    analysis: EditorDocumentAnalysis,
    entry: RetentionEntry,
  ) => InactiveAnalysisDisposition
  readonly limit: number
}): {
  readonly before: Census
  readonly after: Census
  readonly reclaimed: readonly Reclamation[]
} {
  let current = inspectOwners(enumerate)
  const before = current.census
  const reclaimed: Reclamation[] = []
  const attempted = new Map<EditorDocumentAnalysis, Set<string>>()
  // Disposal can create new entries. Bound this pass and let the host schedule their lifecycle.
  for (let remaining = before.entryCount; remaining > 0; remaining--) {
    if (current.census.inactiveEntryCount <= limit) break
    const candidate = selectCandidate(current.candidates, classify, attempted)
    if (!candidate) break
    const { analysis, entry, disposition } = candidate
    const ids = attempted.get(analysis) ?? new Set<string>()
    ids.add(entry.runtimeSessionId)
    attempted.set(analysis, ids)
    const receipt = analysis.reclaimInactive({
      reason: disposition === 'abandoned' ? 'speculative-abandoned' : 'inactive-budget',
      runtimeSessionIds: [entry.runtimeSessionId],
    })
    if (receipt.runtimeSessionIds.length > 0) reclaimed.push(receipt)
    current = inspectOwners(enumerate)
  }
  return { before, after: inspectOwners(enumerate).census, reclaimed }
}

function inspectOwners(enumerate: () => Iterable<EditorDocumentAnalysis>): Enumeration {
  const owners = new Set(enumerate())
  const candidates: Candidate[] = []
  let entryCount = 0
  let protectedEntryCount = 0
  for (const analysis of owners) {
    const entries = new Map(
      analysis.inspectLeases().map((entry) => [entry.runtimeSessionId, entry]),
    )
    entryCount += entries.size
    for (const entry of entries.values()) {
      if (entry.leaseCount > 0) protectedEntryCount++
      else candidates.push({ analysis, entry })
    }
  }
  return {
    census: {
      analysisCount: owners.size,
      entryCount,
      inactiveEntryCount: candidates.length,
      protectedEntryCount,
    },
    candidates,
  }
}

function selectCandidate(
  candidates: readonly Candidate[],
  classify: (
    analysis: EditorDocumentAnalysis,
    entry: RetentionEntry,
  ) => InactiveAnalysisDisposition,
  attempted: ReadonlyMap<EditorDocumentAnalysis, ReadonlySet<string>>,
): SelectedCandidate | undefined {
  return candidates
    .filter(({ analysis, entry }) => !attempted.get(analysis)?.has(entry.runtimeSessionId))
    .map((candidate, order) => ({
      ...candidate,
      order,
      disposition: classify(candidate.analysis, candidate.entry),
    }))
    .toSorted(
      (a, b) =>
        Number(a.disposition === 'warm') - Number(b.disposition === 'warm') ||
        (a.entry.lastLeaseReleasedAt ?? 0) - (b.entry.lastLeaseReleasedAt ?? 0) ||
        a.order - b.order,
    )[0]
}
