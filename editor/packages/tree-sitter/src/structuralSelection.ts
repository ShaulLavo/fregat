import type { PieceTableSnapshot, TextOffsetRange } from '@singapore-editor/core/document'
import type { FoldRange } from '@singapore-editor/core/syntax'
import {
  createAnchorSelection,
  normalizeSelectionSet,
  type PieceTableAnchor,
  resolveSelection,
  type SelectionSet,
} from '@singapore-editor/core/document'
import type { TreeSitterBackend } from './treeSitter/workerClient'
import type {
  TreeSitterLanguageId,
  TreeSitterSelectionRange,
  TreeSitterSelectionResult,
} from './treeSitter/types'

export type TreeSitterSelectionExpansionState = {
  readonly snapshotVersion: number
  readonly stacks: readonly (readonly TreeSitterSelectionRange[])[]
}

export type TreeSitterSelectionCommandOptions = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly languageId: TreeSitterLanguageId
  readonly snapshotVersion: number
  readonly snapshot: PieceTableSnapshot
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly backend: Pick<TreeSitterBackend, 'select'>
  readonly state?: TreeSitterSelectionExpansionState
}

export type TreeSitterSelectionCommandResult = {
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly state: TreeSitterSelectionExpansionState
  readonly status: 'ok' | 'stale'
}

type NormalizedSelectionInput = {
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly sources: readonly ResolvedSelection[]
  readonly ranges: readonly TreeSitterSelectionRange[]
}

type ResolvedSelection = ReturnType<typeof resolveSelection>

type SettledSelectionResult = {
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly stacks: readonly (readonly TreeSitterSelectionRange[])[]
}

/**
 * The nesting the grammar found, as one unordered bucket for the editor's selection ladder to rank.
 *
 * Fold ranges are node ranges the parse has already published, so expand climbs exactly the nesting
 * the gutter offers to collapse rather than a second, differently shaped idea of what encloses what.
 * The fold query only reports nodes that span lines, so a construct written on one line is left to
 * the word and line rungs.
 */
export const treeSitterSelectionRanges = (
  folds: readonly FoldRange[],
): readonly TextOffsetRange[] =>
  folds.map((fold) => ({ start: fold.startIndex, end: fold.endIndex }))

export const selectTreeSitterToken = async (
  options: TreeSitterSelectionCommandOptions,
): Promise<TreeSitterSelectionCommandResult> => {
  const input = normalizedSelectionInput(options)
  const result = await requestSelectionRanges(options, input.ranges, 'selectToken')
  return selectionCommandResult(options, input, result, (range) => [range])
}

export const expandTreeSitterSelection = async (
  options: TreeSitterSelectionCommandOptions,
): Promise<TreeSitterSelectionCommandResult> => {
  const input = normalizedSelectionInput(options)
  const result = await requestSelectionRanges(options, input.ranges, 'expand')
  return selectionCommandResult(options, input, result, (range, index) => {
    const stack = stackForSelection(options, index, input.ranges[index])
    const previous = stack.at(-1)
    if (previous && rangesEqual(previous, range)) return stack
    return [...stack, range]
  })
}

export const shrinkTreeSitterSelection = (
  options: TreeSitterSelectionCommandOptions,
): TreeSitterSelectionCommandResult => {
  const input = normalizedSelectionInput(options)
  const ranges = rangesFromShrinkState(options, input.ranges)
  if (!ranges) return noOpSelectionCommandResult(options, input, 'stale')

  const stacks = options.state!.stacks.map((stack) => stack.slice(0, -1))
  const settled = settleSelectionRanges(options.snapshot, input, ranges, stacks)

  return {
    selections: settled.selections,
    state: {
      snapshotVersion: options.snapshotVersion,
      stacks: settled.stacks,
    },
    status: 'ok',
  }
}

const requestSelectionRanges = (
  options: TreeSitterSelectionCommandOptions,
  ranges: readonly TreeSitterSelectionRange[],
  action: 'selectToken' | 'expand',
): Promise<TreeSitterSelectionResult | undefined> =>
  options.backend.select({
    documentId: options.documentId,
    runtimeSessionId: options.runtimeSessionId,
    languageId: options.languageId,
    snapshotVersion: options.snapshotVersion,
    action,
    ranges,
  })

const selectionCommandResult = (
  options: TreeSitterSelectionCommandOptions,
  input: NormalizedSelectionInput,
  result: TreeSitterSelectionResult | undefined,
  nextStack: (
    range: TreeSitterSelectionRange,
    index: number,
  ) => readonly TreeSitterSelectionRange[],
): TreeSitterSelectionCommandResult => {
  if (!result || result.status === 'stale') {
    return noOpSelectionCommandResult(options, input, 'stale')
  }
  if (result.ranges.length !== input.sources.length) {
    return noOpSelectionCommandResult(options, input, 'stale')
  }

  const stacks = result.ranges.map(nextStack)
  const settled = settleSelectionRanges(options.snapshot, input, result.ranges, stacks)

  return {
    selections: settled.selections,
    state: {
      snapshotVersion: options.snapshotVersion,
      stacks: settled.stacks,
    },
    status: 'ok',
  }
}

const noOpSelectionCommandResult = (
  options: TreeSitterSelectionCommandOptions,
  input: NormalizedSelectionInput,
  status: 'ok' | 'stale',
): TreeSitterSelectionCommandResult => ({
  selections: options.selections,
  state: options.state ?? {
    snapshotVersion: options.snapshotVersion,
    stacks: input.ranges.map((range) => [range]),
  },
  status,
})

const normalizedSelectionInput = (
  options: TreeSitterSelectionCommandOptions,
): NormalizedSelectionInput => {
  const selections = normalizeSelectionSet(options.snapshot, options.selections)
  const sources = selections.selections.map((selection) =>
    resolveSelection(options.snapshot, selection),
  )
  return {
    selections,
    sources,
    ranges: sources.map(selectionRange),
  }
}

const settleSelectionRanges = (
  snapshot: PieceTableSnapshot,
  input: NormalizedSelectionInput,
  ranges: readonly TreeSitterSelectionRange[],
  stacks: readonly (readonly TreeSitterSelectionRange[])[],
): SettledSelectionResult => {
  const selections = ranges.map((range, index) => {
    const source = input.sources[index]
    return createAnchorSelection(snapshot, range.startIndex, range.endIndex, {
      affinity: source?.affinity,
      id: source?.id,
      // Which end leads is the user's, not the tree's: a selection dragged right to left keeps
      // growing away from its anchor.
      reversed: source?.reversed ?? false,
    })
  })

  const normalized = normalizeSelectionSet(snapshot, {
    selections,
    lastAddedIndex: input.selections.lastAddedIndex,
    normalized: false,
  })
  const stackById = new Map(
    input.sources.map((source, index) => [source.id, stacks[index] ?? []] as const),
  )
  const settledStacks = normalized.selections.map((selection) => {
    const resolved = resolveSelection(snapshot, selection)
    return stackWithTop(stackById.get(resolved.id) ?? [], selectionRange(resolved))
  })

  return { selections: normalized, stacks: settledStacks }
}

const rangesFromShrinkState = (
  options: TreeSitterSelectionCommandOptions,
  selected: readonly TreeSitterSelectionRange[],
): readonly TreeSitterSelectionRange[] | null => {
  if (!options.state) return null
  if (options.state.snapshotVersion !== options.snapshotVersion) return null

  if (options.state.stacks.length !== selected.length) return null

  const ranges = options.state.stacks.map((stack, index) => {
    const top = stack.at(-1)
    const current = selected[index]
    if (!top || !current || !rangesEqual(top, current)) return undefined
    return stack.at(-2) ?? top
  })
  if (ranges.some((range) => !range)) return null
  return ranges as readonly TreeSitterSelectionRange[]
}

const selectionRange = (selection: ResolvedSelection): TreeSitterSelectionRange => ({
  startIndex: selection.startOffset,
  endIndex: selection.endOffset,
})

const stackWithTop = (
  stack: readonly TreeSitterSelectionRange[],
  range: TreeSitterSelectionRange,
): readonly TreeSitterSelectionRange[] => {
  const top = stack.at(-1)
  if (top && rangesEqual(top, range)) return stack
  if (stack.length === 0) return [range]
  return [...stack.slice(0, -1), range]
}

const stackForSelection = (
  options: TreeSitterSelectionCommandOptions,
  index: number,
  selected: TreeSitterSelectionRange | undefined,
): readonly TreeSitterSelectionRange[] => {
  if (!selected) return []
  if (options.state?.snapshotVersion !== options.snapshotVersion) return [selected]

  const stack = options.state.stacks[index]
  const top = stack?.at(-1)
  return stack && top && rangesEqual(top, selected) ? stack : [selected]
}

const rangesEqual = (left: TreeSitterSelectionRange, right: TreeSitterSelectionRange): boolean =>
  left.startIndex === right.startIndex && left.endIndex === right.endIndex
