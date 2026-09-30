import { describe, expect, it } from 'vitest'
import {
  createAnchorSelection,
  createPieceTableSnapshot,
  createStringTextSnapshot,
  createSelectionSet,
  resolveSelection,
} from '@singapore-editor/core/document'
import type { EditorPlugin, EditorPluginContext } from '@singapore-editor/core/extensions'
import { createTestPluginContext } from '@singapore-editor/core/testing'
import type { FoldRange } from '@singapore-editor/core/syntax'
import { createTreeSitterLanguagePlugin } from '../src/index'
import {
  expandTreeSitterSelection,
  selectTreeSitterToken,
  shrinkTreeSitterSelection,
} from '../src/structuralSelection'
import type { TreeSitterSelectionPayload } from '../src/treeSitter/workerClient'
import type { TreeSitterSelectionRange, TreeSitterSelectionResult } from '../src/treeSitter/types'

const TEXT = 'const answer = 1;\n'

// Stands in for the node chain a grammar would report over `const answer = 1;`.
const NODES: readonly TreeSitterSelectionRange[] = [
  { startIndex: 6, endIndex: 12 },
  { startIndex: 6, endIndex: 16 },
  { startIndex: 0, endIndex: 17 },
]

const backend = {
  select: (payload: TreeSitterSelectionPayload): Promise<TreeSitterSelectionResult> =>
    Promise.resolve({
      documentId: payload.documentId,
      languageId: payload.languageId,
      snapshotVersion: payload.snapshotVersion,
      status: 'ok',
      ranges: payload.ranges.map((range) =>
        payload.action === 'selectToken' ? NODES[0]! : enclosingNode(range),
      ),
    }),
}

describe('tree-sitter structural selection', () => {
  it('keeps the direction and affinity the selection was made with', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const selections = createSelectionSet([
      createAnchorSelection(snapshot, 12, 6, { affinity: 'before' }),
    ])

    const expanded = await expandTreeSitterSelection({ ...request(snapshot), selections })

    expect(resolveSelection(snapshot, expanded.selections.selections[0]!)).toMatchObject({
      affinity: 'before',
      anchorOffset: 16,
      headOffset: 6,
      reversed: true,
    })

    const shrunk = shrinkTreeSitterSelection({
      ...request(snapshot),
      selections: expanded.selections,
      state: expanded.state,
    })

    expect(resolveSelection(snapshot, shrunk.selections.selections[0]!)).toMatchObject({
      affinity: 'before',
      anchorOffset: 12,
      headOffset: 6,
      reversed: true,
    })
  })

  it('refuses to shrink into a stack the selection has left', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const expanded = await climbFrom(snapshot, 7)
    const moved = createSelectionSet([createAnchorSelection(snapshot, 2)])

    const shrunk = shrinkTreeSitterSelection({
      ...request(snapshot),
      selections: moved,
      state: expanded.state,
    })

    expect(shrunk.status).toBe('stale')
    expect(shrunk.selections).toBe(moved)
  })

  // Stacks are held in selection order, so a cursor that appeared since the expand would otherwise
  // shift the rungs one cursor over and drop the selections no stack lines up with.
  it('refuses to shrink after the cursor count changed', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const expanded = await climbFrom(snapshot, 7)
    const extraCursor = createSelectionSet([
      ...expanded.selections.selections,
      createAnchorSelection(snapshot, TEXT.length - 1),
    ])

    const shrunk = shrinkTreeSitterSelection({
      ...request(snapshot),
      selections: extraCursor,
      state: expanded.state,
    })

    expect(shrunk.status).toBe('stale')
    expect(shrunk.selections).toBe(extraCursor)
  })

  it('starts a new stack when expanding from somewhere else', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const expanded = await climbFrom(snapshot, 7)
    const moved = createSelectionSet([createAnchorSelection(snapshot, 2)])

    const again = await expandTreeSitterSelection({
      ...request(snapshot),
      selections: moved,
      state: expanded.state,
    })
    const shrunk = shrinkTreeSitterSelection({
      ...request(snapshot),
      selections: again.selections,
      state: again.state,
    })

    expect(resolveSelection(snapshot, shrunk.selections.selections[0]!)).toMatchObject({
      startOffset: 2,
      endOffset: 2,
    })
  })

  it('normalizes request order before pairing worker ranges with source metadata', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const later = createAnchorSelection(snapshot, 16, 14, {
      affinity: 'before',
      goal: { kind: 'horizontal', x: 31 },
      id: 'later',
    })
    const earlier = createAnchorSelection(snapshot, 2, 4, { id: 'earlier' })
    const selections = {
      selections: [later, earlier],
      lastAddedIndex: 0,
      normalized: false as const,
    }
    const payloads: TreeSitterSelectionPayload[] = []
    const orderedBackend = selectionBackend(
      [
        { startIndex: 0, endIndex: 5 },
        { startIndex: 12, endIndex: 17 },
      ],
      payloads,
    )

    const selected = await selectTreeSitterToken({
      ...request(snapshot),
      backend: orderedBackend,
      selections,
    })

    expect(payloads[0]?.ranges).toEqual([
      { startIndex: 2, endIndex: 4 },
      { startIndex: 14, endIndex: 16 },
    ])
    expect(
      selected.selections.selections.map((selection) => resolveSelection(snapshot, selection)),
    ).toMatchObject([
      {
        affinity: 'after',
        anchorOffset: 0,
        goal: { kind: 'none' },
        headOffset: 5,
        id: 'earlier',
      },
      {
        affinity: 'before',
        anchorOffset: 17,
        goal: { kind: 'none' },
        headOffset: 12,
        id: 'later',
      },
    ])
    expect(lastAddedId(selected.selections)).toBe('later')
  })

  it('treats a worker result count mismatch as stale', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const selections = createSelectionSet([
      createAnchorSelection(snapshot, 2, 4),
      createAnchorSelection(snapshot, 14, 16),
    ])
    const mismatchedBackend = selectionBackend([{ startIndex: 0, endIndex: 5 }])

    const selected = await selectTreeSitterToken({
      ...request(snapshot),
      backend: mismatchedBackend,
      selections,
    })

    expect(selected.status).toBe('stale')
    expect(selected.selections).toBe(selections)
    expect(selected.state.stacks).toHaveLength(2)
  })

  it('aligns one survivor stack when backend ranges converge', async () => {
    const snapshot = createPieceTableSnapshot(TEXT)
    const selections = createSelectionSet([
      createAnchorSelection(snapshot, 7, 8, { id: 'first' }),
      createAnchorSelection(snapshot, 16, 14, {
        affinity: 'before',
        id: 'last',
      }),
    ])
    const convergingBackend = selectionBackend([
      { startIndex: 0, endIndex: 12 },
      { startIndex: 6, endIndex: 17 },
    ])

    const expanded = await expandTreeSitterSelection({
      ...request(snapshot),
      backend: convergingBackend,
      selections,
    })

    expect(expanded.selections.selections).toHaveLength(1)
    expect(resolveSelection(snapshot, expanded.selections.selections[0]!)).toMatchObject({
      affinity: 'before',
      anchorOffset: 17,
      headOffset: 0,
      id: 'last',
    })
    expect(expanded.state.stacks).toEqual([
      [
        { startIndex: 14, endIndex: 16 },
        { startIndex: 0, endIndex: 17 },
      ],
    ])

    const shrunk = shrinkTreeSitterSelection({
      ...request(snapshot),
      backend: convergingBackend,
      selections: expanded.selections,
      state: expanded.state,
    })

    expect(shrunk.status).toBe('ok')
    expect(shrunk.state.stacks).toEqual([[{ startIndex: 14, endIndex: 16 }]])
    expect(resolveSelection(snapshot, shrunk.selections.selections[0]!)).toMatchObject({
      affinity: 'before',
      anchorOffset: 16,
      headOffset: 14,
      id: 'last',
    })
  })
})

describe('tree-sitter selection range contribution', () => {
  it('hands the editor ladder the nesting the parse published', () => {
    const host = recordingPluginContext()

    const contributed = createTreeSitterLanguagePlugin([]).activate(host.context)

    expect(host.selectionRangeProviders).toHaveLength(1)
    expect(host.selectionRangeProviders[0]?.(ladderContext(FOLDS))).toEqual([
      { start: 0, end: 17 },
      { start: 6, end: 16 },
    ])

    disposeContributions(contributed)
    expect(host.selectionRangeProviders).toEqual([])
  })
})

const FOLDS: readonly FoldRange[] = [
  { startIndex: 0, endIndex: 17, startLine: 0, endLine: 0, type: 'statement' },
  { startIndex: 6, endIndex: 16, startLine: 0, endLine: 0, type: 'declarator' },
]

type SelectionRangeProvider = Parameters<
  NonNullable<EditorPluginContext['registerSelectionRangeProvider']>
>[0]

function ladderContext(folds: readonly FoldRange[]): Parameters<SelectionRangeProvider>[0] {
  return {
    textSnapshot: createStringTextSnapshot(TEXT),
    languageId: 'typescript',
    offset: 7,
    selection: { start: 7, end: 7 },
    folds,
  }
}

function recordingPluginContext(): {
  context: EditorPluginContext
  selectionRangeProviders: SelectionRangeProvider[]
} {
  const selectionRangeProviders: SelectionRangeProvider[] = []

  return {
    selectionRangeProviders,
    context: createTestPluginContext({
      registerSelectionRangeProvider: (provider) => {
        selectionRangeProviders.push(provider)
        return {
          dispose: () => {
            selectionRangeProviders.splice(selectionRangeProviders.indexOf(provider), 1)
          },
        }
      },
    }),
  }
}

function disposeContributions(contributed: ReturnType<EditorPlugin['activate']>): void {
  if (!contributed) return

  for (const disposable of Array.isArray(contributed) ? contributed : [contributed]) {
    disposable.dispose()
  }
}

type Snapshot = ReturnType<typeof createPieceTableSnapshot>

function request(snapshot: Snapshot) {
  return {
    backend,
    documentId: 'file.ts',
    runtimeSessionId: 'runtime-file.ts',
    languageId: 'typescript' as const,
    snapshotVersion: 1,
    snapshot,
  }
}

async function climbFrom(snapshot: Snapshot, offset: number) {
  const selections = createSelectionSet([createAnchorSelection(snapshot, offset)])
  const token = await selectTreeSitterToken({ ...request(snapshot), selections })

  return expandTreeSitterSelection({
    ...request(snapshot),
    selections: token.selections,
    state: token.state,
  })
}

function enclosingNode(range: TreeSitterSelectionRange): TreeSitterSelectionRange {
  const enclosing = NODES.find(
    (node) =>
      node.startIndex <= range.startIndex &&
      node.endIndex >= range.endIndex &&
      (node.startIndex !== range.startIndex || node.endIndex !== range.endIndex),
  )

  return enclosing ?? NODES[NODES.length - 1]!
}

function selectionBackend(
  ranges: readonly TreeSitterSelectionRange[],
  payloads: TreeSitterSelectionPayload[] = [],
) {
  return {
    select: (payload: TreeSitterSelectionPayload): Promise<TreeSitterSelectionResult> => {
      payloads.push(payload)
      return Promise.resolve({
        documentId: payload.documentId,
        languageId: payload.languageId,
        ranges,
        snapshotVersion: payload.snapshotVersion,
        status: 'ok',
      })
    },
  }
}

function lastAddedId(selections: ReturnType<typeof createSelectionSet>): string | undefined {
  return selections.selections[selections.lastAddedIndex ?? 0]?.id
}
