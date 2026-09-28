import type {
  DiffFile,
  DiffGutterSide,
  PreparedDiffSyntaxInput,
  PreparedDiffSyntaxSource,
} from '@singapore-editor/diff'
import type { Mutation, QueryClient } from '@tanstack/react-query'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import {
  diffSourceFingerprint,
  type DiffSourceSide,
} from '@/features/editor/utils/diff-source-fingerprint'

// Source sides, not files: a stacked pane takes both, a split pane one. Eight two-sided diffs.
const PREPARED_SOURCE_LIMIT = 16

// Beside the syntax providers whose sessions these hold, and cleared when they are disposed.
// Each entry owns a live worker session, so eviction disposes it; nothing renders from here.
const prepared = new Map<string, PreparedDiffSyntaxSource>()
const fingerprints = new WeakMap<DiffFile, Partial<Record<DiffSourceSide, string>>>()
const viewed = new Map<string, number>()

/**
 * Takes every side the pane draws, or none: a partial set would parse anyway. A preparation of this
 * file that is running is awaited, so the view does not parse twice; a view that has left by then
 * (`isCurrent`) leaves the result in the store for its next visit.
 */
export function claimPreparedDiffSyntax(
  queryClient: QueryClient,
  file: DiffFile,
  paneSide: DiffGutterSide,
  source: string,
  isCurrent: () => boolean,
): PreparedDiffSyntaxInput {
  const running = runningPreparation(queryClient, diffSyntaxPreparationKey(file, source))
  if (!running) return takePrepared(file, paneSide, source)
  return mutationSettled(queryClient, running).then(() =>
    isCurrent() ? takePrepared(file, paneSide, source) : [],
  )
}

/** Names one file's preparation; it is the prepare mutation's variables. */
export function diffSyntaxPreparationKey(file: DiffFile, source: string): string {
  return paneSources('stacked')
    .map((side) => preparedKey(file, side, source))
    .join('\u0000')
}

/** A diff on screen parses in its own view and releases the parse when it leaves. */
export function viewDiffSyntax(file: DiffFile, source: string): () => void {
  const key = diffSyntaxPreparationKey(file, source)
  viewed.set(key, (viewed.get(key) ?? 0) + 1)
  return () => {
    const count = (viewed.get(key) ?? 1) - 1
    if (count > 0) viewed.set(key, count)
    else viewed.delete(key)
  }
}

export function isDiffSyntaxViewed(file: DiffFile, source: string): boolean {
  return viewed.has(diffSyntaxPreparationKey(file, source))
}

// A queued preparation (paused behind the scope) is not awaited: the view parses sooner itself.
function runningPreparation(queryClient: QueryClient, key: string): Mutation | undefined {
  return queryClient
    .getMutationCache()
    .findAll({ mutationKey: editorMutationKeys.diffSyntaxPrepare(), status: 'pending' })
    .find((mutation) => !mutation.state.isPaused && mutation.state.variables === key)
}

function mutationSettled(queryClient: QueryClient, mutation: Mutation): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = queryClient.getMutationCache().subscribe(() => {
      if (mutation.state.status === 'pending') return
      unsubscribe()
      resolve()
    })
  })
}

function takePrepared(
  file: DiffFile,
  paneSide: DiffGutterSide,
  source: string,
): readonly PreparedDiffSyntaxSource[] {
  const keys = paneSources(paneSide).map((side) => preparedKey(file, side, source))
  if (!keys.every((key) => prepared.has(key))) return []

  return keys.map((key) => {
    const entry = prepared.get(key)!
    prepared.delete(key)
    return entry
  })
}

export function hasPreparedDiffSyntax(file: DiffFile, source: string): boolean {
  const keys = paneSources('stacked').map((side) => preparedKey(file, side, source))
  for (const key of keys) touch(key)
  return keys.every((key) => prepared.has(key))
}

/** Keeps a view's parsed sides for its next visit; a side already held keeps the older entry. */
export function storePreparedDiffSyntax(
  file: DiffFile,
  source: string,
  sources: readonly PreparedDiffSyntaxSource[],
): void {
  for (const entry of sources) {
    const key = preparedKey(file, entry.side, source)
    if (prepared.has(key)) {
      entry.dispose()
      continue
    }
    prepared.set(key, entry)
  }
  evictOverLimit()
}

export function clearPreparedDiffSyntax(source: string): void {
  for (const [key, entry] of prepared) {
    if (!key.startsWith(`${source}\u0000`)) continue
    entry.dispose()
    prepared.delete(key)
  }
}

function paneSources(paneSide: DiffGutterSide): readonly DiffSourceSide[] {
  return paneSide === 'stacked' ? ['old', 'new'] : [paneSide]
}

function preparedKey(file: DiffFile, side: DiffSourceSide, source: string): string {
  let memo = fingerprints.get(file)
  if (!memo) {
    memo = {}
    fingerprints.set(file, memo)
  }
  memo[side] ??= diffSourceFingerprint(file, side)
  return `${source}\u0000${side}\u0000${memo[side]}`
}

function touch(key: string): void {
  const entry = prepared.get(key)
  if (!entry) return
  prepared.delete(key)
  prepared.set(key, entry)
}

function evictOverLimit(): void {
  for (const [key, entry] of prepared) {
    if (prepared.size <= PREPARED_SOURCE_LIMIT) return
    entry.dispose()
    prepared.delete(key)
  }
}
