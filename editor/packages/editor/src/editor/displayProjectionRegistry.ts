import type { InjectedTextRow } from '../displayTransforms'
import type { EditorGutterContribution } from '../plugins'
import type { EditorDisposable } from './disposables'
import type { FoldRange } from '../syntax/session'
import type { VirtualizedTextRowDecoration } from '../virtualization/virtualizedTextViewTypes'
import { rejectCrossingFoldRanges, type FoldRangeRejection } from './folds'
import type { EditorRangeDecoration } from './types'

export type EditorDisplayProjectionKind =
  | 'folds'
  | 'rowDecorations'
  | 'rangeDecorations'
  | 'injectedRows'
  | 'gutters'

export type EditorDisplayProjectionPayload = {
  readonly folds: readonly FoldRange[]
  readonly rowDecorations: ReadonlyMap<number, VirtualizedTextRowDecoration>
  readonly rangeDecorations: readonly EditorRangeDecoration[]
  readonly injectedRows: readonly InjectedTextRow[]
  readonly gutters: readonly EditorGutterContribution[]
}

export type EditorDisplayProjectionSource = {
  readonly documentId: string | null
  readonly documentVersion: number
  readonly textVersion: number
}

export type EditorDisplayProjectionInvalidationRange =
  | {
      readonly kind: 'document'
    }
  | {
      readonly kind: 'offsets'
      readonly startOffset: number
      readonly endOffset: number
    }
  | {
      readonly kind: 'rows'
      readonly startRow: number
      readonly endRow: number
    }

export type EditorDisplayProjectionDisposal =
  | {
      readonly behavior: 'none'
    }
  | {
      readonly behavior: 'dispose'
      readonly disposable: EditorDisposable
    }

export type EditorDisplayProjection<K extends EditorDisplayProjectionKind> = {
  readonly kind: K
  readonly owner: string
  readonly source: EditorDisplayProjectionSource
  readonly invalidationRange: EditorDisplayProjectionInvalidationRange
  readonly layer: number
  readonly priority: number
  readonly disposal: EditorDisplayProjectionDisposal
  readonly value: EditorDisplayProjectionPayload[K]
}

type StoredDisplayProjection<K extends EditorDisplayProjectionKind> = {
  readonly projection: EditorDisplayProjection<K>
  readonly sequence: number
}

type OwnedFoldRange = {
  readonly owner: string
  readonly fold: FoldRange
}

export const FULL_DISPLAY_PROJECTION_INVALIDATION: EditorDisplayProjectionInvalidationRange = {
  kind: 'document',
}

export const NO_DISPLAY_PROJECTION_DISPOSAL: EditorDisplayProjectionDisposal = {
  behavior: 'none',
}

export class EditorDisplayProjectionRegistry {
  private readonly projections = new Map<
    string,
    StoredDisplayProjection<EditorDisplayProjectionKind>
  >()
  private nextSequence = 0

  set<K extends EditorDisplayProjectionKind>(projection: EditorDisplayProjection<K>): void {
    validateDisplayProjection(projection)

    const key = displayProjectionKey(projection.kind, projection.owner)
    const previous = this.projections.get(key)
    const sequence = previous?.sequence ?? this.nextSequence
    const next = { projection, sequence }

    this.validateNextProjectionState(next)
    this.disposeReplacedProjection(previous, projection)
    this.projections.set(key, next)
    if (!previous) this.nextSequence += 1
  }

  get<K extends EditorDisplayProjectionKind>(
    kind: K,
    owner: string,
  ): EditorDisplayProjection<K> | null {
    const stored = this.projections.get(displayProjectionKey(kind, owner))
    if (!stored) return null

    return stored.projection as EditorDisplayProjection<K>
  }

  values<K extends EditorDisplayProjectionKind>(kind: K): readonly EditorDisplayProjection<K>[] {
    return this.storedValues(kind).map((stored) => stored.projection)
  }

  replaceValue<K extends EditorDisplayProjectionKind>(
    kind: K,
    owner: string,
    value: EditorDisplayProjectionPayload[K],
    options: {
      readonly source?: EditorDisplayProjectionSource
      readonly invalidationRange?: EditorDisplayProjectionInvalidationRange
    } = {},
  ): boolean {
    const key = displayProjectionKey(kind, owner)
    const stored = this.projections.get(key) as StoredDisplayProjection<K> | undefined
    if (!stored) return false

    const projection = {
      ...stored.projection,
      value,
      source: options.source ?? stored.projection.source,
      invalidationRange: options.invalidationRange ?? stored.projection.invalidationRange,
    }
    const next = { projection, sequence: stored.sequence }

    validateDisplayProjection(projection)
    this.validateNextProjectionState(next)
    this.projections.set(key, next)
    return true
  }

  retagKind<K extends EditorDisplayProjectionKind>(
    kind: K,
    source: EditorDisplayProjectionSource,
  ): void {
    validateDisplayProjectionSource(source)
    for (const stored of this.storedValues(kind)) {
      this.replaceValue(kind, stored.projection.owner, stored.projection.value, { source })
    }
  }

  delete(kind: EditorDisplayProjectionKind, owner: string): boolean {
    const key = displayProjectionKey(kind, owner)
    const stored = this.projections.get(key)
    if (!stored) return false

    this.projections.delete(key)
    disposeDisplayProjection(stored.projection)
    return true
  }

  clear(): void {
    for (const stored of this.projections.values()) {
      disposeDisplayProjection(stored.projection)
    }

    this.projections.clear()
  }

  private storedValues<K extends EditorDisplayProjectionKind>(
    kind: K,
  ): readonly StoredDisplayProjection<K>[] {
    const values: StoredDisplayProjection<K>[] = []
    for (const stored of this.projections.values()) {
      if (stored.projection.kind !== kind) continue

      values.push(stored as StoredDisplayProjection<K>)
    }

    return values.sort(compareStoredDisplayProjections)
  }

  private storedValuesWithReplacement<K extends EditorDisplayProjectionKind>(
    next: StoredDisplayProjection<K>,
  ): readonly StoredDisplayProjection<K>[] {
    const nextKey = displayProjectionKey(next.projection.kind, next.projection.owner)
    const values: StoredDisplayProjection<K>[] = []

    for (const [key, stored] of this.projections) {
      if (key === nextKey) continue
      if (stored.projection.kind !== next.projection.kind) continue

      values.push(stored as StoredDisplayProjection<K>)
    }

    values.push(next)
    return values.sort(compareStoredDisplayProjections)
  }

  private validateNextProjectionState<K extends EditorDisplayProjectionKind>(
    next: StoredDisplayProjection<K>,
  ): void {
    if (next.projection.kind !== 'folds') return

    const projections = this.storedValuesWithReplacement(next as StoredDisplayProjection<'folds'>)
    validateFoldProjectionSet(projections)
  }

  private disposeReplacedProjection<K extends EditorDisplayProjectionKind>(
    previous: StoredDisplayProjection<EditorDisplayProjectionKind> | undefined,
    next: EditorDisplayProjection<K>,
  ): void {
    if (!previous) return
    if (previous.projection.disposal === next.disposal) return

    disposeDisplayProjection(previous.projection)
  }
}

function compareStoredDisplayProjections(
  left: StoredDisplayProjection<EditorDisplayProjectionKind>,
  right: StoredDisplayProjection<EditorDisplayProjectionKind>,
): number {
  return (
    left.projection.layer - right.projection.layer ||
    left.projection.priority - right.projection.priority ||
    left.sequence - right.sequence ||
    left.projection.owner.localeCompare(right.projection.owner)
  )
}

function disposeDisplayProjection(
  projection: EditorDisplayProjection<EditorDisplayProjectionKind>,
) {
  if (projection.disposal.behavior === 'none') return

  projection.disposal.disposable.dispose()
}

function displayProjectionKey(kind: EditorDisplayProjectionKind, owner: string): string {
  return `${kind}\u0000${owner}`
}

function validateDisplayProjection<K extends EditorDisplayProjectionKind>(
  projection: EditorDisplayProjection<K>,
): void {
  if (projection.owner.length === 0) throw new Error('Display projection owner is required')
  validateDisplayProjectionSource(projection.source)
  validateFiniteInteger(projection.layer, 'Display projection layer')
  validateFiniteInteger(projection.priority, 'Display projection priority')
  validateDisplayProjectionInvalidationRange(projection.invalidationRange)
  if (projection.kind === 'folds') {
    validateFoldProjectionValue(projection.owner, projection.value as readonly FoldRange[])
  }
}

function validateFoldProjectionValue(owner: string, folds: readonly FoldRange[]): void {
  const rejected = rejectCrossingFoldRanges(folds).rejected[0]
  if (!rejected) return
  if (rejected.kind === 'overlap') {
    throw new Error(`Fold projection "${owner}" contains crossing fold ranges`)
  }

  throw new Error(`Fold projection "${owner}" contains an invalid fold range: ${rejected.message}`)
}

function validateFoldProjectionSet(projections: readonly StoredDisplayProjection<'folds'>[]): void {
  const ownedFolds = foldRangesFromProjections(projections)
  const rejected = rejectCrossingFoldRanges(ownedFolds.map((ownedFold) => ownedFold.fold))
    .rejected[0]
  if (!rejected) return

  throw foldProjectionSetError(ownedFolds, rejected)
}

function foldRangesFromProjections(
  projections: readonly StoredDisplayProjection<'folds'>[],
): readonly OwnedFoldRange[] {
  const folds: OwnedFoldRange[] = []
  for (const projection of projections) {
    for (const fold of projection.projection.value) {
      folds.push({ owner: projection.projection.owner, fold })
    }
  }

  return folds
}

function foldProjectionSetError(
  ownedFolds: readonly OwnedFoldRange[],
  rejection: FoldRangeRejection,
): Error {
  const owner = ownerForFold(ownedFolds, rejection.fold)
  const previousOwner = rejection.previous ? ownerForFold(ownedFolds, rejection.previous) : null
  if (rejection.kind === 'overlap' && owner && previousOwner && owner !== previousOwner) {
    return new Error(
      `Fold projections "${previousOwner}" and "${owner}" contain crossing fold ranges`,
    )
  }
  if (owner) return new Error(`Fold projection "${owner}" contains ${rejection.message}`)
  return new Error(`Fold projections contain ${rejection.message}`)
}

function ownerForFold(ownedFolds: readonly OwnedFoldRange[], fold: FoldRange): string | null {
  return ownedFolds.find((ownedFold) => ownedFold.fold === fold)?.owner ?? null
}

function validateDisplayProjectionSource(source: EditorDisplayProjectionSource): void {
  validateNonNegativeInteger(source.documentVersion, 'Display projection documentVersion')
  validateNonNegativeInteger(source.textVersion, 'Display projection textVersion')
}

function validateDisplayProjectionInvalidationRange(
  range: EditorDisplayProjectionInvalidationRange,
): void {
  if (range.kind === 'document') return
  if (range.kind === 'offsets') {
    validateOrderedNonNegativeRange(
      range.startOffset,
      range.endOffset,
      'Display projection offset range',
    )
    return
  }

  validateOrderedNonNegativeRange(range.startRow, range.endRow, 'Display projection row range')
}

function validateOrderedNonNegativeRange(start: number, end: number, name: string): void {
  validateNonNegativeInteger(start, `${name} start`)
  validateNonNegativeInteger(end, `${name} end`)
  if (end < start) throw new Error(`${name} end must be greater than or equal to start`)
}

function validateNonNegativeInteger(value: number, name: string): void {
  validateFiniteInteger(value, name)
  if (value < 0) throw new Error(`${name} must be non-negative`)
}

function validateFiniteInteger(value: number, name: string): void {
  if (Number.isInteger(value)) return

  throw new Error(`${name} must be an integer`)
}
