import type {
  DiffFile,
  DiffGutterSide,
  PreparedDiffSyntaxInput,
  PreparedDiffSyntaxSource,
} from '@singapore-editor/diff'
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
const preparing = new Map<string, Promise<void>>()
const viewed = new Map<string, number>()

/**
 * Takes every side the pane draws, or none: a partial set would parse anyway. A preparation of
 * this file still running is handed over as its pending claim, so the view does not parse twice.
 */
export function claimPreparedDiffSyntax(
  file: DiffFile,
  paneSide: DiffGutterSide,
  source: string,
): PreparedDiffSyntaxInput {
  const running = preparing.get(preparingKey(file, source))
  if (running) return running.then(() => takePrepared(file, paneSide, source))
  return takePrepared(file, paneSide, source)
}

/** A diff on screen parses in its own view and releases the parse when it leaves. */
export function viewDiffSyntax(file: DiffFile, source: string): () => void {
  const key = preparingKey(file, source)
  viewed.set(key, (viewed.get(key) ?? 0) + 1)
  return () => {
    const count = (viewed.get(key) ?? 1) - 1
    if (count > 0) viewed.set(key, count)
    else viewed.delete(key)
  }
}

export function isDiffSyntaxViewed(file: DiffFile, source: string): boolean {
  return viewed.has(preparingKey(file, source))
}

/** Marks `file`'s preparation running until `work` settles, for views that open meanwhile. */
export function trackDiffSyntaxPreparation(
  file: DiffFile,
  source: string,
  work: Promise<unknown>,
): void {
  const key = preparingKey(file, source)
  const running = work.then(
    () => undefined,
    () => undefined,
  )
  preparing.set(key, running)
  void running.then(() => {
    if (preparing.get(key) === running) preparing.delete(key)
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

function preparingKey(file: DiffFile, source: string): string {
  return paneSources('stacked')
    .map((side) => preparedKey(file, side, source))
    .join('\u0000')
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
