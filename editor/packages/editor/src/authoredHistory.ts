import {
  charIdAt,
  locateCharId,
  type CharId,
  type PieceTableAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import {
  createAnchorSelection,
  normalizeSelectionSet,
  resolveSelection,
  type SelectionAffinity,
  type SelectionGoal,
  type SelectionSet,
} from './selections'

type HistoryOperationId = { readonly actor: string; readonly seq: number }
type HistoryOperationGroup = {
  readonly id: HistoryOperationId
  readonly edits: readonly HistoryOperationId[]
}
export type CharacterGap = {
  readonly left: CharId | 'start'
  readonly right: CharId | 'end'
  readonly bias: 'left' | 'right'
}
export type IdentitySelections = {
  readonly selections: readonly {
    readonly id: string
    readonly anchor: CharacterGap
    readonly head: CharacterGap
    readonly goal: SelectionGoal
    readonly affinity: SelectionAffinity
  }[]
  readonly lastAddedIndex?: number
}
export type AuthoredHistoryEdge = HistoryOperationGroup & {
  readonly before: IdentitySelections
  readonly after: IdentitySelections
}

/** Operation groups are local-author edges; the author applies the whole path atomically. */
export type DocumentAuthoredHistory = {
  capture(): HistoryOperationGroup | null
  apply(
    changes: readonly { readonly transaction: HistoryOperationGroup; readonly active: boolean }[],
  ): PieceTableSnapshot
  preview(
    changes: readonly { readonly transaction: HistoryOperationGroup; readonly active: boolean }[],
  ): PieceTableSnapshot
  settlement(): readonly { readonly op: HistoryOperationId; readonly active: boolean }[] | null
  seal(): void
  identity(): string
  matchesIdentity(saved: string): boolean
}

export function captureCharacterGap(
  snapshot: PieceTableSnapshot,
  offset: number,
  bias: 'left' | 'right' = 'right',
): CharacterGap {
  return {
    left: offset === 0 ? 'start' : charIdAt(snapshot, offset - 1)!,
    right: offset === snapshot.length ? 'end' : charIdAt(snapshot, offset)!,
    bias,
  }
}

export function resolveCharacterGap(
  snapshot: PieceTableSnapshot,
  gap: CharacterGap,
): number | null {
  const left =
    gap.left === 'start' ? { offset: 0, liveness: 'deleted' } : locateCharId(snapshot, gap.left)
  const right =
    gap.right === 'end' ? { offset: snapshot.length } : locateCharId(snapshot, gap.right)
  if (gap.bias === 'left' && left) return left.offset + Number(left.liveness === 'live')
  if (right) return right.offset
  return left ? left.offset + Number(left.liveness === 'live') : null
}

export function captureIdentitySelections(
  snapshot: PieceTableSnapshot,
  set: SelectionSet<PieceTableAnchor>,
): IdentitySelections {
  return {
    lastAddedIndex: set.lastAddedIndex,
    selections: set.selections.map((selection) => {
      const resolved = resolveSelection(snapshot, selection)
      const anchorBias = resolved.reversed && !resolved.collapsed ? 'left' : 'right'
      const headBias = !resolved.reversed && !resolved.collapsed ? 'left' : 'right'
      return {
        id: selection.id,
        anchor: captureCharacterGap(snapshot, resolved.anchorOffset, anchorBias),
        head: captureCharacterGap(snapshot, resolved.headOffset, headBias),
        goal: selection.goal,
        affinity: selection.affinity,
      }
    }),
  }
}

export function resolveIdentitySelections(
  snapshot: PieceTableSnapshot,
  set: IdentitySelections,
): SelectionSet<PieceTableAnchor> {
  return normalizeSelectionSet(snapshot, {
    lastAddedIndex: set.lastAddedIndex,
    normalized: false,
    selections: set.selections.map((selection) =>
      createAnchorSelection(
        snapshot,
        resolveCharacterGap(snapshot, selection.anchor) ?? 0,
        resolveCharacterGap(snapshot, selection.head) ?? 0,
        { id: selection.id, goal: selection.goal, affinity: selection.affinity },
      ),
    ),
  })
}

export function repairIdentitySelections(
  snapshot: PieceTableSnapshot,
  set: IdentitySelections,
): IdentitySelections {
  const known = (gap: CharacterGap) =>
    (gap.left === 'start' || locateCharId(snapshot, gap.left) !== null) &&
    (gap.right === 'end' || locateCharId(snapshot, gap.right) !== null)
  if (set.selections.every((selection) => known(selection.anchor) && known(selection.head)))
    return set
  return captureIdentitySelections(snapshot, resolveIdentitySelections(snapshot, set))
}

export function authoredPathChanges(
  nodes: ReadonlyMap<
    number,
    { readonly parentId: number | null; readonly authored?: AuthoredHistoryEdge }
  >,
  fromId: number,
  toId: number,
): readonly { readonly transaction: AuthoredHistoryEdge; readonly active: boolean }[] {
  const path = (id: number) => {
    const result: number[] = []
    for (let current: number | null = id; current !== null; current = nodes.get(current)!.parentId)
      result.push(current)
    return result.reverse()
  }
  const from = path(fromId)
  const to = path(toId)
  let common = 0
  while (common < from.length && from[common] === to[common]) common++
  return from
    .slice(common)
    .reverse()
    .map((id) => ({ transaction: nodes.get(id)!.authored!, active: false }))
    .concat(to.slice(common).map((id) => ({ transaction: nodes.get(id)!.authored!, active: true })))
}
