import { describe, expect, it, vi } from 'vitest'
import type { EditorCommandId } from '../src/editor/commands'
import type { EditorOptions, HighlightRegistry } from '../src/editor/types'
import {
  childContainingNode,
  childNodeIndex,
  elementBoundaryToTextOffset,
} from '../src/editor/domBoundary'
import { EditorFoldState } from '../src/editor/foldState'
import {
  FULL_DISPLAY_PROJECTION_INVALIDATION,
  NO_DISPLAY_PROJECTION_DISPOSAL,
  type EditorDisplayProjection,
} from '../src/editor/displayProjectionRegistry'
import {
  defaultEditorCommandPacks,
  defaultEditorKeyBindings,
  defaultEditorKeymapLayers,
  editorCommandPackForCommand,
  editorKeyBindings,
  editorKeymapLayersForBindings,
  editorKeymapLayersForCommandPacks,
  filterEditorKeymapLayersByCommandPacks,
  readonlySafeEditorCommandPacks,
} from '../src/editor/keymap'
import {
  foldMarkerFromRange,
  foldRangeKey,
  foldRangesEqual,
  projectSyntaxFoldsThroughEdit,
  rejectCrossingFoldRanges,
} from '../src/editor/folds'
import { mouseSelectionAutoScrollDelta } from '../src/editor/mouseSelection'
import { nextWordOffset, previousWordOffset } from '../src/textRanges'
import { lineRangeAtOffset, wordRangeAtOffset } from '../src/editor/textRanges'
import { appendTiming, eventStartMs, mergeChangeTimings } from '../src/editor/timing'
import { createDocumentSession, type DocumentSessionChange } from '../src/documentSession'
import {
  projectTokensThroughEdit,
  tokenProjectionLiveRangeStatus,
} from '../src/editor/tokenProjection'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { createStringTextSnapshot, type TextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { FoldRange } from '../src/syntax'
import type { EditorToken } from '../src/tokens'

describe('editor DOM boundary helpers', () => {
  it('maps element boundaries and child nodes to text positions', () => {
    const parent = document.createElement('div')
    const first = document.createElement('span')
    const second = document.createElement('span')
    const nested = document.createElement('strong')
    second.appendChild(nested)
    parent.append(first, second)

    expect(elementBoundaryToTextOffset(-1, 10)).toBe(0)
    expect(elementBoundaryToTextOffset(1, 10)).toBe(10)
    expect(childContainingNode(parent, nested)).toBe(second)
    expect(childNodeIndex(parent, second)).toBe(1)
  })
})

describe('editor fold helpers', () => {
  it('creates stable marker keys and compares fold ranges', () => {
    const fold = foldRange({ startIndex: 4, endIndex: 20, startLine: 1, endLine: 5 })

    expect(foldRangeKey(fold)).toBe('typescript:block:4:20')
    expect(foldMarkerFromRange(fold, true)).toMatchObject({
      key: 'typescript:block:4:20',
      startOffset: 4,
      endOffset: 20,
      collapsed: true,
    })
    expect(foldRangesEqual([fold], [{ ...fold }])).toBe(true)
    expect(foldRangesEqual([fold], [{ ...fold, endLine: 6 }])).toBe(false)
  })

  it('projects folds through edits that add a line', () => {
    const fold = foldRange({ startIndex: 10, endIndex: 30, startLine: 2, endLine: 6 })
    const projected = projectSyntaxFoldsThroughEdit(
      [fold],
      { from: 0, to: 0, text: 'a\n' },
      'function f() {\n  return 1;\n}\n',
    )

    expect(projected?.[0]).toMatchObject({
      startIndex: 12,
      endIndex: 32,
      startLine: 3,
      endLine: 7,
    })
  })

  it('projects folds through edits that stay on one line', () => {
    const fold = foldRange({ startIndex: 10, endIndex: 30, startLine: 2, endLine: 6 })
    const projected = projectSyntaxFoldsThroughEdit(
      [fold],
      { from: 0, to: 0, text: 'a' },
      'function f() {\n  return 1;\n}\n',
    )

    expect(projected?.[0]).toMatchObject({
      startIndex: 11,
      endIndex: 31,
      startLine: 2,
      endLine: 6,
    })
  })

  it('projects folds from snapshot ranges without materializing full text', () => {
    const fold = foldRange({ startIndex: 9, endIndex: 18, startLine: 3, endLine: 5 })
    const projected = projectSyntaxFoldsThroughEdit(
      [fold],
      { from: 0, to: 6, text: 'x' },
      lazyTextSnapshot('aa\nbb\ncc\ndd\nee\n'),
    )

    expect(projected?.[0]).toMatchObject({
      startIndex: 4,
      startLine: 1,
    })
  })

  it('accepts nested fold ranges while rejecting crossing ranges', () => {
    const outer = foldRange({
      startIndex: 0,
      endIndex: 40,
      startLine: 0,
      endLine: 4,
      type: 'outer',
    })
    const inner = foldRange({
      startIndex: 10,
      endIndex: 20,
      startLine: 1,
      endLine: 2,
      type: 'inner',
    })
    const crossing = foldRange({
      startIndex: 30,
      endIndex: 60,
      startLine: 3,
      endLine: 5,
      type: 'crossing',
    })
    const adjacent = foldRange({
      startIndex: 40,
      endIndex: 70,
      startLine: 4,
      endLine: 6,
      type: 'adjacent',
    })

    const result = rejectCrossingFoldRanges([inner, adjacent, crossing, outer])

    expect(result.folds).toEqual([outer, inner, adjacent])
    expect(result.rejected.map((rejection) => rejection.kind)).toEqual(['overlap'])
    expect(result.rejected.map((rejection) => rejection.fold.type)).toEqual(['crossing'])
    expect(result.rejected[0]?.previous?.type).toBe('outer')
  })

  it('rejects a range crossing a sibling nested inside the same parent', () => {
    const outer = foldRange({
      startIndex: 0,
      endIndex: 100,
      startLine: 0,
      endLine: 10,
      type: 'outer',
    })
    const sibling = foldRange({
      startIndex: 10,
      endIndex: 20,
      startLine: 1,
      endLine: 2,
      type: 'sibling',
    })
    const crossingSibling = foldRange({
      startIndex: 15,
      endIndex: 30,
      startLine: 1,
      endLine: 3,
      type: 'crossing-sibling',
    })

    const result = rejectCrossingFoldRanges([outer, sibling, crossingSibling])

    expect(result.folds).toEqual([outer, sibling])
    expect(result.rejected.map((rejection) => rejection.fold.type)).toEqual(['crossing-sibling'])
    expect(result.rejected[0]?.previous?.type).toBe('sibling')
  })
})

describe('EditorFoldState', () => {
  it('syncs markers and re-keys a collapsed region onto a reparsed fold', () => {
    const setFoldState = vi.fn()
    const getCaretRows = vi.fn(() => [])
    const snapshot = createPieceTableSnapshot('function f() {\n  return 1;\n}\n')
    const state = new EditorFoldState(
      { setFoldState, setIndexedFoldState: vi.fn() },
      () => snapshot,
      getCaretRows,
    )
    const fold = foldRange({ startIndex: 0, endIndex: 28, startLine: 0, endLine: 2 })

    state.setFoldProjections([foldProjection([fold])])
    expect(getCaretRows).not.toHaveBeenCalled()
    state.toggle(foldMarkerFromRange(fold, false))
    const reparsedFold = { ...fold, startIndex: 13, type: 'statement_block' }
    state.setFoldProjections([foldProjection([reparsedFold])])
    expect(getCaretRows).toHaveBeenCalledTimes(1)

    const [markers, foldMap] = setFoldState.mock.lastCall ?? []
    expect(markers?.[0]).toMatchObject({ key: foldRangeKey(reparsedFold), collapsed: true })
    expect(foldMap).not.toBeNull()
  })

  it('keeps markers for nested folds and collapses the outer range when both are folded', () => {
    const setFoldState = vi.fn()
    const snapshot = createPieceTableSnapshot('function f() {\n  if (x) {\n    y();\n  }\n}\n')
    const state = new EditorFoldState(
      { setFoldState, setIndexedFoldState: vi.fn() },
      () => snapshot,
      () => [],
    )
    const outer = foldRange({ startIndex: 14, endIndex: 40, startLine: 0, endLine: 4 })
    const inner = foldRange({ startIndex: 25, endIndex: 38, startLine: 1, endLine: 3 })

    state.setFoldProjections([foldProjection([outer, inner])])

    const [markers] = setFoldState.mock.lastCall ?? []
    expect(markers).toHaveLength(2)
    expect(markers?.map((marker: { startRow: number }) => marker.startRow)).toEqual([0, 1])

    state.foldAll()

    const [foldedMarkers, foldMap] = setFoldState.mock.lastCall ?? []
    expect(foldedMarkers?.every((marker: { collapsed: boolean }) => marker.collapsed)).toBe(true)
    expect(foldMap?.ranges).toHaveLength(1)
    expect(foldMap?.ranges[0]).toMatchObject({ startOffset: 14, endOffset: 40 })
  })
})

function foldProjection(folds: readonly FoldRange[]): EditorDisplayProjection<'folds'> {
  return {
    kind: 'folds',
    owner: 'test.folds',
    source: { documentId: null, documentVersion: 1, textVersion: 1 },
    invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
    layer: 0,
    priority: 0,
    disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
    value: folds,
  }
}

describe('mouse selection helpers', () => {
  const autoScrollRect = {
    top: 100,
    bottom: 300,
    height: 200,
    left: 0,
    right: 400,
    width: 400,
  } as DOMRect

  it('returns signed auto-scroll deltas near the vertical edges', () => {
    expect(mouseSelectionAutoScrollDelta(200, 99, autoScrollRect).y).toBeLessThan(0)
    expect(mouseSelectionAutoScrollDelta(200, 301, autoScrollRect).y).toBeGreaterThan(0)
    expect(mouseSelectionAutoScrollDelta(200, 200, autoScrollRect).y).toBe(0)
  })

  it('returns signed auto-scroll deltas near the horizontal edges', () => {
    expect(mouseSelectionAutoScrollDelta(-1, 200, autoScrollRect).x).toBeLessThan(0)
    expect(mouseSelectionAutoScrollDelta(401, 200, autoScrollRect).x).toBeGreaterThan(0)
    expect(mouseSelectionAutoScrollDelta(200, 200, autoScrollRect).x).toBe(0)
  })

  it('starts the zones at the insets, which cover text the pointer cannot see', () => {
    expect(mouseSelectionAutoScrollDelta(60, 200, autoScrollRect).x).toBe(0)
    expect(
      mouseSelectionAutoScrollDelta(60, 200, autoScrollRect, { left: 50, right: 0 }).x,
    ).toBeLessThan(0)
    expect(mouseSelectionAutoScrollDelta(340, 200, autoScrollRect).x).toBe(0)
    expect(
      mouseSelectionAutoScrollDelta(340, 200, autoScrollRect, { left: 0, right: 50 }).x,
    ).toBeGreaterThan(0)
  })

  it('splits the zones evenly when the viewport is narrower than two of them', () => {
    const narrow = { top: 0, bottom: 40, height: 40, left: 0, right: 40, width: 40 } as DOMRect

    expect(mouseSelectionAutoScrollDelta(30, 30, narrow).x).toBeGreaterThan(0)
    expect(mouseSelectionAutoScrollDelta(30, 30, narrow).y).toBeGreaterThan(0)
  })
})

describe('navigation helpers', () => {
  it('moves by word boundaries without splitting surrogate pairs', () => {
    const text = 'alpha 😀 beta'

    expect(nextWordOffset(text, 0)).toBe(6)
    expect(nextWordOffset(text, 6)).toBe(9)
    expect(previousWordOffset(text, text.length)).toBe(9)
  })
})

describe('default editor keybindings', () => {
  it('resolves later layers over earlier layers for the same normalized hotkey', () => {
    const bindings = editorKeyBindings({
      defaultBindings: false,
      layers: [
        {
          id: 'base',
          bindings: [{ chord: ['Mod+K'], command: 'find' }],
        },
        {
          id: 'override',
          bindings: [{ chord: [{ key: 'K', mod: true }], command: 'selectAll' }],
        },
      ],
    })

    expect(bindings.map((binding) => binding.command)).toEqual(['selectAll', 'find'])
  })

  it('builds readonly-safe command pack layers without edit commands', () => {
    const commands = editorKeymapLayersForCommandPacks(readonlySafeEditorCommandPacks, 'linux')
      .flatMap((layer) => layer.bindings)
      .map((binding) => binding.command)

    expect(commands).toContain('cursorLeft')
    expect(commands).toContain('selectAll')
    expect(commands).toContain('find')
    expect(commands).not.toContain('deleteBackward')
    expect(commands).not.toContain('findReplace')
    expect(commands).not.toContain('editor.action.insertCursorAbove')
    expect(commands).not.toContain('goToDefinition')
  })

  it('binds VS Code edit actions by default', () => {
    const commands = defaultEditorKeyBindings('mac').map((binding) => binding.command)

    expect(commands).toContain('deleteWordLeft')
    expect(commands).toContain('deleteWordRight')
    expect(commands).toContain('editor.action.commentLine')
    expect(commands).toContain('editor.action.blockComment')
    expect(commands).toContain('editor.action.indentLines')
    expect(commands).toContain('editor.action.outdentLines')
    expect(commands).toContain('editor.action.deleteLines')
    expect(commands).toContain('editor.action.copyLinesUpAction')
    expect(commands).toContain('editor.action.copyLinesDownAction')
    expect(commands).toContain('editor.action.moveLinesUpAction')
    expect(commands).toContain('editor.action.moveLinesDownAction')
    expect(commands).toContain('editor.action.insertLineBefore')
    expect(commands).toContain('editor.action.insertLineAfter')
  })

  it('binds VS Code multi-cursor actions without chord-only commands', () => {
    const commands = defaultEditorKeyBindings('linux').map((binding) => binding.command)

    expect(commands).toContain('editor.action.insertCursorAbove')
    expect(commands).toContain('editor.action.insertCursorBelow')
    expect(commands).toContain('editor.action.selectHighlights')
    expect(commands).toContain('editor.action.changeAll')
    expect(commands).not.toContain('editor.action.moveSelectionToNextFindMatch')
  })

  // A binding whose hotkey a later layer takes is dropped from the resolved keymap, so asking for
  // the exact chord back is asking whether the command is still reachable at all.
  it.each([
    ['mac', 'cursorColumnSelectLeft', { alt: true, key: 'ArrowLeft', mod: true, shift: true }],
    ['mac', 'cursorColumnSelectRight', { alt: true, key: 'ArrowRight', mod: true, shift: true }],
    ['mac', 'cursorColumnSelectUp', { alt: true, key: 'ArrowUp', mod: true, shift: true }],
    ['mac', 'cursorColumnSelectDown', { alt: true, key: 'ArrowDown', mod: true, shift: true }],
    ['mac', 'cursorColumnSelectPageUp', { alt: true, key: 'PageUp', mod: true, shift: true }],
    ['mac', 'cursorColumnSelectPageDown', { alt: true, key: 'PageDown', mod: true, shift: true }],
    ['windows', 'cursorColumnSelectUp', { alt: true, key: 'ArrowUp', mod: true, shift: true }],
    ['windows', 'cursorColumnSelectDown', { alt: true, key: 'ArrowDown', mod: true, shift: true }],
    ['windows', 'cursorColumnSelectPageUp', { alt: true, key: 'PageUp', mod: true, shift: true }],
    [
      'windows',
      'cursorColumnSelectPageDown',
      { alt: true, key: 'PageDown', mod: true, shift: true },
    ],
    ['linux', 'cursorColumnSelectUp', { key: 'ArrowUp', mod: true }],
    ['linux', 'cursorColumnSelectDown', { key: 'ArrowDown', mod: true }],
    ['linux', 'cursorColumnSelectPageUp', { alt: true, key: 'PageUp', mod: true, shift: true }],
    ['linux', 'cursorColumnSelectPageDown', { alt: true, key: 'PageDown', mod: true, shift: true }],
  ] as const)('leaves %s a chord for %s', (platform, command, hotkey) => {
    expect(defaultEditorKeyBindings(platform)).toContainEqual({ command, chord: [hotkey] })
  })

  // Both helpers answer through the classification, so a command belonging to no pack is dropped
  // from a host's own layer however many packs the host turned on — and dropped silently, because
  // a filter that kept nothing looks from outside like one that had nothing to keep.
  it('keeps a host layer bound to the commands the editor ships no key of its own for', () => {
    const commands: readonly EditorCommandId[] = [
      'editor.action.jumpToBracket',
      'editor.action.toggleWordWrap',
      'editor.action.trimTrailingWhitespace',
      'editor.action.sortLinesAscending',
      'editor.action.sortLinesDescending',
      'editor.action.joinLines',
      'editor.action.duplicateSelection',
      'editor.action.transformToUppercase',
      'editor.action.transformToLowercase',
      'editor.action.transformToTitlecase',
    ]
    const bindings = commands.map((command, index) => ({
      chord: [{ alt: true, key: `F${index + 1}` }] as const,
      command,
    }))

    for (const command of commands) {
      expect(editorCommandPackForCommand(command)).not.toBeNull()
    }
    expect(
      filterEditorKeymapLayersByCommandPacks(
        [{ id: 'host', source: 'app', bindings }],
        defaultEditorCommandPacks,
      ).flatMap((layer) => layer.bindings),
    ).toEqual(bindings)
    expect(editorKeymapLayersForBindings(bindings).flatMap((layer) => layer.bindings)).toEqual(
      expect.arrayContaining(bindings),
    )
  })

  it('keeps column selection in a keymap a host has narrowed to packs', () => {
    const commands = filterEditorKeymapLayersByCommandPacks(
      defaultEditorKeymapLayers('linux'),
      readonlySafeEditorCommandPacks,
    )
      .flatMap((layer) => layer.bindings)
      .map((binding) => binding.command)

    expect(commands).toEqual(
      expect.arrayContaining([
        'cursorColumnSelectLeft',
        'cursorColumnSelectRight',
        'cursorColumnSelectUp',
        'cursorColumnSelectDown',
        'cursorColumnSelectPageUp',
        'cursorColumnSelectPageDown',
      ]),
    )
  })

  it('uses VS Code platform-specific edit shortcut shapes', () => {
    expect(defaultEditorKeyBindings('mac')).toContainEqual(
      expect.objectContaining({
        command: 'deleteWordLeft',
        chord: [expect.objectContaining({ alt: true, key: 'Backspace' })],
      }),
    )
    expect(defaultEditorKeyBindings('linux')).toContainEqual(
      expect.objectContaining({
        command: 'editor.action.copyLinesUpAction',
        chord: [
          expect.objectContaining({
            alt: true,
            key: 'ArrowUp',
            mod: true,
            shift: true,
          }),
        ],
      }),
    )
    expect(defaultEditorKeyBindings('windows')).toContainEqual(
      expect.objectContaining({
        command: 'editor.action.blockComment',
        chord: [expect.objectContaining({ alt: true, key: 'A', shift: true })],
      }),
    )
  })
})

describe('text range helpers', () => {
  it('finds line and word ranges at clamped offsets', () => {
    const text = 'one two\nthree'

    expect(lineRangeAtOffset(text, 5)).toEqual({ start: 0, end: 7 })
    expect(lineRangeAtOffset(text, 99)).toEqual({ start: 8, end: 13 })
    expect(wordRangeAtOffset(text, 4)).toEqual({ start: 4, end: 7 })
    expect(wordRangeAtOffset(text, 7)).toEqual({ start: 4, end: 7 })
  })
})

describe('timing helpers', () => {
  it('appends and merges timing measurements', () => {
    const change = createEmptyChange()
    const withTiming = appendTiming(change, 'apply', eventStartMs(new Event('input')))
    const merged = mergeChangeTimings(
      { ...change, timings: [{ name: 'render', durationMs: 1 }] },
      withTiming,
    )

    expect(withTiming.timings[0]?.name).toBe('apply')
    expect(merged.timings.map((timing) => timing.name)).toEqual(['apply', 'render'])
  })
})

function createEmptyChange(): DocumentSessionChange {
  return { ...createDocumentSession('a').applyText(''), timings: [] }
}

describe('token projection', () => {
  const style = { color: 'red' }
  const store = (tokens: readonly EditorToken[]) => EditorTokenStore.fromTokens(tokens)

  it('shifts, expands, and drops tokens across edits', () => {
    const tokens = store([
      { start: 0, end: 5, style },
      { start: 6, end: 10, style },
      { start: 11, end: 16, style },
    ])

    expect(
      projectTokensThroughEdit(
        tokens,
        { from: 5, to: 5, text: 'Name' },
        'alpha beta gamma',
      ).toTokens(),
    ).toEqual([
      { start: 0, end: 9, style },
      { start: 10, end: 14, style },
      { start: 15, end: 20, style },
    ])
    expect(
      projectTokensThroughEdit(
        tokens,
        { from: 7, to: 9, text: '\n' },
        'alpha beta gamma',
      ).toTokens(),
    ).toEqual([
      { start: 0, end: 5, style },
      { start: 10, end: 15, style },
    ])
    expect(
      projectTokensThroughEdit(
        tokens,
        { from: 2, to: 2, text: '\n' },
        'alpha beta gamma',
      ).toTokens(),
    ).toEqual([
      { start: 7, end: 11, style },
      { start: 12, end: 17, style },
    ])
  })

  // The failure is a lost fast path: a same-line keystroke that re-renders every mounted row.
  it('records whether projected tokens can keep live ranges', () => {
    const tokens = store([
      { start: 0, end: 5, style },
      { start: 6, end: 10, style },
    ])

    const shifted = projectTokensThroughEdit(tokens, { from: 5, to: 5, text: 'X' }, 'alpha beta')
    const dropped = projectTokensThroughEdit(tokens, { from: 7, to: 9, text: '\n' }, 'alpha beta')

    expect(tokenProjectionLiveRangeStatus(tokens, tokens)).toBe(true)
    expect(tokenProjectionLiveRangeStatus(tokens, shifted)).toBe(true)
    expect(tokenProjectionLiveRangeStatus(tokens, dropped)).toBe(false)
    expect(tokenProjectionLiveRangeStatus(store([{ start: 0, end: 1, style }]), shifted)).toBe(
      false,
    )
    expect(tokenProjectionLiveRangeStatus(shifted, tokens)).toBeNull()
  })

  it('projects deletions and replacements inside a token', () => {
    const base = [
      { start: 0, end: 5, style },
      { start: 6, end: 10, style },
      { start: 11, end: 16, style },
    ]

    const deleted = projectTokensThroughEdit(
      store(base),
      { from: 7, to: 9, text: '' },
      'alpha beta gamma',
    )
    expect(deleted.toTokens()).toEqual([
      { start: 0, end: 5, style },
      { start: 6, end: 8, style },
      { start: 9, end: 14, style },
    ])
    expect(deleted).toMatchObject({ monotonicEnd: true, nonOverlapping: true })

    const replaced = projectTokensThroughEdit(
      store(base),
      { from: 7, to: 9, text: 'ZZ' },
      'alpha beta gamma',
    )
    expect(replaced.toTokens()).toEqual(base)
  })

  // The failure is a keystroke whose cost grows with the document below the caret.
  it('visits only the tokens the edit touches, however long the suffix', () => {
    const tokenCount = 5_000
    const text = 'a '.repeat(tokenCount)
    const tokens = store(
      Array.from({ length: tokenCount }, (_, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        style,
      })),
    )
    let projected = tokens

    const diagnostics = collectPerformanceDiagnostics(() => {
      projected = projectTokensThroughEdit(tokens, { from: 1, to: 1, text: 'X' }, text)
    })

    expect(diagnostics.find(tokenProjectionPath)?.detail).toMatchObject({
      affectedCount: 1,
      tokenCount,
    })
    expect(projected).toHaveLength(tokenCount)
    expect(projected.toTokens(0, 3)).toEqual([
      { start: 0, end: 2, style },
      { start: 3, end: 4, style },
      { start: 5, end: 6, style },
    ])
    expect(projected.tokenAt(tokenCount - 1)).toEqual({
      start: (tokenCount - 1) * 2 + 1,
      end: (tokenCount - 1) * 2 + 2,
      style,
    })
  })

  it('projects overlapping tokens whose ends stay monotonic', () => {
    const tokens = store([
      { start: 0, end: 5, style },
      { start: 0, end: 5, style },
      { start: 6, end: 10, style },
    ])

    const projected = projectTokensThroughEdit(
      tokens,
      { from: 5, to: 5, text: 'Name' },
      'alpha beta',
    )

    expect(projected.toTokens()).toEqual([
      { start: 0, end: 9, style },
      { start: 0, end: 9, style },
      { start: 10, end: 14, style },
    ])
    expect(projected).toMatchObject({ monotonicEnd: true, nonOverlapping: false })
  })

  // The failure is a nested token hiding its parent from the bisection that finds a row's tokens.
  it('keeps an exact running maximum end for non-monotonic overlapping tokens', () => {
    const tokens = store([
      { start: 0, end: 10, style },
      { start: 2, end: 5, style },
      { start: 11, end: 15, style },
    ])

    const projected = projectTokensThroughEdit(
      tokens,
      { from: 10, to: 10, text: '.' },
      'abcdefghij klmn',
    )

    expect(projected.toTokens()).toEqual([
      { start: 0, end: 10, style },
      { start: 2, end: 5, style },
      { start: 12, end: 16, style },
    ])
    expect(projected).toMatchObject({ monotonicEnd: false, nonOverlapping: false })
    expect(projected.firstEndingAfter(7)).toBe(0)
    expect(projected.firstEndingAfter(10)).toBe(2)
  })

  it('uses snapshot ranges for token word-boundary checks', () => {
    const projected = projectTokensThroughEdit(
      store([{ start: 0, end: 5, style }]),
      { from: 5, to: 5, text: 'Name' },
      lazyTextSnapshot('alpha beta'),
    )

    expect(projected.toTokens()).toEqual([{ start: 0, end: 9, style }])
  })

  it('reads only tiny snapshot ranges for token word-boundary checks', () => {
    const reads: Array<readonly [number, number]> = []
    const projected = projectTokensThroughEdit(
      store([{ start: 0, end: 5, style }]),
      { from: 5, to: 5, text: 'Name' },
      recordingTextSnapshot('alpha beta', reads),
    )

    expect(projected.toTokens()).toEqual([{ start: 0, end: 9, style }])
    expect(reads.every(([start, end]) => end - start <= 2)).toBe(true)
  })

  it('handles snapshot-backed surrogate-pair word-boundary checks', () => {
    const projected = projectTokensThroughEdit(
      store([{ start: 2, end: 7, style }]),
      { from: 2, to: 2, text: 'X' },
      lazyTextSnapshot('😀alpha'),
    )

    expect(projected.toTokens()).toEqual([{ start: 2, end: 8, style }])
  })
})

function lazyTextSnapshot(text: string): TextSnapshot {
  const source = createStringTextSnapshot(text)
  return {
    lineCount: source.lineCount,
    lineStart: (line) => source.lineStart(line),
    lineRange: (line) => source.lineRange(line),
    lineAt: (offset) => source.lineAt(offset),
    length: text.length,
    materializeFullText: () => {
      throw new Error('unexpected full text materialization')
    },
    readRange: (start, end) => text.slice(start, end),
    forEachTextChunk: (visit) => {
      if (text.length > 0) visit(text, 0, text.length)
    },
  }
}

function recordingTextSnapshot(
  text: string,
  reads: Array<readonly [number, number]>,
): TextSnapshot {
  const source = createStringTextSnapshot(text)
  return {
    lineCount: source.lineCount,
    lineStart: (line) => source.lineStart(line),
    lineRange: (line) => source.lineRange(line),
    lineAt: (offset) => source.lineAt(offset),
    length: text.length,
    materializeFullText: () => {
      throw new Error('unexpected full text materialization')
    },
    readRange: (start, end = text.length) => {
      reads.push([start, end])
      return text.slice(start, end)
    },
    forEachTextChunk: (visit) => {
      if (text.length > 0) visit(text, 0, text.length)
    },
  }
}

type TestPerformanceDiagnostic = {
  readonly name: string
  readonly detail?: Readonly<Record<string, unknown>>
}

function collectPerformanceDiagnostics(run: () => void): readonly TestPerformanceDiagnostic[] {
  const global = globalThis as typeof globalThis & {
    __EDITOR_PERFORMANCE_DIAGNOSTICS__?: unknown
  }
  const previous = global.__EDITOR_PERFORMANCE_DIAGNOSTICS__
  const diagnostics: TestPerformanceDiagnostic[] = []
  global.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = {
    record: (diagnostic: TestPerformanceDiagnostic) => diagnostics.push(diagnostic),
  }

  try {
    run()
  } finally {
    global.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = previous
  }

  return diagnostics
}

function tokenProjectionPath(diagnostic: TestPerformanceDiagnostic): boolean {
  return diagnostic.name === 'editor.tokenProjection.path'
}

describe('editor public helper types', () => {
  it('keeps public option and highlight registry contracts assignable', () => {
    const registry: HighlightRegistry = {
      set: vi.fn(),
      delete: vi.fn(() => true),
    }
    const options: EditorOptions = { plugins: [], keymap: {}, onChange: vi.fn() }

    registry.set('editor-test', {} as Highlight)
    expect(options.plugins).toEqual([])
    expect(registry.delete('editor-test')).toBe(true)
  })
})

function foldRange(overrides: Partial<FoldRange> = {}): FoldRange {
  return {
    startIndex: 0,
    endIndex: 10,
    startLine: 0,
    endLine: 1,
    type: 'block',
    languageId: 'typescript',
    ...overrides,
  }
}
