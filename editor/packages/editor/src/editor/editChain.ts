import type { TextEdit } from '../tokens'

declare const documentLogicalRevisionScopeBrand: unique symbol
declare const documentSyncSegmentBrand: unique symbol

export type DocumentLogicalRevisionScope = {
  readonly [documentLogicalRevisionScopeBrand]: true
}

export type DocumentSyncSegment = {
  readonly [documentSyncSegmentBrand]: true
}

export type DocumentSyncPoint = {
  readonly revision: number
  readonly segment: DocumentSyncSegment
  readonly textVersion: number
}

export type DocumentChangesSinceSyncPoint = {
  readonly edits: readonly TextEdit[] | null
  readonly logicalRevisionCount: number
  readonly revisionAfter: number
  readonly syncPointAfter: DocumentSyncPoint
}

export type DocumentEditChainRecord = {
  readonly edits: readonly TextEdit[] | null
  readonly logicalRevisionCount: number
  readonly logicalRevisionScope: DocumentLogicalRevisionScope | null
  readonly revisionAfter: number
  readonly revisionBefore: number
  readonly textChanged: boolean
}

type EditChainEntry = DocumentEditChainRecord & {
  readonly textVersionAfter: number
  readonly textVersionBefore: number
}

type ComposedEdit = {
  from: number
  to: number
  text: string
}

const MAX_ENTRIES = 128

export function createDocumentLogicalRevisionScope(): DocumentLogicalRevisionScope {
  return Object.freeze({}) as DocumentLogicalRevisionScope
}

function createDocumentSyncSegment(): DocumentSyncSegment {
  return Object.freeze({}) as DocumentSyncSegment
}

export class DocumentEditChain {
  #entries: EditChainEntry[] = []
  #point: DocumentSyncPoint

  public constructor(revision = 0, textVersion = 0) {
    this.#point = {
      revision,
      segment: createDocumentSyncSegment(),
      textVersion,
    }
  }

  public get point(): DocumentSyncPoint {
    return this.#point
  }

  public record(record: DocumentEditChainRecord): void {
    const current = this.#point
    if (record.revisionBefore !== current.revision) {
      this.rotate(record.revisionAfter, current.textVersion + Number(record.textChanged))
      return
    }

    const textVersionAfter = current.textVersion + Number(record.textChanged)
    this.#entries.push({
      ...record,
      textVersionBefore: current.textVersion,
      textVersionAfter,
    })
    this.#point = {
      revision: record.revisionAfter,
      segment: current.segment,
      textVersion: textVersionAfter,
    }
    this.trim()
  }

  public rotate(revision = this.#point.revision, textVersion = this.#point.textVersion): void {
    this.#entries = []
    this.#point = {
      revision,
      segment: createDocumentSyncSegment(),
      textVersion,
    }
  }

  public changesSince(
    point: DocumentSyncPoint,
    scope: DocumentLogicalRevisionScope | null,
  ): DocumentChangesSinceSyncPoint | null {
    const current = this.#point
    if (point.segment !== current.segment) return null
    if (point.revision === current.revision && point.textVersion === current.textVersion) {
      return {
        edits: [],
        logicalRevisionCount: 0,
        revisionAfter: current.revision,
        syncPointAfter: current,
      }
    }

    const entries = this.entriesFrom(point)
    if (!entries) return null

    return {
      edits: composeEntries(entries),
      logicalRevisionCount: logicalRevisionCount(entries, scope),
      revisionAfter: current.revision,
      syncPointAfter: current,
    }
  }

  private entriesFrom(point: DocumentSyncPoint): readonly EditChainEntry[] | null {
    const start = this.#entries.findIndex(
      (entry) =>
        entry.revisionBefore === point.revision && entry.textVersionBefore === point.textVersion,
    )
    if (start === -1) return null

    const entries = this.#entries.slice(start)
    let revision = point.revision
    let textVersion = point.textVersion
    for (const entry of entries) {
      if (entry.revisionBefore !== revision || entry.textVersionBefore !== textVersion) return null
      revision = entry.revisionAfter
      textVersion = entry.textVersionAfter
    }

    if (revision !== this.#point.revision || textVersion !== this.#point.textVersion) return null
    return entries
  }

  private trim(): void {
    if (this.#entries.length <= MAX_ENTRIES) return
    this.#entries.splice(0, this.#entries.length - MAX_ENTRIES)
  }
}

function logicalRevisionCount(
  entries: readonly EditChainEntry[],
  scope: DocumentLogicalRevisionScope | null,
): number {
  let count = 0
  for (const entry of entries) {
    if (scope !== null && entry.logicalRevisionScope === scope) {
      count += entry.logicalRevisionCount
      continue
    }
    if (entry.textChanged) count += 1
  }
  return count
}

function composeEntries(entries: readonly EditChainEntry[]): readonly TextEdit[] | null {
  let composed: ComposedEdit[] = []
  for (const entry of entries) {
    if (!entry.textChanged) continue
    if (!entry.edits) return null

    const next = composeBatch(composed, entry.edits)
    if (!next) return null
    composed = next
  }
  return composed
}

function composeBatch(
  composed: readonly ComposedEdit[],
  batch: readonly TextEdit[],
): ComposedEdit[] | null {
  const next = composed.map((edit) => ({ ...edit }))
  const inserts: ComposedEdit[] = []
  const sortedBatch = batch.toSorted((left, right) => right.from - left.from)

  for (const edit of sortedBatch) {
    if (!placeBatchEdit(next, inserts, edit)) return null
  }

  for (const insert of inserts) {
    if (!insertComposedEdit(next, insert)) return null
  }
  return next
}

function placeBatchEdit(
  composed: ComposedEdit[],
  inserts: ComposedEdit[],
  edit: TextEdit,
): boolean {
  const from = Math.min(edit.from, edit.to)
  const to = Math.max(edit.from, edit.to)
  let delta = 0

  for (const target of composed) {
    const currentStart = target.from + delta
    const currentEnd = currentStart + target.text.length

    if (to <= currentStart) break
    if (from >= currentStart && to <= currentEnd) {
      const offset = from - currentStart
      target.text =
        target.text.slice(0, offset) + edit.text + target.text.slice(offset + (to - from))
      return true
    }
    if (from < currentEnd) return false
    delta += target.text.length - (target.to - target.from)
  }

  inserts.push({ from: from - delta, to: to - delta, text: edit.text })
  return true
}

function insertComposedEdit(composed: ComposedEdit[], edit: ComposedEdit): boolean {
  let index = 0
  while (index < composed.length && composed[index]!.from < edit.from) index += 1

  const previous = composed[index - 1]
  if (previous && previous.to > edit.from) return false
  const following = composed[index]
  if (following && edit.to > following.from) return false

  if (following && edit.to === following.from) {
    following.from = edit.from
    following.text = edit.text + following.text
    mergeWithPrevious(composed, index)
    return true
  }
  if (previous && previous.to === edit.from) {
    previous.to = edit.to
    previous.text += edit.text
    return true
  }

  composed.splice(index, 0, edit)
  return true
}

function mergeWithPrevious(composed: ComposedEdit[], index: number): void {
  const previous = composed[index - 1]
  const current = composed[index]
  if (!previous || !current || previous.to !== current.from) return

  previous.to = current.to
  previous.text += current.text
  composed.splice(index, 1)
}
