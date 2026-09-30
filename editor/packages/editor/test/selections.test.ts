import { detectPlatform } from '@tanstack/hotkeys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '../src/editor'
import {
  createDocumentSession,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from '../src/public/document'
import { setHighlightRegistry } from '../src/public/testing'
import {
  createAnchorSelection,
  createSelectionSet,
  normalizeSelectionSet,
  resolveSelection,
  SelectionGoal,
} from '../src/selections'
import {
  applyTextToSelections,
  backspaceSelections,
  deleteSelections,
} from '../src/documentSelectionEdits'
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from '../src/history'

const backspaceEditReads = vi.hoisted(() => ({ coordinates: 0, enabled: false }))

vi.mock('@singapore-editor/textbuffer/internal/edits', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@singapore-editor/textbuffer/internal/edits')>()
  return {
    ...actual,
    applyBatchToPieceTable: (
      ...args: Parameters<typeof actual.applyBatchToPieceTable>
    ): ReturnType<typeof actual.applyBatchToPieceTable> => {
      const result = actual.applyBatchToPieceTable(...args)
      if (!backspaceEditReads.enabled) return result

      for (const edit of args[1]) countEditCoordinates(edit)
      return result
    },
  }
})

function countEditCoordinates(edit: { readonly from: number; readonly to: number }): void {
  const from = edit.from
  const to = edit.to
  Object.defineProperties(edit, {
    from: {
      configurable: true,
      enumerable: true,
      get: () => {
        backspaceEditReads.coordinates += 1
        return from
      },
    },
    to: {
      configurable: true,
      enumerable: true,
      get: () => {
        backspaceEditReads.coordinates += 1
        return to
      },
    },
  })
}

function countSeparatedBackspaceEditReads(cursorCount: number): number {
  const snapshot = createPieceTableSnapshot('a '.repeat(cursorCount))
  const selections = Array.from({ length: cursorCount }, (_value, index) =>
    createAnchorSelection(snapshot, index * 2 + 1),
  )
  backspaceEditReads.coordinates = 0
  backspaceEditReads.enabled = true
  try {
    const result = backspaceSelections(snapshot, createSelectionSet(selections))
    expect(result.edits).toHaveLength(cursorCount)
    expect(result.selections.selections).toHaveLength(cursorCount)
    return backspaceEditReads.coordinates
  } finally {
    backspaceEditReads.enabled = false
  }
}

function affinityBackspaceSelectionSet(
  snapshot: Parameters<typeof createAnchorSelection>[0],
  affinities: readonly ('before' | 'after')[],
) {
  return createSelectionSet(
    affinities.map((affinity) =>
      createAnchorSelection(snapshot, 2, 2, {
        affinity,
        goal: SelectionGoal.horizontal(affinity === 'before' ? 11 : 22),
        id: affinity,
      }),
    ),
  )
}

function resolvedBackspaceStates(result: ReturnType<typeof backspaceSelections>) {
  return result.selections.selections.map((selection) => {
    const resolved = resolveSelection(result.snapshot, selection)
    return {
      affinity: resolved.affinity,
      goal: resolved.goal,
      id: resolved.id,
      offset: resolved.headOffset,
    }
  })
}

describe('selections', () => {
  it('creates anchor-backed selections with resolved anchor and head offsets', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const selection = createAnchorSelection(snapshot, 4, 2, {
      id: 'selection-a',
      goal: SelectionGoal.horizontal(24.5),
    })
    const resolved = resolveSelection(snapshot, selection)

    expect(resolved).toMatchObject({
      id: 'selection-a',
      startOffset: 2,
      endOffset: 4,
      anchorOffset: 4,
      headOffset: 2,
      reversed: true,
      collapsed: false,
      goal: { kind: 'horizontal', x: 24.5 },
      affinity: 'after',
      liveness: 'live',
    })
  })

  it('keeps affinity in the selection identity at an ambiguous offset', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const before = createAnchorSelection(snapshot, 1, 1, { affinity: 'before' })
    const after = createAnchorSelection(snapshot, 1, 1, { affinity: 'after' })

    expect(before.id).not.toBe(after.id)
    expect(resolveSelection(snapshot, before).affinity).toBe('before')
    expect(resolveSelection(snapshot, after).affinity).toBe('after')
  })

  it('keeps opposite affinities apart through multi-cursor normalization', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const normalized = normalizeSelectionSet(
      snapshot,
      createSelectionSet([
        createAnchorSelection(snapshot, 1, 1, { id: 'after', affinity: 'after' }),
        createAnchorSelection(snapshot, 1, 1, { id: 'before', affinity: 'before' }),
      ]),
    )

    expect(normalized.selections).toHaveLength(2)
    expect(
      normalized.selections.map((selection) => resolveSelection(snapshot, selection).affinity),
    ).toEqual(['before', 'after'])
  })

  it('rechecks deferred opposite-affinity carets after a touching range absorbs one', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const set = {
      selections: [
        createAnchorSelection(snapshot, 1, 1, { id: 'before', affinity: 'before' }),
        createAnchorSelection(snapshot, 1, 1, { id: 'after', affinity: 'after' }),
        createAnchorSelection(snapshot, 1, 2, { id: 'range' }),
      ],
      lastAddedIndex: 2,
      normalized: false as const,
    }

    const normalized = normalizeSelectionSet(snapshot, set)
    expect(normalized.selections).toHaveLength(1)
    expect(resolveSelection(snapshot, normalized.selections[0]!)).toMatchObject({
      id: 'range',
      startOffset: 1,
      endOffset: 2,
    })

    const result = applyTextToSelections(snapshot, set, 'X')
    expect(result.edits).toEqual([{ from: 1, to: 2, text: 'X' }])
    expect(materializePieceTableFullText(result.snapshot)).toBe('aXc')
  })

  it('sorts selections and keeps non-empty ranges that only touch apart', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 4, 6, { id: 'b' }),
      createAnchorSelection(snapshot, 1, 3, { id: 'a', goal: SelectionGoal.horizontal(12) }),
      createAnchorSelection(snapshot, 3, 4, { id: 'touching' }),
    ])
    const normalized = normalizeSelectionSet(snapshot, set)

    expect(normalized.normalized).toBe(true)
    expect(
      normalized.selections.map((selection) => resolveSelection(snapshot, selection)),
    ).toMatchObject([
      { id: 'a', startOffset: 1, endOffset: 3 },
      { id: 'touching', startOffset: 3, endOffset: 4 },
      { id: 'b', startOffset: 4, endOffset: 6 },
    ])
  })

  it('absorbs a collapsed cursor that touches its neighbour', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 3, { id: 'range' }),
      createAnchorSelection(snapshot, 3, 3, { id: 'cursor' }),
    ])
    const normalized = normalizeSelectionSet(snapshot, set)

    expect(normalized.selections).toHaveLength(1)
    expect(resolveSelection(snapshot, normalized.selections[0]!)).toMatchObject({
      startOffset: 1,
      endOffset: 3,
    })
  })

  it('merges overlapping ranges behind the last-added direction, goal, and affinity', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 4, { id: 'first' }),
      createAnchorSelection(snapshot, 5, 2, {
        id: 'last',
        goal: SelectionGoal.horizontal(12),
        affinity: 'before',
      }),
    ])
    const normalized = normalizeSelectionSet(snapshot, set)

    expect(normalized.selections).toHaveLength(1)
    expect(normalized.lastAddedIndex).toBe(0)
    expect(resolveSelection(snapshot, normalized.selections[0]!)).toMatchObject({
      startOffset: 1,
      endOffset: 5,
      anchorOffset: 5,
      headOffset: 1,
      reversed: true,
      goal: { kind: 'horizontal', x: 12 },
      affinity: 'before',
    })
  })

  it('tracks the last-added selection across the sort', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const before = createSelectionSet([
      createAnchorSelection(snapshot, 4, 4, { id: 'existing' }),
      createAnchorSelection(snapshot, 1, 1, { id: 'added' }),
    ])
    const after = createSelectionSet([
      createAnchorSelection(snapshot, 1, 1, { id: 'existing' }),
      createAnchorSelection(snapshot, 4, 4, { id: 'added' }),
    ])

    expect(normalizeSelectionSet(snapshot, before).lastAddedIndex).toBe(0)
    expect(normalizeSelectionSet(snapshot, after).lastAddedIndex).toBe(1)
  })

  it('renormalizes stale normalized selections against a newer snapshot', () => {
    const snapshot = createPieceTableSnapshot('abcd')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 2, { id: 'first' }),
      createAnchorSelection(snapshot, 3, 4, { id: 'second' }),
    ])
    const normalized = normalizeSelectionSet(snapshot, set)
    const edited = deleteFromPieceTable(snapshot, 2, 1)

    const result = applyTextToSelections(edited, normalized, 'X')

    expect(materializePieceTableFullText(result.snapshot)).toBe('aXX')
    expect(result.edits).toEqual([
      { from: 1, to: 2, text: 'X' },
      { from: 2, to: 3, text: 'X' },
    ])
  })

  it('applies multi-selection text edits against the original snapshot', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 2),
      createAnchorSelection(snapshot, 4, 6),
    ])

    const result = applyTextToSelections(snapshot, set, 'X')

    expect(materializePieceTableFullText(result.snapshot)).toBe('aXcdX')
    expect(result.edits).toEqual([
      { from: 1, to: 2, text: 'X' },
      { from: 4, to: 6, text: 'X' },
    ])
    expect(
      result.selections.selections.map((selection) => resolveSelection(result.snapshot, selection)),
    ).toMatchObject([
      { startOffset: 2, endOffset: 2 },
      { startOffset: 5, endOffset: 5 },
    ])
  })

  it('keeps collapsed cursors after inserted text for repeated typing', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([createAnchorSelection(snapshot, 3)], true)

    const first = applyTextToSelections(snapshot, set, 'X')
    const second = applyTextToSelections(first.snapshot, first.selections, 'Y')

    expect(materializePieceTableFullText(second.snapshot)).toBe('abcXYdef')
    expect(resolveSelection(second.snapshot, second.selections.selections[0]!)).toMatchObject({
      startOffset: 5,
      endOffset: 5,
    })
  })

  it('carries affinity through edit-created piece-table anchors', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const set = createSelectionSet([createAnchorSelection(snapshot, 1, 1, { affinity: 'before' })])

    const result = applyTextToSelections(snapshot, set, 'X')

    expect(resolveSelection(result.snapshot, result.selections.selections[0]!).affinity).toBe(
      'before',
    )
  })

  it('backspaces collapsed cursors by code point', () => {
    const snapshot = createPieceTableSnapshot('a😀b')
    const set = createSelectionSet([createAnchorSelection(snapshot, 3)])

    const result = backspaceSelections(snapshot, set)

    expect(materializePieceTableFullText(result.snapshot)).toBe('ab')
    expect(result.edits).toEqual([{ from: 1, to: 3, text: '' }])
    expect(resolveSelection(result.snapshot, result.selections.selections[0]!)).toMatchObject({
      startOffset: 1,
      endOffset: 1,
    })
  })

  it('projects separated multi-cursor backspaces with linearly bounded edit reads', () => {
    const smallCount = 128
    const largeCount = 512
    const smallReads = countSeparatedBackspaceEditReads(smallCount)
    const largeReads = countSeparatedBackspaceEditReads(largeCount)

    expect(smallReads).toBeGreaterThan(0)
    expect(smallReads).toBeLessThanOrEqual(smallCount * 8)
    expect(largeReads).toBeLessThanOrEqual(largeCount * 8)
    expect(largeReads).toBeLessThanOrEqual(smallReads * 4 + 16)
  })

  it('keeps a backspace caret before text later inserted at its offset', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const set = createSelectionSet([createAnchorSelection(snapshot, 2)])

    const result = backspaceSelections(snapshot, set)
    const inserted = insertIntoPieceTable(result.snapshot, 1, 'X')

    expect(materializePieceTableFullText(inserted)).toBe('aXc')
    expect(resolveSelection(inserted, result.selections.selections[0]!)).toMatchObject({
      headOffset: 1,
      startOffset: 1,
    })
  })

  it('does not copy range-start bias when deleted text collapses a selection', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const selection = createAnchorSelection(snapshot, 1, 2)
    const deleted = deleteFromPieceTable(snapshot, 1, 2)
    const normalized = normalizeSelectionSet(deleted, createSelectionSet([selection]))
    const inserted = insertIntoPieceTable(deleted, 1, 'X')

    expect(resolveSelection(inserted, normalized.selections[0]!)).toMatchObject({
      headOffset: 2,
      startOffset: 2,
    })
  })

  it('preserves cursors on no-op backspace at document start', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const set = createSelectionSet([createAnchorSelection(snapshot, 0)])

    const result = backspaceSelections(snapshot, set)

    expect(result.snapshot).toBe(snapshot)
    expect(result.edits).toEqual([])
    expect(result.selections.selections).toHaveLength(1)
    expect(resolveSelection(result.snapshot, result.selections.selections[0]!)).toMatchObject({
      startOffset: 0,
      endOffset: 0,
    })
  })

  it('keeps affinity-distinct backspace carets and last-added identity in either order', () => {
    const affinityOrders = [
      ['before', 'after'],
      ['after', 'before'],
    ] as const

    for (const affinities of affinityOrders) {
      const snapshot = createPieceTableSnapshot('abc')
      const set = affinityBackspaceSelectionSet(snapshot, affinities)
      const normalized = normalizeSelectionSet(snapshot, set)
      const lastAddedId = normalized.selections[normalized.lastAddedIndex ?? 0]?.id

      const result = backspaceSelections(snapshot, set)

      expect(materializePieceTableFullText(result.snapshot)).toBe('ac')
      expect(result.edits).toEqual([{ from: 1, text: '', to: 2 }])
      expect(resolvedBackspaceStates(result)).toEqual([
        {
          affinity: 'before',
          goal: SelectionGoal.horizontal(11),
          id: 'before',
          offset: 1,
        },
        {
          affinity: 'after',
          goal: SelectionGoal.horizontal(22),
          id: 'after',
          offset: 1,
        },
      ])
      expect(result.selections.selections[result.selections.lastAddedIndex ?? 0]?.id).toBe(
        lastAddedId,
      )
    }
  })

  it('retains a document-start caret while another caret backspaces', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 3, 3, { affinity: 'after', id: 'moving' }),
      createAnchorSelection(snapshot, 0, 0, { affinity: 'before', id: 'stationary' }),
    ])

    const result = backspaceSelections(snapshot, set)

    expect(materializePieceTableFullText(result.snapshot)).toBe('ab')
    expect(result.edits).toEqual([{ from: 2, text: '', to: 3 }])
    expect(
      result.selections.selections.map((selection) => {
        const resolved = resolveSelection(result.snapshot, selection)
        return { affinity: resolved.affinity, id: resolved.id, offset: resolved.headOffset }
      }),
    ).toEqual([
      { affinity: 'before', id: 'stationary', offset: 0 },
      { affinity: 'after', id: 'moving', offset: 2 },
    ])
    expect(result.selections.selections[result.selections.lastAddedIndex ?? 0]?.id).toBe(
      'stationary',
    )
  })

  it('coalesces overlapping indentation deletes without dropping their carets', () => {
    const snapshot = createPieceTableSnapshot('    x')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 2, 2, { affinity: 'before', id: 'partial' }),
      createAnchorSelection(snapshot, 4, 4, { affinity: 'after', id: 'full' }),
    ])

    const result = backspaceSelections(snapshot, set, 4)

    expect(materializePieceTableFullText(result.snapshot)).toBe('x')
    expect(result.edits).toEqual([{ from: 0, text: '', to: 4 }])
    expect(
      result.selections.selections.map((selection) => {
        const resolved = resolveSelection(result.snapshot, selection)
        return { affinity: resolved.affinity, id: resolved.id, offset: resolved.headOffset }
      }),
    ).toEqual([
      { affinity: 'before', id: 'partial', offset: 0 },
      { affinity: 'after', id: 'full', offset: 0 },
    ])
  })

  it('preserves selection identity when indentation backspace reorders target ranges', () => {
    const snapshot = createPieceTableSnapshot('    x')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 2, 3, { affinity: 'before', id: 'range' }),
      createAnchorSelection(snapshot, 4, 4, { affinity: 'after', id: 'indent' }),
    ])

    const result = backspaceSelections(snapshot, set, 4)

    expect(materializePieceTableFullText(result.snapshot)).toBe('x')
    expect(result.edits).toEqual([{ from: 0, text: '', to: 4 }])
    expect(resolvedBackspaceStates(result)).toEqual([
      { affinity: 'before', goal: SelectionGoal.none(), id: 'range', offset: 0 },
      { affinity: 'after', goal: SelectionGoal.none(), id: 'indent', offset: 0 },
    ])
    expect(result.selections.selections[result.selections.lastAddedIndex ?? 0]?.id).toBe('indent')
  })

  it('deletes selected ranges without deleting collapsed cursors', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 3),
      createAnchorSelection(snapshot, 5),
    ])

    const result = deleteSelections(snapshot, set)

    expect(materializePieceTableFullText(result.snapshot)).toBe('adef')
    expect(result.edits).toEqual([{ from: 1, to: 3, text: '' }])
    expect(resolveSelection(result.snapshot, result.selections.selections[0]!)).toMatchObject({
      startOffset: 1,
      endOffset: 1,
    })
  })

  it('deletes selected ranges before backspacing collapsed cursors', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const set = createSelectionSet([
      createAnchorSelection(snapshot, 1, 3),
      createAnchorSelection(snapshot, 5),
    ])

    const result = backspaceSelections(snapshot, set)

    expect(materializePieceTableFullText(result.snapshot)).toBe('adf')
    expect(result.edits).toEqual([
      { from: 1, to: 3, text: '' },
      { from: 4, to: 5, text: '' },
    ])
  })

  it('keeps snapshots and selections together in undo and redo history', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const selections = createSelectionSet([createAnchorSelection(snapshot, 3)], true)
    const history = createEditorHistory(snapshot, selections)
    const edit = applyTextToSelections(snapshot, selections, '!')
    const committed = commitEditorHistory(history, edit.snapshot, edit.selections)
    const undone = undoEditorHistory(committed)
    const redone = redoEditorHistory(undone)

    expect(materializePieceTableFullText(committed.current)).toBe('abc!')
    expect(committed.undo).not.toBeNull()
    expect(materializePieceTableFullText(undone.current)).toBe('abc')
    expect(undone.undo).toBeNull()
    expect(undone.redo).not.toBeNull()
    expect(materializePieceTableFullText(redone.current)).toBe('abc!')
    expect(redone.undo).not.toBeNull()
    expect(redone.redo).toBeNull()
    expect(redone.selections.selections).toHaveLength(1)
  })
})

// Which cursor counts as the last-added one is only observable through the gestures that read it —
// collapsing the run onto it and growing the run from it — so every case here goes through a
// keystroke or a command rather than through the set.
describe('the cursor a multi-cursor gesture continues from', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    // @ts-expect-error — happy-dom provides no Highlight constructor.
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { defaultText: '' })
    editor.focus()
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('survives typing over every cursor in the run', () => {
    const session = createDocumentSession('foo\nfoo\nfoo')
    session.setSelection(4, 7)
    editor.attachSession(session)

    pressEditorKey('d', primaryModifier())
    pressEditorKey('d', primaryModifier())
    editorRoot().dispatchEvent(insertTextEvent('X'))
    expect(editor.dispatchCommand('clearSecondarySelections')).toBe(true)

    // The second Mod+D wrapped, so the cursor the user ended on is the one that sorts first, and
    // the edit lays all three back down in that same order.
    expect(editor.materializeFullText()).toBe('X\nX\nX')
    expect(cursorRanges(session)).toEqual([{ anchor: 1, head: 1 }])
  })

  it('survives an edit the host makes underneath the run', () => {
    const session = createDocumentSession('foo\nfoo\nfoo')
    session.setSelection(1)
    editor.attachSession(session)

    pressEditorKey('d', primaryModifier())
    pressEditorKey('d', primaryModifier())
    editor.edit([{ from: 11, to: 11, text: '\nfoo' }])
    expect(editor.dispatchCommand('clearSecondarySelections')).toBe(true)

    expect(cursorRanges(session)).toEqual([{ anchor: 4, head: 7 }])
  })

  it('carries over to the survivor when two cursors collide', () => {
    const session = createDocumentSession('abcdefghij')
    session.setSelection(0)
    session.addSelection(4)
    session.addSelection(6)
    editor.attachSession(session)

    pressEditorKey('ArrowRight', { shiftKey: true })
    pressEditorKey('ArrowRight', { shiftKey: true })
    pressEditorKey('ArrowRight', { shiftKey: true })

    expect(cursorRanges(session)).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 4, head: 9 },
    ])

    expect(editor.dispatchCommand('clearSecondarySelections')).toBe(true)

    expect(cursorRanges(session)).toEqual([{ anchor: 4, head: 9 }])
  })

  // Escape is bound to closing find, which is the only key that reaches this at all. An editor
  // running without a find plugin has nothing registered under that command, and the reader who
  // built the run from the keyboard still has to be able to put it away with the same key.
  it('collapses the run on Escape with no find installed', () => {
    const session = createDocumentSession('foo\nfoo\nfoo')
    session.setSelection(1)
    editor.attachSession(session)

    pressEditorKey('d', primaryModifier())
    pressEditorKey('d', primaryModifier())
    expect(cursorRanges(session)).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 4, head: 7 },
    ])

    pressEditorKey('Escape')

    expect(cursorRanges(session)).toEqual([{ anchor: 4, head: 7 }])
  })

  it('is scrolled back into view when the run collapses onto it', () => {
    const rows = Array.from({ length: 60 }, (_, row) => `row ${row}`)
    const session = createDocumentSession(rows.join('\n'))
    session.setSelection(0)
    session.addSelection(session.getSnapshot().length)
    editor.attachSession(session)
    mockEditorViewport(editorRoot(), 80, 40)
    editorRoot().scrollTop = 0

    expect(editor.dispatchCommand('clearSecondarySelections')).toBe(true)

    expect(editorRoot().scrollTop).toBeGreaterThan(0)
  })

  it('stops matching whole words once the caret run it started from is over', () => {
    const session = createDocumentSession('id hidden width')
    session.setSelection(1)
    editor.attachSession(session)

    // Out of the word the first run selected, then over the fragment inside the next word.
    pressEditorKey('d', primaryModifier())
    pressEditorKey('ArrowRight')
    pressEditorKey('ArrowRight')
    pressEditorKey('ArrowRight')
    pressEditorKey('ArrowRight', { shiftKey: true })
    pressEditorKey('ArrowRight', { shiftKey: true })
    pressEditorKey('d', primaryModifier())

    // The fragment inside `hidden` is not a word the user picked out, so the next match is the
    // fragment inside `width` rather than the standalone word the earlier run had wrapped back to.
    expect(cursorRanges(session)).toEqual([
      { anchor: 4, head: 6 },
      { anchor: 11, head: 13 },
    ])
  })
})

// happy-dom doesn't provide the Highlight constructor, so we polyfill it.
class MockHighlight extends Set<Range> {}

const mockRegistry = {
  set: () => undefined,
  delete: () => true,
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function pressEditorKey(key: string, init: KeyboardEventInit = {}): void {
  editorRoot().dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init }),
  )
}

function insertTextEvent(data: string): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data,
    inputType: 'insertText',
  })
}

function primaryModifier(): KeyboardEventInit {
  return detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
}

/** A viewport shorter than the document, so what the editor reveals has somewhere to scroll to. */
function mockEditorViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 4000 })
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}

function cursorRanges(session: ReturnType<typeof createDocumentSession>): readonly {
  readonly anchor: number
  readonly head: number
}[] {
  return session.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(session.getSnapshot(), selection)
    return { anchor: resolved.anchorOffset, head: resolved.headOffset }
  })
}
